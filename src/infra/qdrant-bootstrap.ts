import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { BootstrapError } from '../errors.js';
import { getConfig } from '../config.js';
import { getDataDir } from '../paths.js';

const CONTAINER_NAME = 'eidetic-qdrant';
const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 500;

export interface BootstrapResult {
  url: string;
  provisioned: boolean;
}

export async function bootstrapQdrant(): Promise<BootstrapResult> {
  const config = getConfig();
  const url = config.qdrantUrl;

  if (await isQdrantHealthy(url)) {
    console.log(`Qdrant reachable at ${url}`);
    return { url, provisioned: false };
  }

  console.log(`Qdrant not reachable at ${url}. Attempting Docker auto-provision...`);

  if (!isDockerAvailable()) {
    throw new BootstrapError(
      `Qdrant not reachable at ${url} and Docker not found.\n` +
        `Either: (a) install Docker and retry, or (b) set QDRANT_URL to your Qdrant instance.`,
    );
  }

  const containerState = getContainerState();
  let provisioned = false;

  if (containerState === 'running') {
    console.log(`Container "${CONTAINER_NAME}" is running. Waiting for health...`);
  } else if (containerState === 'stopped') {
    console.log(`Container "${CONTAINER_NAME}" exists but stopped. Starting...`);
    execFileSync('docker', ['start', CONTAINER_NAME], { stdio: 'pipe' });
  } else {
    const dataDir = path.join(getDataDir(), 'qdrant-data').replace(/\\/g, '/');
    console.log(`Creating new Qdrant container "${CONTAINER_NAME}"...`);
    execFileSync(
      'docker',
      [
        'run',
        '-d',
        '--name',
        CONTAINER_NAME,
        '--restart',
        'unless-stopped',
        '-p',
        '6333:6333',
        '-p',
        '6334:6334',
        '-v',
        `${dataDir}:/qdrant/storage`,
        'qdrant/qdrant',
      ],
      { stdio: 'pipe' },
    );
    provisioned = true;
  }

  const healthy = await waitForHealth(url, HEALTH_TIMEOUT_MS);
  if (!healthy) {
    throw new BootstrapError(
      `Qdrant container started but failed health check after ${HEALTH_TIMEOUT_MS / 1000}s. ` +
        `Check: docker logs ${CONTAINER_NAME}`,
    );
  }

  console.log(`Qdrant auto-provisioned and healthy at ${url}`);
  return { url, provisioned };
}

async function isQdrantHealthy(url: string): Promise<boolean> {
  try {
    const resp = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(3000) });
    return resp.ok;
  } catch {
    return false;
  }
}

function isDockerAvailable(): boolean {
  try {
    execFileSync('docker', ['info'], { stdio: 'pipe', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function getContainerState(): 'running' | 'stopped' | 'none' {
  try {
    const output = execFileSync(
      'docker',
      ['ps', '-a', '--filter', `name=^/${CONTAINER_NAME}$`, '--format', '{{.State}}'],
      { encoding: 'utf-8', stdio: 'pipe' },
    ).trim();

    if (!output) return 'none';
    if (output === 'running') return 'running';
    return 'stopped';
  } catch {
    return 'none';
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isQdrantHealthy(url)) return true;
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return false;
}
