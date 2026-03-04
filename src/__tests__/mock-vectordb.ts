import type {
  VectorDB,
  CodeDocument,
  HybridSearchParams,
  SearchResult,
  SymbolEntry,
} from '../vectordb/types.js';

export interface VectorDBCall {
  method: string;
  args: unknown[];
}

/**
 * In-memory mock VectorDB for testing.
 * Search does simple case-insensitive text matching on content.
 */
export class MockVectorDB implements VectorDB {
  readonly collections = new Map<string, { dimension: number; documents: CodeDocument[] }>();
  readonly calls: VectorDBCall[] = [];

  async createCollection(name: string, dimension: number): Promise<void> {
    this.calls.push({ method: 'createCollection', args: [name, dimension] });
    this.collections.set(name, { dimension, documents: [] });
  }

  async hasCollection(name: string): Promise<boolean> {
    this.calls.push({ method: 'hasCollection', args: [name] });
    return this.collections.has(name);
  }

  async dropCollection(name: string): Promise<void> {
    this.calls.push({ method: 'dropCollection', args: [name] });
    this.collections.delete(name);
  }

  async insert(name: string, documents: CodeDocument[]): Promise<void> {
    this.calls.push({ method: 'insert', args: [name, documents] });
    const col = this.collections.get(name);
    if (!col) throw new Error(`Collection "${name}" does not exist`);
    col.documents.push(...documents);
  }

  async search(name: string, params: HybridSearchParams): Promise<SearchResult[]> {
    this.calls.push({ method: 'search', args: [name, params] });
    const col = this.collections.get(name);
    if (!col) return [];

    const query = params.queryText.toLowerCase();
    const terms = query.split(/\s+/).filter((t) => t.length > 0);

    let docs = col.documents;

    // Apply extension filter
    if (params.extensionFilter?.length) {
      docs = docs.filter((d) => params.extensionFilter!.includes(d.fileExtension));
    }

    // Score by term match count
    const scored = docs.map((doc) => {
      const content = doc.content.toLowerCase();
      const hits = terms.filter((t) => content.includes(t)).length;
      return { doc, score: hits / Math.max(terms.length, 1) };
    });

    // Sort by score desc, take limit
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, params.limit).map(({ doc, score }) => ({
      content: doc.content,
      relativePath: doc.relativePath,
      startLine: doc.startLine,
      endLine: doc.endLine,
      fileExtension: doc.fileExtension,
      language: doc.language,
      score,
    }));
  }

  async getById(
    name: string,
    id: string,
  ): Promise<{ payload: Record<string, unknown>; vector: number[] } | null> {
    this.calls.push({ method: 'getById', args: [name, id] });
    const col = this.collections.get(name);
    if (!col) return null;
    // Search by document id or by relativePath (memory stores UUID in relativePath)
    const doc = col.documents.find((d) => d.id === id || d.relativePath === id);
    if (!doc) return null;
    return {
      payload: {
        content: doc.content,
        relativePath: doc.relativePath,
        fileExtension: doc.fileExtension,
        language: doc.language,
        startLine: doc.startLine,
        endLine: doc.endLine,
        // Preserve any extra fields stored via updatePoint
        ...(doc as unknown as Record<string, unknown>),
      },
      vector: doc.vector,
    };
  }

  async updatePoint(
    name: string,
    id: string,
    vector: number[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    this.calls.push({ method: 'updatePoint', args: [name, id, vector, payload] });
    const col = this.collections.get(name);
    if (!col) throw new Error(`Collection "${name}" does not exist`);

    // Remove existing point with same id (by relativePath for memories, or by id)
    col.documents = col.documents.filter((d) => d.id !== id && d.relativePath !== id);

    // Insert the updated point
    col.documents.push({
      id,
      content: String(payload.content ?? ''),
      vector,
      relativePath: String(payload.relativePath ?? ''),
      startLine: Number(payload.startLine ?? 0),
      endLine: Number(payload.endLine ?? 0),
      fileExtension: String(payload.fileExtension ?? ''),
      language: String(payload.language ?? ''),
      // Store extra payload fields on the document object for getById retrieval
      ...payload,
    } as CodeDocument);
  }

  async deleteByPath(name: string, relativePath: string): Promise<void> {
    this.calls.push({ method: 'deleteByPath', args: [name, relativePath] });
    const col = this.collections.get(name);
    if (!col) return;
    col.documents = col.documents.filter((d) => d.relativePath !== relativePath);
  }

  async deleteByFilter(name: string, filter: Record<string, unknown>): Promise<void> {
    this.calls.push({ method: 'deleteByFilter', args: [name, filter] });
    const col = this.collections.get(name);
    if (!col) return;
    col.documents = col.documents.filter((d) => {
      const payload = d as unknown as Record<string, unknown>;
      return !Object.entries(filter).every(([key, value]) => payload[key] === value);
    });
  }

  async listSymbols(name: string): Promise<SymbolEntry[]> {
    this.calls.push({ method: 'listSymbols', args: [name] });
    const col = this.collections.get(name);
    if (!col) return [];

    return col.documents
      .filter((d) => d.symbolName)
      .map((d) => ({
        name: d.symbolName!,
        kind: d.symbolKind ?? '',
        relativePath: d.relativePath,
        startLine: d.startLine,
        ...(d.symbolSignature ? { signature: d.symbolSignature } : {}),
        ...(d.parentSymbol ? { parentName: d.parentSymbol } : {}),
      }));
  }

  async scrollAll(
    name: string,
  ): Promise<{ id: string | number; vector: number[]; payload: Record<string, unknown> }[]> {
    this.calls.push({ method: 'scrollAll', args: [name] });
    const col = this.collections.get(name);
    if (!col) return [];
    return col.documents.map((doc) => ({
      id: doc.id,
      vector: doc.vector,
      payload: {
        content: doc.content,
        relativePath: doc.relativePath,
        startLine: doc.startLine,
        endLine: doc.endLine,
        fileExtension: doc.fileExtension,
        language: doc.language,
        ...(doc as unknown as Record<string, unknown>),
      },
    }));
  }

  /** Reset all state for test isolation */
  reset(): void {
    this.collections.clear();
    this.calls.length = 0;
  }
}
