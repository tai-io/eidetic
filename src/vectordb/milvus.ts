import type {
  VectorDB,
  CodeDocument,
  HybridSearchParams,
  SearchResult,
  SymbolEntry,
} from './types.js';
import { VectorDBError } from '../errors.js';
import { getConfig } from '../config.js';
import { RRF_K } from './qdrant.js';

let MilvusClient: any;
let DataType: any;
let MetricType: any;
let FunctionType: any;
let LoadState: any;

async function loadMilvusSDK() {
  try {
    const sdk = await import('@zilliz/milvus2-sdk-node');
    MilvusClient = sdk.MilvusClient;
    DataType = sdk.DataType;
    MetricType = sdk.MetricType;
    FunctionType = sdk.FunctionType;
    LoadState = sdk.LoadState;
  } catch {
    throw new VectorDBError('Milvus SDK not installed. Run: npm install @zilliz/milvus2-sdk-node');
  }
}

/**
 * Detects the "data type 104 not supported" error from older Milvus versions
 * that lack SparseFloatVector support (< v2.4).
 */
export function isSparseUnsupportedError(err: unknown): boolean {
  const msg = String(err && typeof err === 'object' && 'reason' in err ? (err as any).reason : err);
  return /data type[:\s]*104/i.test(msg) || (/not supported/i.test(msg) && msg.includes('104'));
}

export class MilvusVectorDB implements VectorDB {
  private client: any = null;
  private initPromise: Promise<void>;
  private hybridCollections = new Set<string>();

  constructor(client?: any) {
    if (client) {
      this.client = client;
      this.initPromise = Promise.resolve();
    } else {
      this.initPromise = this.initialize();
    }
  }

  private async initialize(): Promise<void> {
    await loadMilvusSDK();
    const config = getConfig();
    this.client = new MilvusClient({
      address: config.milvusAddress,
      ...(config.milvusToken ? { token: config.milvusToken } : {}),
    });
  }

  private async ready(): Promise<void> {
    await this.initPromise;
    if (!this.client) throw new VectorDBError('Milvus client not initialized');
  }

  async createCollection(name: string, dimension: number): Promise<void> {
    await this.ready();

    try {
      await this.createHybridCollection(name, dimension);
      this.hybridCollections.add(name);
      console.log(`Created hybrid collection "${name}" (dense + BM25 sparse)`);
      return;
    } catch (err) {
      if (isSparseUnsupportedError(err)) {
        console.warn(
          `Milvus does not support SparseFloatVector (requires >= v2.4). ` +
            `Falling back to dense-only collection for "${name}".`,
        );
        try {
          await this.client.dropCollection({ collection_name: name });
        } catch (cleanupErr) {
          console.warn(`Failed to clean up collection "${name}":`, cleanupErr);
        }
      } else {
        throw new VectorDBError(`Failed to create Milvus collection "${name}"`, err);
      }
    }

    try {
      await this.createDenseOnlyCollection(name, dimension);
      console.log(`Created dense-only collection "${name}"`);
    } catch (err) {
      throw new VectorDBError(`Failed to create Milvus collection "${name}"`, err);
    }
  }

  private async createHybridCollection(name: string, dimension: number): Promise<void> {
    const schema = [
      { name: 'id', data_type: DataType.VarChar, max_length: 128, is_primary_key: true },
      { name: 'content', data_type: DataType.VarChar, max_length: 65535, enable_analyzer: true },
      { name: 'vector', data_type: DataType.FloatVector, dim: dimension },
      { name: 'sparse_vector', data_type: DataType.SparseFloatVector },
      { name: 'relativePath', data_type: DataType.VarChar, max_length: 1024 },
      { name: 'startLine', data_type: DataType.Int64 },
      { name: 'endLine', data_type: DataType.Int64 },
      { name: 'fileExtension', data_type: DataType.VarChar, max_length: 32 },
      { name: 'language', data_type: DataType.VarChar, max_length: 64 },
      { name: 'fileCategory', data_type: DataType.VarChar, max_length: 32 },
      { name: 'symbolName', data_type: DataType.VarChar, max_length: 256 },
      { name: 'symbolKind', data_type: DataType.VarChar, max_length: 64 },
      { name: 'symbolSignature', data_type: DataType.VarChar, max_length: 512 },
      { name: 'parentSymbol', data_type: DataType.VarChar, max_length: 256 },
    ];

    const functions = [
      {
        name: 'content_bm25',
        type: FunctionType.BM25,
        input_field_names: ['content'],
        output_field_names: ['sparse_vector'],
        params: {},
      },
    ];

    await this.client.createCollection({
      collection_name: name,
      fields: schema,
      functions,
    });

    await this.client.createIndex({
      collection_name: name,
      field_name: 'vector',
      index_type: 'AUTOINDEX',
      metric_type: MetricType.COSINE,
    });

    await this.client.createIndex({
      collection_name: name,
      field_name: 'sparse_vector',
      index_type: 'SPARSE_INVERTED_INDEX',
      metric_type: MetricType.BM25,
    });

    await this.waitForLoad(name);
  }

