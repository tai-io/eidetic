import type { SearchResult } from './types.js';

export const RRF_K = 5; // Reciprocal Rank Fusion constant (low k for code search — stronger rank separation)
export const RRF_ALPHA = 0.7; // Blend weight: 70% rank-based (fusion stability), 30% raw similarity (query-specific signal)

export interface RankedPoint {
  id: string | number;
  payload?: Record<string, unknown> | null;
  rawScore: number;
}

export interface ScoredPayload {
  id: string | number;
  content: string;
  relativePath: string;
  startLine: number;
  endLine: number;
  fileExtension: string;
  language: string;
  fileCategory: string;
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
