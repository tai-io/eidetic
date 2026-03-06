#!/usr/bin/env node

// CRITICAL: Redirect console outputs to stderr BEFORE any imports
// Only MCP protocol messages should go to stdout
console.log = (...args: unknown[]) => {
  process.stderr.write('[LOG] ' + args.join(' ') + '\n');
};
console.warn = (...args: unknown[]) => {
  process.stderr.write('[WARN] ' + args.join(' ') + '\n');
};

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { loadConfig } from './config.js';
import { createEmbedding } from './embedding/factory.js';
import { createVectorDB } from './vectordb/factory.js';
import { StateManager, cleanupOrphanedSnapshots } from './state/snapshot.js';
import { listProjects } from './state/registry.js';
import { ToolHandlers, handleReadFile } from './tools.js';
import { TOOL_DEFINITIONS } from './tool-schemas.js';
import { getSetupErrorMessage } from './setup-message.js';
import { MemoryStore } from './memory/store.js';
import { MemoryHistory } from './memory/history.js';
import { getMemoryDbPath } from './paths.js';
import { BUILD_VERSION, BUILD_TIMESTAMP } from './build-info.js';

const GETTING_STARTED = `# Eidetic — Getting Started

1. \`index_codebase(path="...")\` — index this codebase (one-time, ~30s)
2. \`search_code(query="how does X work")\` — search by meaning
3. That's it. Use \`/index\` for a guided walkthrough.`;

const WORKFLOW_GUIDANCE = `# Eidetic Code Search Workflow

**Before searching:** Ensure the codebase is indexed.
- \`list_indexed\` → see what's already indexed
- \`index_codebase(path="...", dryRun=true)\` → preview before indexing
- \`index_codebase(path="...")\` → index (incremental, only re-embeds changed files)

**Searching efficiently:**
- \`search_code(query="...")\` → returns compact table by default (~20 tokens/result)
- Review the table, then use Read tool to fetch full code for interesting results
- Add \`compact=false\` only when you need all code snippets immediately
- Use \`extensionFilter\` to narrow by file type
- Use \`project\` param instead of \`path\` for convenience
- Start with specific queries, broaden if no results

**Reading files efficiently:**
- \`read_file(path="...")\` → raw content without line-number overhead (~15-20% fewer tokens for code, more for short-line files)
- Use \`offset\` and \`limit\` to page through large files
- Add \`lineNumbers=true\` only when you need line references for editing

**After first index:**
- Re-indexing is incremental (only changed files re-embedded)
- Use \`project\` param instead of \`path\` for convenience
- Use \`get_indexing_status\` to check progress during long indexes
- Use \`cleanup_vectors(path="...", dryRun=true)\` to preview stale vectors, then without dryRun to remove them (no embedding cost)

**Cross-project search:**
- Index multiple projects, each with its own path
- Search across any indexed project regardless of current working directory

**Documentation caching (saves ~5K tokens per repeated doc fetch):**
- After fetching docs via query-docs or WebFetch, cache them: \`index_document(content="...", source="<url>", library="<name>", topic="<topic>")\`
- Next time you need the same docs: \`search_documents(query="...", library="<name>")\` (~20 tokens/result)
- Docs are grouped by library — one collection per library, searchable across topics
- Stale docs (past TTL) still return results but are flagged \`[STALE]\`

**Persistent memory (cross-session developer knowledge):**
- \`add_memory(facts=[{fact:"...", kind:"..."}])\` → stores pre-extracted facts classified by kind (fact/decision/convention/constraint/intent)
- \`search_memory(query="...")\` → find relevant memories by semantic search
- \`list_memories()\` → see all stored memories grouped by kind
- \`delete_memory(id="...")\` → remove a specific memory
- \`memory_history(id="...")\` → view change log for a memory
- Memories are automatically deduplicated — adding similar facts updates existing ones`;

