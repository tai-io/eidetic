/**
 * Shared vector utilities for memory storage backends.
 */

export function vectorToBlob(vector: number[]): Buffer {
  const buf = Buffer.alloc(vector.length * 4);
  for (let i = 0; i < vector.length; i++) {
    buf.writeFloatLE(vector[i], i * 4);
  }
  return buf;
}

export function blobToVector(blob: Buffer): number[] {
  const count = blob.length / 4;
  const vector: number[] = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    vector[i] = blob.readFloatLE(i * 4);
  }
  return vector;
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
