import type { Config } from '../config.js';
import type { VectorDB } from './types.js';
import { VectorDBError } from '../errors.js';

export interface CreateVectorDBOptions {
  /** Skip auto-provisioning (e.g. Docker bootstrap). Assumes the service is already running. */
  skipBootstrap?: boolean;
}

export async function createVectorDB(
  config: Config,
  options?: CreateVectorDBOptions,
): Promise<VectorDB> {
  switch (config.vectordbProvider) {
    case 'milvus': {
      try {
        const { MilvusVectorDB } = await import('./milvus.js');
        return new MilvusVectorDB();
      } catch (err) {
        throw new VectorDBError(
          'Milvus provider selected but @zilliz/milvus2-sdk-node is not installed. ' +
            'Install it with: npm install @zilliz/milvus2-sdk-node',
          err,
        );
      }
    }
    case 'qdrant': {
      try {
        const { QdrantVectorDB } = await import('./qdrant.js');
        if (options?.skipBootstrap) {
          return new QdrantVectorDB(config.qdrantUrl, config.qdrantApiKey);
        }
        const { bootstrapQdrant } = await import('../infra/qdrant-bootstrap.js');
        const { url } = await bootstrapQdrant();
        return new QdrantVectorDB(url, config.qdrantApiKey);
      } catch (err) {
        if (err instanceof VectorDBError) throw err;
        throw new VectorDBError(
          'Qdrant provider selected but @qdrant/js-client-rest is not installed. ' +
            'Install it with: npm install @qdrant/js-client-rest',
          err,
        );
      }
    }
    case 'chroma':
    default: {
      const { ChromaVectorDB } = await import('./chroma.js');
      if (options?.skipBootstrap) {
        return new ChromaVectorDB();
      }
      const { bootstrapChroma } = await import('../infra/chroma-bootstrap.js');
      const { host, port } = await bootstrapChroma();
      return new ChromaVectorDB(host, port);
    }
  }
}