  private async createDenseOnlyCollection(name: string, dimension: number): Promise<void> {
    const schema = [
      { name: 'id', data_type: DataType.VarChar, max_length: 128, is_primary_key: true },
      { name: 'content', data_type: DataType.VarChar, max_length: 65535 },
      { name: 'vector', data_type: DataType.FloatVector, dim: dimension },
      { name: 'relativePath', data_type: DataType.VarChar, max_length: 1024 },
      { name: 'startLine', data_type: DataType.Int64 },
      { name: 'endLine', data_type: DataType.Int64 },
      { name: 'fileExtension', data_type: DataType.VarChar, max_length: 32 },
      { name: 'language', data_type: DataType.VarChar, max_length: 64 },
      { name: 'fileCategory', data_type: DataType.VarChar, max_length: 32 },
      { name: 'symbolName', data_type: DataType.VarChar, max_length: 256 },
      { name: 'symbolKind', data_type: DataType.VarChar, max_length: 64 },
      { name: 'symbolSignature', data_type: DataType.VarChar, max_length: 512 },
      { name: 'parentSymbol', data_type: DataType.VarChar, max_length: 256 },
    ];

    await this.client.createCollection({
      collection_name: name,
      fields: schema,
    });

    await this.client.createIndex({
      collection_name: name,
      field_name: 'vector',
      index_type: 'AUTOINDEX',
      metric_type: MetricType.COSINE,
    });

    await this.waitForLoad(name);
  }

  async hasCollection(name: string): Promise<boolean> {
    await this.ready();
    try {
      const result = await this.client.hasCollection({ collection_name: name });
      return Boolean(result.value);
    } catch {
      return false;
    }
  }

  async dropCollection(name: string): Promise<void> {
    await this.ready();
    try {
      if (await this.hasCollection(name)) {
        await this.client.dropCollection({ collection_name: name });
      }
      this.hybridCollections.delete(name);
    } catch (err) {
      throw new VectorDBError(`Failed to drop Milvus collection "${name}"`, err);
    }
  }

  async insert(name: string, documents: CodeDocument[]): Promise<void> {
    if (documents.length === 0) return;
    await this.ready();
    await this.ensureLoaded(name);

    try {
      const data = documents.map((doc) => ({
        id: doc.id,
        content: doc.content,
        vector: doc.vector,
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
      }));

      await this.client.insert({ collection_name: name, data });
    } catch (err) {
      throw new VectorDBError(`Failed to insert into Milvus collection "${name}"`, err);
    }
  }

