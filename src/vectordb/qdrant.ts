import { QdrantClient } from '@qdrant/js-client-rest';
import { randomUUID } from 'node:crypto';
import type {
  VectorDB,
  CodeDocument,
  HybridSearchParams,
  SearchResult,
  SymbolEntry,
} from './types.js';
import { VectorDBError } from '../errors.js';
import { getConfig } from '../config.js';

export const RRF_K = 5; // Reciprocal Rank Fusion constant (low k for code search — stronger rank separation)
export const RRF_ALPHA = 0.7; // Blend weight: 70% rank-based (fusion stability), 30% raw similarity (query-specific signal)

export class QdrantVectorDB implements VectorDB {
  private client: QdrantClient;

  constructor(url?: string, apiKey?: string) {
    const config = getConfig();
    this.client = new QdrantClient({
      url: url ?? config.qdrantUrl,
      ...((apiKey ?? config.qdrantApiKey) ? { apiKey: apiKey ?? config.qdrantApiKey } : {}),
    });
  }

  async createCollection(name: string, dimension: number): Promise<void> {
    try {
      await this.client.createCollection(name, {
        vectors: {
          dense: { size: dimension, distance: 'Cosine' },
        },
      });

      await Promise.all([
        this.client.createPayloadIndex(name, {
          field_name: 'content',
          field_schema: 'text',
          wait: true,
        }),
        this.client.createPayloadIndex(name, {
          field_name: 'relativePath',
          field_schema: 'keyword',
          wait: true,
        }),
        this.client.createPayloadIndex(name, {
          field_name: 'fileExtension',
          field_schema: 'keyword',
          wait: true,
        }),
        this.client.createPayloadIndex(name, {
          field_name: 'fileCategory',
          field_schema: 'keyword',
          wait: true,
        }),
      ]);
    } catch (err) {
      throw new VectorDBError(`Failed to create collection "${name}"`, err);
    }
  }

  async hasCollection(name: string): Promise<boolean> {
    try {
      const response = await this.client.collectionExists(name);
      return response.exists;
    } catch {
      return false;
    }
  }

  async dropCollection(name: string): Promise<void> {
    try {
      if (await this.hasCollection(name)) {
        await this.client.deleteCollection(name);
      }
    } catch (err) {
      throw new VectorDBError(`Failed to drop collection "${name}"`, err);
    }
  }

