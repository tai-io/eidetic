import { pathToCollectionName } from '../paths.js';
import { listSnapshotCollections, deleteSnapshotByCollection } from '../core/snapshot-io.js';
import type { VectorDB } from '../vectordb/types.js';

export type CodebaseStatus = 'idle' | 'indexing' | 'indexed' | 'error';

export interface CodebaseState {
  path: string;
  collectionName: string;
  status: CodebaseStatus;
  lastIndexed?: string; // ISO timestamp
  totalFiles?: number;
  totalChunks?: number;
  error?: string;
  progress?: number; // 0-100
  progressMessage?: string;
}

export class StateManager {
  private states = new Map<string, CodebaseState>();

  getState(normalizedPath: string): CodebaseState | undefined {
    return this.states.get(normalizedPath);
  }

  getAllStates(): CodebaseState[] {
    return [...this.states.values()];
  }

  setIndexing(normalizedPath: string, collectionName: string): void {
    this.states.set(normalizedPath, {
      path: normalizedPath,
      collectionName,
      status: 'indexing',
      progress: 0,
      progressMessage: 'Starting...',
    });
  }

  updateProgress(normalizedPath: string, progress: number, message: string): void {
    const state = this.states.get(normalizedPath);
    if (state) {
      state.progress = progress;
      state.progressMessage = message;
    }
  }

  setIndexed(normalizedPath: string, totalFiles: number, totalChunks: number): void {
    const state = this.states.get(normalizedPath);
    if (state) {
      state.status = 'indexed';
      state.lastIndexed = new Date().toISOString();
      state.totalFiles = totalFiles;
      state.totalChunks = totalChunks;
      state.progress = 100;
      state.progressMessage = 'Done';
    }
  }

  setError(normalizedPath: string, error: string): void {
    const state = this.states.get(normalizedPath);
    if (state) {
      state.status = 'error';
      state.error = error;
    }
  }

  remove(normalizedPath: string): void {
    this.states.delete(normalizedPath);
  }

  async hydrate(registry: Record<string, string>, vectordb: VectorDB): Promise<number> {
    let count = 0;
    for (const [, projectPath] of Object.entries(registry)) {
      try {
        const collectionName = pathToCollectionName(projectPath);
        const exists = await vectordb.hasCollection(collectionName);
        if (exists && !this.states.has(projectPath)) {
          this.states.set(projectPath, {
            path: projectPath,
            collectionName,
            status: 'indexed',
          });
          count++;
        }
      } catch (err) {
        console.warn(`Hydration failed for ${projectPath}:`, err);
      }
    }
    return count;
  }
}

export async function cleanupOrphanedSnapshots(vectordb: VectorDB): Promise<number> {
  let cleaned = 0;

  try {
    const collections = listSnapshotCollections();
    if (collections.length === 0) return 0;

    const probeResult = await vectordb.hasCollection('__eidetic_connectivity_probe__');
    if (probeResult) {
      console.warn('Orphan cleanup skipped: connectivity probe returned unexpected result.');
      return 0;
    }

    for (const collectionName of collections) {
      try {
        const exists = await vectordb.hasCollection(collectionName);
        if (!exists) {
          deleteSnapshotByCollection(collectionName);
          console.log(`Cleaned orphaned snapshot: ${collectionName}`);
          cleaned++;
        }
      } catch (err) {
        console.warn(`Skipping orphan check for ${collectionName}:`, err);
      }
    }
  } catch (err) {
    console.warn('Orphan cleanup skipped:', err);
  }

  return cleaned;
}
