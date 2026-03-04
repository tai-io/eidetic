import { createHash } from 'node:crypto';
import type { ReconcileResult } from './types.js';

const SIMILARITY_THRESHOLD = 0.92;
const SUPERSESSION_LOWER = 0.7;

export function hashMemory(text: string): string {
  return createHash('md5').update(text.trim().toLowerCase()).digest('hex');
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface ExistingMatch {
  id: string;
  memory: string;
  hash: string;
  vector: number[];
  score: number;
  kind?: string;
}

export function reconcile(
  newHash: string,
  newVector: number[],
  candidates: ExistingMatch[],
  newKind?: string,
): ReconcileResult {
  // Check for exact hash match first
  for (const candidate of candidates) {
    if (candidate.hash === newHash) {
      return { action: 'NONE', existingId: candidate.id, existingMemory: candidate.memory };
    }
  }

  // Check cosine similarity for semantic near-duplicates and supersession
  for (const candidate of candidates) {
    const sim = cosineSimilarity(newVector, candidate.vector);
    if (sim >= SIMILARITY_THRESHOLD) {
      return { action: 'UPDATE', existingId: candidate.id, existingMemory: candidate.memory };
    }
    // Supersession: 0.7-0.92 range, same kind
    if (sim >= SUPERSESSION_LOWER && newKind && candidate.kind && newKind === candidate.kind) {
      return { action: 'SUPERSEDE', existingId: candidate.id, existingMemory: candidate.memory };
    }
  }

  return { action: 'ADD' };
}
