import { createHash, randomUUID } from 'node:crypto';
import type { Embedding } from '../embedding/types.js';
import type { VectorDB } from '../vectordb/types.js';
import { getConfig } from '../config.js';
import { knowledgeCollectionName } from '../paths.js';
import { RaptorError } from '../errors.js';
import { getCachedSummary, setCachedSummary } from './raptor-cache.js';

export interface RaptorResult {
  clustersProcessed: number;
  summariesGenerated: number;
  cached: number;
  timedOut: boolean;
}

interface Point {
  id: string | number;
  vector: number[];
  content: string;
}

/**
 * Run RAPTOR knowledge generation: cluster code chunks, summarize each cluster,
 * store summaries in the knowledge collection.
 */
export async function runRaptor(
  project: string,
  codeCollectionName: string,
  embedding: Embedding,
  vectordb: VectorDB,
  options?: { timeoutMs?: number; llmModel?: string; summarize?: LlmSummarizer },
): Promise<RaptorResult> {
  const config = getConfig();
  const timeoutMs = options?.timeoutMs ?? config.raptorTimeoutMs;
  const llmModel = options?.llmModel ?? config.raptorLlmModel;
  const deadline = Date.now() + timeoutMs;

  // Scroll all points from code collection
  const points = await vectordb.scrollAll(codeCollectionName);
  if (points.length < 3) {
    return { clustersProcessed: 0, summariesGenerated: 0, cached: 0, timedOut: false };
  }

  const mapped: Point[] = points.map((p) => ({
    id: p.id,
    vector: p.vector,
    content: String(p.payload.content ?? ''),
  }));

  // Cluster
  const k = Math.max(3, Math.floor(Math.sqrt(mapped.length / 2)));
  const clusters = kMeans(mapped, k);

  // Ensure knowledge collection exists
  const knowledgeCol = knowledgeCollectionName(project);
  if (!(await vectordb.hasCollection(knowledgeCol))) {
    await vectordb.createCollection(knowledgeCol, embedding.dimension);
  }

  const summarizeFn = options?.summarize ?? defaultSummarize;
  let summariesGenerated = 0;
  let cached = 0;
  let timedOut = false;

  for (let i = 0; i < clusters.length; i++) {
    if (Date.now() >= deadline) {
      timedOut = true;
      break;
    }

    const cluster = clusters[i];
    if (cluster.length === 0) continue;

    // Compute cluster hash from sorted member IDs
    const hash = clusterHash(cluster.map((p) => String(p.id)));

    // Check cache
    const cachedSummary = getCachedSummary(hash);
    let summary: string;

    if (cachedSummary) {
      summary = cachedSummary;
      cached++;
    } else {
      // LLM summarize
      const combinedContent = cluster.map((p) => p.content).join('\n\n---\n\n');
      summary = await summarizeFn(combinedContent, llmModel, config.openaiApiKey);
      setCachedSummary(hash, summary, project, 0);
      summariesGenerated++;
    }

    // Embed summary and store in knowledge collection
    const vector = await embedding.embed(summary);
    const pointId = randomUUID();
    await vectordb.updatePoint(knowledgeCol, pointId, vector, {
      content: summary,
      relativePath: pointId,
      startLine: 0,
      endLine: 0,
      fileExtension: 'knowledge',
      language: 'summary',
      cluster_hash: hash,
      project,
      level: 0,
      source: 'raptor',
    });
  }

  // Replicate to global concepts (non-fatal)
  try {
    const { replicateToGlobalConcepts } = await import('./global-concepts.js');
    await replicateToGlobalConcepts(project, knowledgeCol, embedding, vectordb);
  } catch (err) {
    console.warn(`Global concepts replication failed (non-fatal): ${String(err)}`);
  }

  return {
    clustersProcessed: clusters.filter((c) => c.length > 0).length,
    summariesGenerated,
    cached,
    timedOut,
  };
}

export type LlmSummarizer = (content: string, model: string, apiKey: string) => Promise<string>;

async function defaultSummarize(content: string, model: string, apiKey: string): Promise<string> {
  const config = getConfig();
  const baseUrl = config.openaiBaseUrl ?? 'https://api.openai.com/v1';

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a code analyst. Summarize the following code chunks into a concise architectural description. Focus on what the code does, key patterns, and relationships between components. Be concise (2-4 sentences).',
        },
        { role: 'user', content: content.slice(0, 8000) },
      ],
      max_tokens: 300,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    throw new RaptorError(`LLM summarization failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]?.message?.content ?? '';
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