  async insert(name: string, documents: CodeDocument[]): Promise<void> {
    if (documents.length === 0) return;

    try {
      const batchSize = 100;
      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        await this.client.upsert(name, {
          wait: true,
          points: batch.map((doc) => ({
            id: doc.id ?? randomUUID(),
            vector: { dense: doc.vector },
            payload: {
              content: doc.content,
              relativePath: doc.relativePath,
              startLine: doc.startLine,
              endLine: doc.endLine,
              fileExtension: doc.fileExtension,
              language: doc.language,
              fileCategory: doc.fileCategory ?? 'source',
              symbolName: doc.symbolName ?? '',
              symbolKind: doc.symbolKind ?? '',
              symbolSignature: doc.symbolSignature ?? '',
              parentSymbol: doc.parentSymbol ?? '',
            },
          })),
        });
      }
    } catch (err) {
      throw new VectorDBError(`Failed to insert ${documents.length} documents into "${name}"`, err);
    }
  }

  async search(name: string, params: HybridSearchParams): Promise<SearchResult[]> {
    try {
      const fetchLimit = params.limit * 2;

      const extensionFilter = params.extensionFilter?.length
        ? {
            should: params.extensionFilter.map((ext) => ({
              key: 'fileExtension',
              match: { value: ext },
            })),
          }
        : undefined;

      const denseResults = await this.client.search(name, {
        vector: { name: 'dense', vector: params.queryVector },
        limit: fetchLimit,
        with_payload: true,
        ...(extensionFilter ? { filter: { must: [extensionFilter] } } : {}),
      });

      const textFilter: Record<string, unknown>[] = [
        { key: 'content', match: { text: params.queryText } },
      ];
      if (extensionFilter) {
        textFilter.push(extensionFilter);
      }

      const textResponse = await this.client.scroll(name, {
        filter: { must: textFilter },
        limit: fetchLimit,
        with_payload: true,
      });

      const rankedTextResults = rankByTermFrequency(textResponse.points, params.queryText);
      return reciprocalRankFusion(denseResults, rankedTextResults, params.limit);
    } catch (err) {
      throw new VectorDBError(`Search failed in collection "${name}"`, err);
    }
  }

  async getById(
    name: string,
    id: string,
  ): Promise<{ payload: Record<string, unknown>; vector: number[] } | null> {
    try {
      const results = await this.client.retrieve(name, {
        ids: [id],
        with_payload: true,
        with_vector: true,
      });
      if (results.length === 0) return null;
      const point = results[0];
      const vectors = point.vector as Record<string, number[]> | number[] | undefined;
      const vector = Array.isArray(vectors) ? vectors : (vectors?.dense ?? []);
      return {
        payload: point.payload ?? {},
        vector,
      };
    } catch (err) {
      throw new VectorDBError(`Failed to retrieve point "${id}" from "${name}"`, err);
    }
  }

  async updatePoint(
    name: string,
    id: string,
    vector: number[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.client.upsert(name, {
        wait: true,
        points: [
          {
            id,
            vector: { dense: vector },
            payload,
          },
        ],
      });
    } catch (err) {
      throw new VectorDBError(`Failed to update point "${id}" in "${name}"`, err);
    }
  }

  async deleteByPath(name: string, relativePath: string): Promise<void> {
    try {
      await this.client.delete(name, {
        filter: {
          must: [{ key: 'relativePath', match: { value: relativePath } }],
        },
        wait: true,
      });
    } catch (err) {
      throw new VectorDBError(
        `Failed to delete documents for path "${relativePath}" from "${name}"`,
        err,
      );
    }
  }

  async deleteByFilter(name: string, filter: Record<string, unknown>): Promise<void> {
    try {
      const must = Object.entries(filter).map(([key, value]) => ({
        key,
        match: { value },
      }));
      await this.client.delete(name, {
        filter: { must },
        wait: true,
      });
    } catch (err) {
      throw new VectorDBError(`Failed to delete by filter from "${name}"`, err);
    }
  }

  async listSymbols(name: string): Promise<SymbolEntry[]> {
    try {
      const results: SymbolEntry[] = [];
      let offset: string | number | undefined = undefined;
      const pageSize = 1000;

      while (true) {
        const response = await this.client.scroll(name, {
          filter: {
            must_not: [{ is_empty: { key: 'symbolName' } }],
          },
          limit: pageSize,
          with_payload: true,
          with_vector: false,
          ...(offset !== undefined ? { offset } : {}),
        });

        for (const point of response.points) {
          const p = point.payload ?? {};
          const symName = String(p.symbolName ?? '');
          if (!symName) continue;
          results.push({
            name: symName,
            kind: String(p.symbolKind ?? ''),
            relativePath: String(p.relativePath ?? ''),
            startLine: Number(p.startLine ?? 0),
            ...(p.symbolSignature ? { signature: String(p.symbolSignature) } : {}),
            ...(p.parentSymbol ? { parentName: String(p.parentSymbol) } : {}),
          });
        }

        if (response.next_page_offset == null || response.points.length < pageSize) break;
        offset = response.next_page_offset as string | number;
      }

      return results;
    } catch (err) {
      throw new VectorDBError(`Failed to list symbols from "${name}"`, err);
    }
  }

  async scrollAll(
    name: string,
  ): Promise<{ id: string | number; vector: number[]; payload: Record<string, unknown> }[]> {
    try {
      const results: { id: string | number; vector: number[]; payload: Record<string, unknown> }[] =
        [];
      let offset: string | number | undefined = undefined;
      const pageSize = 1000;

      while (true) {
        const response = await this.client.scroll(name, {
          limit: pageSize,
          with_payload: true,
          with_vector: true,
          ...(offset !== undefined ? { offset } : {}),
        });

        for (const point of response.points) {
          const vectors = point.vector as Record<string, number[]> | number[] | undefined;
          const vector = Array.isArray(vectors) ? vectors : (vectors?.dense ?? []);
          results.push({
            id: point.id,
            vector,
            payload: (point.payload as Record<string, unknown>) ?? {},
          });
        }

        if (response.next_page_offset == null || response.points.length < pageSize) break;
        offset = response.next_page_offset as string | number;
      }

      return results;
    } catch (err) {
      throw new VectorDBError(`Failed to scroll all points from "${name}"`, err);
    }
  }
}

