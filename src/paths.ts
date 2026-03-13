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

export function getRegistryPath(): string {
  return `${getDataDir()}/registry.json`;
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

export function getRaptorDbPath(): string {
  return `${getDataDir()}/raptor.db`;
}

export function knowledgeCollectionName(project: string): string {
  return `eidetic_${project}_knowledge`;
}

export function globalConceptsCollectionName(): string {
  return 'eidetic_global_concepts';
}