async function main() {
  const config = loadConfig();
  console.log(
    `Config loaded. Provider: ${config.vectordbProvider}, Model: ${config.embeddingModel}`,
  );

  let handlers: ToolHandlers | null = null;
  let setupError: string | null = null;

  try {
    const embedding = createEmbedding(config);
    await embedding.initialize();

    const vectordb = await createVectorDB(config);
    console.log(`Using ${config.vectordbProvider} vector database.`);

    const cleaned = await cleanupOrphanedSnapshots(vectordb);
    if (cleaned > 0) {
      console.log(`Cleaned ${cleaned} orphaned snapshot(s).`);
    }

    const state = new StateManager();
    const hydrated = await state.hydrate(listProjects(), vectordb);
    if (hydrated > 0) {
      console.log(`Hydrated ${hydrated} project(s) from registry.`);
    }
    handlers = new ToolHandlers(embedding, vectordb, state);

    // Initialize memory subsystem
    try {
      const memoryHistory = new MemoryHistory(getMemoryDbPath());
      const memoryStore = new MemoryStore(embedding, vectordb, memoryHistory);
      handlers.setMemoryStore(memoryStore);

      // Initialize graph memory (non-fatal)
      try {
        const { MemoryGraph } = await import('./memory/graph.js');
        const { getBufferDbPath } = await import('./paths.js');
        const graph = new MemoryGraph(getBufferDbPath());
        handlers.setMemoryGraph(graph);
        console.log('Knowledge graph initialized.');
      } catch (graphErr) {
        console.warn(
          `Knowledge graph init failed (non-fatal): ${graphErr instanceof Error ? graphErr.message : String(graphErr)}`,
        );
      }

      console.log('Memory system initialized.');
    } catch (memErr) {
      console.warn(
        `Memory system initialization failed: ${memErr instanceof Error ? memErr.message : String(memErr)}`,
      );
      console.warn('Memory tools will return errors. Other tools work normally.');
    }
  } catch (err) {
    setupError = err instanceof Error ? err.message : String(err);
    console.warn(`Eidetic initialization failed: ${setupError}`);
    console.warn(
      'Server will start in setup-required mode. All tool calls will return setup instructions.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-deprecated
  const server = new Server(
    { name: 'claude-eidetic', version: BUILD_VERSION },
    { capabilities: { tools: {} } },
  );

  // eslint-disable-next-line @typescript-eslint/require-await
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...TOOL_DEFINITIONS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Tools that work without initialization (no embedding/vectordb needed)
    if (name === '__IMPORTANT') {
      const hasProjects = Object.keys(listProjects()).length > 0;
      const guidance = hasProjects ? WORKFLOW_GUIDANCE : GETTING_STARTED;
      return { content: [{ type: 'text' as const, text: guidance }] };
    }
    if (name === 'read_file') return handleReadFile(args ?? {});

    if (!handlers) {
      return {
        content: [
          {
            type: 'text' as const,
            text: getSetupErrorMessage(setupError ?? 'Unknown error'),
          },
        ],
        isError: true,
      };
    }

    switch (name) {
      case 'index_codebase':
        return handlers.handleIndexCodebase(args ?? {});
      case 'search_code':
        return handlers.handleSearchCode(args ?? {});
      case 'clear_index':
        return handlers.handleClearIndex(args ?? {});
      case 'get_indexing_status':
        return handlers.handleGetIndexingStatus(args ?? {});
      case 'list_indexed':
        return handlers.handleListIndexed();
      case 'index_document':
        return handlers.handleIndexDocument(args ?? {});
      case 'search_documents':
        return handlers.handleSearchDocuments(args ?? {});
      case 'add_memory':
        return handlers.handleAddMemory(args ?? {});
      case 'search_memory':
        return handlers.handleSearchMemory(args ?? {});
      case 'list_memories':
        return handlers.handleListMemories(args ?? {});
      case 'delete_memory':
        return handlers.handleDeleteMemory(args ?? {});
      case 'memory_history':
        return handlers.handleMemoryHistory(args ?? {});
      case 'browse_graph':
        return handlers.handleBrowseGraph(args ?? {});
      case 'cleanup_vectors':
        return handlers.handleCleanupVectors(args ?? {});
      case 'browse_structure':
        return handlers.handleBrowseStructure(args ?? {});
      case 'list_symbols':
        return handlers.handleListSymbols(args ?? {});
      default:
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log(
    `Claude Eidetic MCP server v${BUILD_VERSION} (built ${BUILD_TIMESTAMP}) started on stdio.`,
  );
}

process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down...');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down...');
  process.exit(0);
});

main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
