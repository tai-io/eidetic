import type { Config } from '../config.js';
import type { VectorDB } from './types.js';
import { VectorDBError } from '../errors.js';

/**
 * Dynamically import an optional vectordb provider module.
 * Uses a variable so TypeScript does not statically resolve the module
 * (providers depend on optional packages that may not be installed).
 */
async function loadProvider(name: string): Promise<Record<string, unknown>> {
  const mod: Record<string, unknown> = (await import(name)) as Record<string, unknown>;
  return mod;
}

export async function createVectorDB(config: Config): Promise<VectorDB> {
  switch (config.vectordbProvider) {
    case 'milvus': {
      try {
        const mod = await loadProvider('./milvus.js');
        const MilvusVectorDB = mod.MilvusVectorDB as new () => VectorDB;
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
        const mod = await loadProvider('./qdrant.js');
        const QdrantVectorDB = mod.QdrantVectorDB as new (
          url?: string,
          apiKey?: string,
        ) => VectorDB;
        return new QdrantVectorDB(config.qdrantUrl, config.qdrantApiKey);
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
      try {
        const mod = await loadProvider('./chroma.js');
        const ChromaVectorDB = mod.ChromaVectorDB as new () => VectorDB;
        return new ChromaVectorDB();
      } catch (err) {
        throw new VectorDBError(
          'Chroma provider selected but chromadb is not installed. ' +
            'Install it with: npm install chromadb',
          err,
        );
      }
    }
  }
}
