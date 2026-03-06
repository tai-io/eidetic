import { ChromaClient, type Collection, type Metadata, type Where } from 'chromadb';
import { randomUUID } from 'node:crypto';
import type {
  VectorDB,
  CodeDocument,
  HybridSearchParams,
  SearchResult,
  SymbolEntry,
} from './types.js';
import { VectorDBError } from '../errors.js';
import { rankByTermFrequency, reciprocalRankFusion } from './rrf.js';

const BATCH_SIZE = 100;

export class ChromaVectorDB implements VectorDB {
  private client: ChromaClient;

  constructor(host = 'localhost', port = 8000) {
    this.client = new ChromaClient({ host, port });
  }

  private async getCollection(name: string): Promise<Collection> {
    return this.client.getCollection({ name });
  }

  async createCollection(name: string, _dimension: number): Promise<void> {
    try {
      await this.client.getOrCreateCollection({
        name,
        configuration: {
          hnsw: { space: 'cosine' },
        },
      });
    } catch (err) {
      throw new VectorDBError(`Failed to create collection "${name}"`, err);
    }
  }

  async hasCollection(name: string): Promise<boolean> {
    try {
      const collections = await this.client.listCollections();
      return collections.some((c) => c.name === name);
    } catch {
      return false;
    }
  }

  async dropCollection(name: string): Promise<void> {
    try {
      if (await this.hasCollection(name)) {
        await this.client.deleteCollection({ name });
      }
    } catch (err) {
      throw new VectorDBError(`Failed to drop collection "${name}"`, err);
    }
  }

  async insert(name: string, documents: CodeDocument[]): Promise<void> {
    if (documents.length === 0) return;

    try {
      const collection = await this.getCollection(name);
      for (let i = 0; i < documents.length; i += BATCH_SIZE) {
        const batch = documents.slice(i, i + BATCH_SIZE);
        await collection.upsert({
          ids: batch.map((doc) => doc.id ?? randomUUID()),
          embeddings: batch.map((doc) => doc.vector as number[]),
          documents: batch.map((doc) => doc.content),
          metadatas: batch.map((doc) => ({
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
          })),
        });
      }
    } catch (err) {
      throw new VectorDBError(`Failed to insert ${documents.length} documents into "${name}"`, err);
    }
  }

  async search(name: string, params: HybridSearchParams): Promise<SearchResult[]> {
    try {
      const collection = await this.getCollection(name);
      const fetchLimit = params.limit * 2;

      const extensionWhere: Where | undefined =
        params.extensionFilter?.length
          ? { fileExtension: { $in: params.extensionFilter } }
          : undefined;

      // Dense vector search
      const denseResults = await collection.query({
        queryEmbeddings: [params.queryVector as number[]],
        nResults: fetchLimit,
        include: ['metadatas', 'distances', 'documents'],
        ...(extensionWhere ? { where: extensionWhere } : {}),
      });

      // Convert Chroma query results to the format expected by RRF
      const densePoints = (denseResults.ids[0] ?? []).map((id, idx) => ({
        id,
        // Chroma returns cosine distance; convert to similarity score (1 - distance)
        score: 1 - (denseResults.distances?.[0]?.[idx] ?? 0),
        payload: (denseResults.metadatas?.[0]?.[idx] as Record<string, unknown> | null) ?? {},
      }));

      // Text search via $contains
      const queryTerms = params.queryText.split(/\s+/).filter((t) => t.length > 2);
      let textPoints: { id: string | number; payload: Record<string, unknown> | null }[] = [];

      if (queryTerms.length > 0) {
        // Use the longest term for $contains (substring match — more specific = fewer false positives)
        const searchTerm = queryTerms.sort((a, b) => b.length - a.length)[0];
        try {
          const textResults = await collection.get({
            whereDocument: { $contains: searchTerm },
            include: ['metadatas'],
            limit: fetchLimit,
            ...(extensionWhere ? { where: extensionWhere } : {}),
          });

          textPoints = textResults.ids.map((id, idx) => ({
            id,
            payload: (textResults.metadatas?.[idx] as Record<string, unknown> | null) ?? {},
          }));
        } catch {
          // $contains can fail on empty collections or unsupported chars — fall back to dense-only
        }
      }

      const rankedTextResults = rankByTermFrequency(textPoints, params.queryText);
      return reciprocalRankFusion(densePoints, rankedTextResults, params.limit);
    } catch (err) {
      throw new VectorDBError(`Search failed in collection "${name}"`, err);
    }
  }

  async getById(
    name: string,
    id: string,
  ): Promise<{ payload: Record<string, unknown>; vector: number[] } | null> {
    try {
      const collection = await this.getCollection(name);
      const results = await collection.get({
        ids: [id],
        include: ['embeddings', 'metadatas'],
      });
      if (results.ids.length === 0) return null;
      return {
        payload: (results.metadatas[0] as Record<string, unknown>) ?? {},
        vector: results.embeddings[0] ?? [],
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
      const collection = await this.getCollection(name);
      const doc = typeof payload.content === 'string' ? payload.content : '';
      await collection.update({
        ids: [id],
        embeddings: [vector],
        metadatas: [payload as Metadata],
        documents: [doc],
      });
    } catch (err) {
      throw new VectorDBError(`Failed to update point "${id}" in "${name}"`, err);
    }
  }

  async deleteByPath(name: string, relativePath: string): Promise<void> {
    try {
      const collection = await this.getCollection(name);
      const where: Where = { relativePath: { $eq: relativePath } };
      await collection.delete({ where });
    } catch (err) {
      throw new VectorDBError(
        `Failed to delete documents for path "${relativePath}" from "${name}"`,
        err,
      );
    }
  }

  async deleteByFilter(name: string, filter: Record<string, unknown>): Promise<void> {
    try {
      const collection = await this.getCollection(name);
      const conditions = Object.entries(filter).map(
        ([key, value]) => ({ [key]: { $eq: value } }) as Where,
      );
      const where: Where = conditions.length === 1 ? conditions[0] : { $and: conditions };
      await collection.delete({ where });
    } catch (err) {
      throw new VectorDBError(`Failed to delete by filter from "${name}"`, err);
    }
  }

  async listSymbols(name: string): Promise<SymbolEntry[]> {
    try {
      const collection = await this.getCollection(name);
      const results: SymbolEntry[] = [];
      const pageSize = 1000;
      let offset = 0;

      while (true) {
        const where: Where = { symbolName: { $ne: '' } };
        const page = await collection.get({
          where,
          include: ['metadatas'],
          limit: pageSize,
          offset,
        });

        for (const meta of page.metadatas) {
          const p = (meta as Record<string, unknown>) ?? {};
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

        if (page.ids.length < pageSize) break;
        offset += pageSize;
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
      const collection = await this.getCollection(name);
      const results: { id: string | number; vector: number[]; payload: Record<string, unknown> }[] =
        [];
      const pageSize = 1000;
      let offset = 0;

      while (true) {
        const page = await collection.get({
          include: ['embeddings', 'metadatas'],
          limit: pageSize,
          offset,
        });

        for (let i = 0; i < page.ids.length; i++) {
          results.push({
            id: page.ids[i],
            vector: page.embeddings[i] ?? [],
            payload: (page.metadatas[i] as Record<string, unknown>) ?? {},
          });
        }

        if (page.ids.length < pageSize) break;
        offset += pageSize;
      }

      return results;
    } catch (err) {
      throw new VectorDBError(`Failed to scroll all points from "${name}"`, err);
    }
  }
}
