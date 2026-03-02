import type { Embedding } from '../embedding/types.js';
import type { VectorDB } from '../vectordb/types.js';

const OLD_COLLECTION = 'eidetic_memory';
const BATCH_SIZE = 100;

interface MigrationResult {
  migrated: number;
  skipped: number;
  errors: string[];
}

function targetCollection(project: string): string {
  return `eidetic_${project || 'global'}_memory`;
}

export async function migrateMemories(
  vectordb: VectorDB,
  embedding: Embedding,
): Promise<MigrationResult> {
  const result: MigrationResult = { migrated: 0, skipped: 0, errors: [] };

  const exists = await vectordb.hasCollection(OLD_COLLECTION);
  if (!exists) return result;

  // Use a broad search to get all memories from the old collection
  const queryVector = await embedding.embed('developer knowledge');
  const entries = await vectordb.search(OLD_COLLECTION, {
    queryVector,
    queryText: '',
    limit: BATCH_SIZE,
  });

  const createdCollections = new Set<string>();

  for (const entry of entries) {
    const id = entry.relativePath;
    if (!id) {
      result.skipped++;
      continue;
    }

    try {
      const point = await vectordb.getById(OLD_COLLECTION, id);
      if (!point) {
        result.skipped++;
        continue;
      }

      const project = String(point.payload.project ?? 'global');
      const originalCategory = String(point.payload.category ?? point.payload.fileExtension ?? '');
      const col = targetCollection(project);

      // Ensure target collection exists
      if (!createdCollections.has(col)) {
        const colExists = await vectordb.hasCollection(col);
        if (!colExists) {
          await vectordb.createCollection(col, embedding.dimension);
        }
        createdCollections.add(col);
      }

      // Write to new collection with kind=fact and migrated source
      await vectordb.updatePoint(col, id, point.vector, {
        content: String(point.payload.content ?? point.payload.memory ?? ''),
        relativePath: id,
        fileExtension: 'fact',
        language: `migrated:${originalCategory}`,
        startLine: 0,
        endLine: 0,
        hash: String(point.payload.hash ?? ''),
        memory: String(point.payload.memory ?? point.payload.content ?? ''),
        kind: 'fact',
        source: `migrated:${originalCategory}`,
        project,
        access_count: Number(point.payload.access_count ?? 0),
        last_accessed: String(point.payload.last_accessed ?? ''),
        supersedes: null,
        superseded_by: null,
        valid_at: String(point.payload.created_at ?? new Date().toISOString()),
        created_at: String(point.payload.created_at ?? new Date().toISOString()),
        updated_at: new Date().toISOString(),
      });

      result.migrated++;
    } catch (err) {
      result.errors.push(`Failed to migrate ${id}: ${String(err)}`);
      result.skipped++;
    }
  }

  return result;
}
