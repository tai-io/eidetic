import { randomUUID } from 'node:crypto';
import type { Embedding } from '../embedding/types.js';
import type { VectorDB } from '../vectordb/types.js';
import { globalConceptsCollectionName } from '../paths.js';

/**
 * Replicate knowledge summaries from a project's knowledge collection
 * to the global concepts collection, tagged with the project name.
 */
export async function replicateToGlobalConcepts(
  project: string,
  knowledgeCollectionName: string,
  embedding: Embedding,
  vectordb: VectorDB,
): Promise<number> {
  const globalCol = globalConceptsCollectionName();

  // Ensure global collection exists
  if (!(await vectordb.hasCollection(globalCol))) {
    await vectordb.createCollection(globalCol, embedding.dimension);
  }

  // Scroll all knowledge points
  const points = await vectordb.scrollAll(knowledgeCollectionName);
  if (points.length === 0) return 0;

  // Clean up stale entries for this project
  await vectordb.deleteByFilter(globalCol, { project });

  // Upsert knowledge points into global collection
  let replicated = 0;
  for (const point of points) {
    const id = randomUUID();
    await vectordb.updatePoint(globalCol, id, point.vector, {
      ...point.payload,
      content: typeof point.payload.content === 'string' ? point.payload.content : '',
      relativePath: id,
      startLine: 0,
      endLine: 0,
      fileExtension: 'knowledge',
      language: 'summary',
      project,
      source: 'raptor',
    });
    replicated++;
  }

  return replicated;
}
