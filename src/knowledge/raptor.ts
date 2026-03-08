import { createHash, randomUUID } from 'node:crypto';
import type { Embedding } from '../embedding/types.js';
import type { VectorDB } from '../vectordb/types.js';
import { knowledgeCollectionName } from '../paths.js';
import { getCachedSummary, setCachedSummary } from './raptor-cache.js';

export interface ClusterData {
  clusterId: string;
  chunks: { content: string; file: string; lines: string }[];
  cachedSummary?: string;
}

export interface ClusterResult {
  clusters: ClusterData[];
  totalPoints: number;
}

export interface StoreSummariesResult {
  stored: number;
  replicatedToGlobal: boolean;
}

interface Point {
  id: string | number;
  vector: number[];
  content: string;
  file?: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Cluster indexed code chunks and return cluster data with cache hits.
 * Does NOT call any LLM — returns data for external summarization.
 */
export async function clusterCodeChunks(
  project: string,
  codeCollectionName: string,
  vectordb: VectorDB,
): Promise<ClusterResult> {
  const points = await vectordb.scrollAll(codeCollectionName);
  if (points.length < 3) {
    return { clusters: [], totalPoints: points.length };
  }

  const mapped: Point[] = points.map((p) => ({
    id: p.id,
    vector: p.vector,
    content: typeof p.payload.content === 'string' ? p.payload.content : '',
    file: typeof p.payload.relativePath === 'string' ? p.payload.relativePath : undefined,
    startLine: typeof p.payload.startLine === 'number' ? p.payload.startLine : undefined,
    endLine: typeof p.payload.endLine === 'number' ? p.payload.endLine : undefined,
  }));

  const k = Math.max(3, Math.floor(Math.sqrt(mapped.length / 2)));
  const clusters = kMeans(mapped, k);

  const result: ClusterData[] = [];

  for (const cluster of clusters) {
    if (cluster.length === 0) continue;

    const hash = clusterHash(cluster.map((p) => String(p.id)));
    const cached = getCachedSummary(hash);

    result.push({
      clusterId: hash,
      chunks: cluster.map((p) => ({
        content: p.content,
        file: p.file ?? 'unknown',
        lines: `${p.startLine ?? 0}-${p.endLine ?? 0}`,
      })),
      cachedSummary: cached ?? undefined,
    });
  }

  return { clusters: result, totalPoints: mapped.length };
}

/**
 * Store LLM-generated summaries for clusters.
 * Embeds each summary, stores in knowledge collection, updates cache, replicates to global concepts.
 */
export async function storeRaptorSummaries(
  project: string,
  summaries: { clusterId: string; summary: string }[],
  embedding: Embedding,
  vectordb: VectorDB,
): Promise<StoreSummariesResult> {
  const knowledgeCol = knowledgeCollectionName(project);
  if (!(await vectordb.hasCollection(knowledgeCol))) {
    await vectordb.createCollection(knowledgeCol, embedding.dimension);
  }

  let stored = 0;

  for (const { clusterId, summary } of summaries) {
    if (!summary.trim()) continue;

    const vector = await embedding.embed(summary);
    const pointId = randomUUID();
    await vectordb.updatePoint(knowledgeCol, pointId, vector, {
      content: summary,
      relativePath: pointId,
      startLine: 0,
      endLine: 0,
      fileExtension: 'knowledge',
      language: 'summary',
      cluster_hash: clusterId,
      project,
      level: 0,
      source: 'raptor',
    });

    setCachedSummary(clusterId, summary, project, 0);
    stored++;
  }

  // Replicate to global concepts (non-fatal)
  let replicatedToGlobal = false;
  try {
    const { replicateToGlobalConcepts } = await import('./global-concepts.js');
    await replicateToGlobalConcepts(project, knowledgeCol, embedding, vectordb);
    replicatedToGlobal = true;
  } catch (err) {
    console.warn(`Global concepts replication failed (non-fatal): ${String(err)}`);
  }

  return { stored, replicatedToGlobal };
}

/**
 * K-means clustering (Lloyd's algorithm).
 * Returns an array of clusters, each containing the points assigned to it.
 */
export function kMeans(points: Point[], k: number, maxIter = 20): Point[][] {
  if (points.length === 0 || k <= 0) return [];
  if (k >= points.length) return points.map((p) => [p]);

  const dim = points[0].vector.length;

  // Initialize centroids using k-means++ style: first random, rest spread out
  const centroids: number[][] = [];
  centroids.push([...points[Math.floor(Math.random() * points.length)].vector]);

  for (let c = 1; c < k; c++) {
    // Pick point with probability proportional to squared distance from nearest centroid
    const dists = points.map((p) => {
      let minDist = Infinity;
      for (const cent of centroids) {
        minDist = Math.min(minDist, squaredEuclidean(p.vector, cent));
      }
      return minDist;
    });
    const totalDist = dists.reduce((a, b) => a + b, 0);
    if (totalDist === 0) {
      centroids.push([...points[c % points.length].vector]);
      continue;
    }
    let r = Math.random() * totalDist;
    let idx = 0;
    for (let i = 0; i < dists.length; i++) {
      r -= dists[i];
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    centroids.push([...points[idx].vector]);
  }

  let assignments = new Array<number>(points.length).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign points to nearest centroid
    const newAssignments = points.map((p) => {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let c = 0; c < k; c++) {
        const d = squaredEuclidean(p.vector, centroids[c]);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = c;
        }
      }
      return bestIdx;
    });

    // Check convergence
    const changed = newAssignments.some((a, i) => a !== assignments[i]);
    assignments = newAssignments;
    if (!changed) break;

    // Update centroids
    for (let c = 0; c < k; c++) {
      const members = points.filter((_, i) => assignments[i] === c);
      if (members.length === 0) continue;
      for (let d = 0; d < dim; d++) {
        centroids[c][d] = members.reduce((s, p) => s + p.vector[d], 0) / members.length;
      }
    }
  }

  // Build clusters
  const clusters: Point[][] = Array.from({ length: k }, () => []);
  for (let i = 0; i < points.length; i++) {
    clusters[assignments[i]].push(points[i]);
  }
  return clusters;
}

function squaredEuclidean(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

export function clusterHash(memberIds: string[]): string {
  const sorted = [...memberIds].sort();
  return createHash('sha256').update(sorted.join(',')).digest('hex').slice(0, 16);
}
