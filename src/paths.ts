import path from 'node:path';
import os from 'node:os';
import { getConfig } from './config.js';

export function normalizePath(inputPath: string): string {
  let resolved = inputPath;
  if (resolved.startsWith('~')) {
    resolved = path.join(os.homedir(), resolved.slice(1));
  }
  resolved = path.resolve(resolved);
  resolved = resolved.replace(/\\/g, '/');
  if (resolved.length > 1 && resolved.endsWith('/')) {
    resolved = resolved.slice(0, -1);
  }
  return resolved;
}

export function getDataDir(): string {
  return normalizePath(getConfig().eideticDataDir);
}

export function getCacheDir(): string {
  return `${getDataDir()}/cache`;
}

export function getMemoryDbPath(): string {
  return `${getDataDir()}/memory-history.db`;
}

export function getMemoryStorePath(): string {
  return `${getDataDir()}/memorystore.db`;
}

export function getBufferDbPath(): string {
  return `${getDataDir()}/buffer.db`;
}

/**
 * Get the memories directory for a project.
 * Uses EIDETIC_VAULT_DIR if set, otherwise defaults to ~/.eidetic/memories/<project>.
 */
export function getMemoriesDir(project: string): string {
  const config = getConfig();
  const base = config.eideticVaultDir
    ? normalizePath(config.eideticVaultDir)
    : `${getDataDir()}/memories`;
  return `${base}/${project}`;
}

/**
 * Get the vector cache database path for a memories directory.
 */
export function getVectorCachePath(memoriesDir: string): string {
  return `${memoriesDir}/.vector-cache.db`;
}