interface RankedPoint {
  id: string | number;
  payload?: Record<string, unknown> | null;
  rawScore: number;
}

// Rank text-match results by normalized term frequency so RRF receives a meaningful ordering.
export function rankByTermFrequency(
  points: { id: string | number; payload?: Record<string, unknown> | null }[],
  queryText: string,
): RankedPoint[] {
  if (points.length === 0) return [];

  const terms = [
    ...new Set(
      queryText
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 0),
    ),
  ];
  if (terms.length === 0) return points.map((p) => ({ ...p, rawScore: 0 }));

  const termPatterns = terms.map((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));

  const scored = points.map((point) => {
    const content =
      ((point.payload as Record<string, unknown> | undefined)?.content as string) ?? '';
    const wordCount = Math.max(1, content.split(/\s+/).length);

    let hits = 0;
    for (const pattern of termPatterns) {
      pattern.lastIndex = 0;
      const matches = content.match(pattern);
      hits += matches ? matches.length : 0;
    }

    const tf = hits / wordCount;
    return { point, tf };
  });

  scored.sort((a, b) => b.tf - a.tf);
  const maxTf = scored[0].tf;
  return scored.map((s) => ({
    ...s.point,
    rawScore: maxTf > 0 ? s.tf / maxTf : 0,
  }));
}

interface ScoredPayload {
  id: string | number;
  content: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  fileExtension: string;
  language: string;
  fileCategory: string;
}

export function extractPayload(point: {
  id: string | number;
  payload?: Record<string, unknown> | null;
}): ScoredPayload {
  const p = point.payload ?? {};
  return {
    id: point.id,
    content: String(p.content ?? ''),
    relativePath: String(p.relativePath ?? ''),
    startLine: Number(p.startLine ?? 0),
    endLine: Number(p.endLine ?? 0),
    fileExtension: String(p.fileExtension ?? ''),
    language: String(p.language ?? ''),
    fileCategory: String(p.fileCategory ?? ''),
  };
}

export function reciprocalRankFusion(
  denseResults: { id: string | number; score?: number; payload?: Record<string, unknown> | null }[],
  textResults: RankedPoint[],
  limit: number,
): SearchResult[] {
  const scoreMap = new Map<string | number, { score: number; payload: ScoredPayload }>();

  const blendedScore = (rank: number, rawSimilarity: number) =>
    RRF_ALPHA * (1 / (RRF_K + rank + 1)) + (1 - RRF_ALPHA) * rawSimilarity;

  for (let rank = 0; rank < denseResults.length; rank++) {
    const point = denseResults[rank];
    const rawSim = point.score ?? 0;
    const score = blendedScore(rank, rawSim);
    const existing = scoreMap.get(point.id);
    const payload = extractPayload(point);
    if (existing) {
      existing.score += score;
    } else {
      scoreMap.set(point.id, { score, payload });
    }
  }

  for (let rank = 0; rank < textResults.length; rank++) {
    const point = textResults[rank];
    const score = blendedScore(rank, point.rawScore);
    const existing = scoreMap.get(point.id);
    const payload = extractPayload(point);
    if (existing) {
      existing.score += score;
    } else {
      scoreMap.set(point.id, { score, payload });
    }
  }

  const sorted = [...scoreMap.values()].sort((a, b) => b.score - a.score).slice(0, limit);

  return sorted.map(({ score, payload }) => ({
    content: payload.content,
    relativePath: payload.relativePath,
    startLine: payload.startLine,
    endLine: payload.endLine,
    fileExtension: payload.fileExtension,
    language: payload.language,
    score,
    fileCategory: payload.fileCategory,
  }));
}
