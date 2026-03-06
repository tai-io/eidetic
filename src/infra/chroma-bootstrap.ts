import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { BootstrapError } from '../errors.js';
import { getDataDir } from '../paths.js';

const DEFAULT_PORT = 8000;
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 500;

export interface ChromaBootstrapResult {
  host: string;
  port: number;
  provisioned: boolean;
}

export async function bootstrapChroma(
  port: number = DEFAULT_PORT,
): Promise<ChromaBootstrapResult> {
  const host = 'localhost';

  if (await isChromaHealthy(host, port)) {
    console.log(`Chroma reachable at ${host}:${port}`);
    return { host, port, provisioned: false };
  }

  console.log(`Chroma not reachable at ${host}:${port}. Starting embedded server...`);

  const dataDir = path.join(getDataDir(), 'chroma');
  fs.mkdirSync(dataDir, { recursive: true });

  const chromaBin = resolveChromaBin();
  if (!chromaBin) {
    throw new BootstrapError(
      `Chroma not reachable at ${host}:${port} and could not find chroma CLI.\n` +
        `Either: (a) start a Chroma server manually, or (b) ensure chromadb is installed.`,
    );
  }

  const child = spawn(process.execPath, [chromaBin, 'run', '--path', dataDir, '--port', String(port)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  const healthy = await waitForHealth(host, port, HEALTH_TIMEOUT_MS);
  if (!healthy) {
    throw new BootstrapError(
      `Chroma server started but failed health check after ${HEALTH_TIMEOUT_MS / 1000}s. ` +
        `Check if port ${port} is available.`,
    );
  }

  console.log(`Chroma auto-provisioned and healthy at ${host}:${port}`);
  return { host, port, provisioned: true };
}

function resolveChromaBin(): string | null {
  // Look for the chromadb CLI in node_modules
  try {
    const chromadbPkg = require.resolve('chromadb/package.json');
    const chromaDir = path.dirname(chromadbPkg);
    const cliPath = path.join(chromaDir, 'dist', 'cli.mjs');
    if (fs.existsSync(cliPath)) return cliPath;
  } catch {
    // not found
  }
  return null;
}

async function isChromaHealthy(host: string, port: number): Promise<boolean> {
  try {
    const resp = await fetch(`http://${host}:${port}/api/v2/heartbeat`, {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isChromaHealthy(host, port)) return true;
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}