  async search(name: string, params: HybridSearchParams): Promise<SearchResult[]> {
    await this.ready();
    await this.ensureLoaded(name);

    const isHybrid = await this.detectHybrid(name);

    try {
      let expr: string | undefined;
      if (params.extensionFilter?.length) {
        const exts = params.extensionFilter
          .map((e) => `"${e.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
          .join(', ');
        expr = `fileExtension in [${exts}]`;
      }

      if (isHybrid) {
        return await this.hybridSearch(name, params, expr);
      }
      return await this.denseOnlySearch(name, params, expr);
    } catch (err) {
      throw new VectorDBError(`Milvus search failed in collection "${name}"`, err);
    }
  }

  private async hybridSearch(
    name: string,
    params: HybridSearchParams,
    expr?: string,
  ): Promise<SearchResult[]> {
    const limit = params.limit * 2;
    const searchParams: any = {
      collection_name: name,
      data: [
        {
          data: [params.queryVector],
          anns_field: 'vector',
          param: { nprobe: 10 },
          limit,
        },
        {
          data: params.queryText,
          anns_field: 'sparse_vector',
          param: { drop_ratio_search: 0.2 },
          limit,
        },
      ],
      limit: params.limit,
      rerank: { strategy: 'rrf', params: { k: RRF_K } },
      output_fields: [
        'id',
        'content',
        'relativePath',
        'startLine',
        'endLine',
        'fileExtension',
        'language',
        'fileCategory',
      ],
    };
    if (expr) searchParams.expr = expr;

    const result = await this.client.search(searchParams);
    return this.mapResults(result);
  }

  private async denseOnlySearch(
    name: string,
    params: HybridSearchParams,
    expr?: string,
  ): Promise<SearchResult[]> {
    const searchParams: any = {
      collection_name: name,
      data: [params.queryVector],
      limit: params.limit,
      output_fields: [
        'id',
        'content',
        'relativePath',
        'startLine',
        'endLine',
        'fileExtension',
        'language',
        'fileCategory',
      ],
    };
    if (expr) searchParams.expr = expr;

    const result = await this.client.search(searchParams);
    return this.mapResults(result);
  }

  private mapResults(result: any): SearchResult[] {
    if (!result.results?.length) return [];
    return result.results.map((r: any) => ({
      content: r.content ?? '',
      relativePath: r.relativePath ?? '',
      startLine: r.startLine ?? 0,
      endLine: r.endLine ?? 0,
      fileExtension: r.fileExtension ?? '',
      language: r.language ?? '',
      score: r.score ?? 0,
      fileCategory: r.fileCategory ?? '',
    }));
  }

  private async detectHybrid(name: string): Promise<boolean> {
    if (this.hybridCollections.has(name)) return true;

    try {
      const desc = await this.client.describeCollection({ collection_name: name });
      const fields: any[] = desc.schema?.fields ?? [];
      const hasSparse = fields.some((f: any) => f.name === 'sparse_vector');
      if (hasSparse) {
        this.hybridCollections.add(name);
      }
      return hasSparse;
    } catch {
      return false;
    }
  }

  async getById(
    name: string,
    id: string,
  ): Promise<{ payload: Record<string, unknown>; vector: number[] } | null> {
    await this.ready();
    try {
      const result = await this.client.get({
        collection_name: name,
        ids: [id],
        output_fields: ['*'],
      });
      if (!result.data?.length) return null;
      const point = result.data[0];
      return {
        payload: point as Record<string, unknown>,
        vector: point.vector ?? [],
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
    await this.ready();
    await this.ensureLoaded(name);
    try {
      await this.client.upsert({
        collection_name: name,
        data: [{ id, vector, ...payload }],
      });
    } catch (err) {
      throw new VectorDBError(`Failed to update point "${id}" in Milvus collection "${name}"`, err);
    }
  }

  async deleteByPath(name: string, relativePath: string): Promise<void> {
    await this.ready();
    await this.ensureLoaded(name);

    try {
      const escaped = relativePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      await this.client.delete({
        collection_name: name,
        filter: `relativePath == "${escaped}"`,
      });
    } catch (err) {
      throw new VectorDBError(`Failed to delete by path "${relativePath}" from "${name}"`, err);
    }
  }

  async deleteByFilter(name: string, filter: Record<string, unknown>): Promise<void> {
    await this.ready();
    await this.ensureLoaded(name);

    try {
      const clauses = Object.entries(filter).map(([key, value]) => {
        const escaped = String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `${key} == "${escaped}"`;
      });
      await this.client.delete({
        collection_name: name,
        filter: clauses.join(' && '),
      });
    } catch (err) {
      throw new VectorDBError(`Failed to delete by filter from "${name}"`, err);
    }
  }

  async listSymbols(name: string): Promise<SymbolEntry[]> {
    await this.ready();
    await this.ensureLoaded(name);

    try {
      const result = await this.client.query({
        collection_name: name,
        filter: 'symbolName != ""',
        output_fields: [
          'symbolName',
          'symbolKind',
          'relativePath',
          'startLine',
          'symbolSignature',
          'parentSymbol',
        ],
        limit: 16384,
      });

      const rows: any[] = result.data ?? [];
      return rows
        .filter((r: any) => r.symbolName)
        .map(
          (r: any): SymbolEntry => ({
            name: String(r.symbolName),
            kind: String(r.symbolKind ?? ''),
            relativePath: String(r.relativePath ?? ''),
            startLine: Number(r.startLine ?? 0),
            ...(r.symbolSignature ? { signature: String(r.symbolSignature) } : {}),
            ...(r.parentSymbol ? { parentName: String(r.parentSymbol) } : {}),
          }),
        );
    } catch (err) {
      throw new VectorDBError(`Failed to list symbols from "${name}"`, err);
    }
  }

  async scrollAll(
    name: string,
  ): Promise<{ id: string | number; vector: number[]; payload: Record<string, unknown> }[]> {
    await this.ready();
    await this.ensureLoaded(name);

    try {
      const result = await this.client.query({
        collection_name: name,
        filter: '',
        output_fields: ['*'],
        limit: 16384,
      });

      const rows: any[] = result.data ?? [];
      return rows.map((r: any) => ({
        id: String(r.id ?? ''),
        vector: r.vector ?? [],
        payload: r as Record<string, unknown>,
      }));
    } catch (err) {
      throw new VectorDBError(`Failed to scroll all points from Milvus "${name}"`, err);
    }
  }

  private async ensureLoaded(name: string): Promise<void> {
    try {
      const result = await this.client.getLoadState({ collection_name: name });
      if (result.state !== LoadState.LoadStateLoaded) {
        await this.client.loadCollection({ collection_name: name });
      }
    } catch (err) {
      console.warn(`Failed to ensure collection "${name}" is loaded:`, err);
    }
  }

  private async waitForLoad(name: string, timeoutMs = 30_000): Promise<void> {
    await this.client.loadCollection({ collection_name: name });
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const result = await this.client.getLoadState({ collection_name: name });
        if (result.state === LoadState.LoadStateLoaded) return;
      } catch (err) {
        console.warn(`Load state check failed for "${name}":`, err);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new VectorDBError(`Collection "${name}" failed to load within ${timeoutMs}ms`);
  }
}
