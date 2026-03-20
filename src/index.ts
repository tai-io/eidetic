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
import { ToolHandlers } from './tools.js';
import { TOOL_DEFINITIONS } from './tool-schemas.js';
import { getSetupErrorMessage } from './setup-message.js';
import { MemoryStore } from './memory/store.js';
import { MemoryHistory } from './memory/history.js';
import { MarkdownMemoryDB } from './memory/markdown-memorydb.js';
import {
  getMemoryDbPath,
  getMemoriesDir,
  getVectorCachePath,
  getMemoryStorePath,
} from './paths.js';
import { migrateToMarkdown } from './memory/migrate-to-markdown.js';
import { BUILD_VERSION, BUILD_TIMESTAMP } from './build-info.js';

const WORKFLOW_GUIDANCE = `# Eidetic — Persistent Memory

**Memory tools (cross-session developer knowledge):**
- \`add_memory(facts=[{fact:"...", kind:"..."}])\` — stores pre-extracted facts classified by kind (fact/decision/convention/constraint/intent)
- \`search_memory(query="...")\` — find relevant memories by semantic search
- \`list_memories()\` — see all stored memories grouped by kind
- \`delete_memory(id="...")\` — remove a specific memory
- \`memory_history(id="...")\` — view change log for a memory
- Memories are automatically deduplicated — adding similar facts updates existing ones

**Persistent memory (cross-session developer knowledge):**
- \`add_memory(query="user intent", facts=[{fact:"...", kind:"..."}])\` → stores facts grouped under a query key (fact/decision/convention/constraint/intent)
- \`search_memory(query="...")\` → find relevant memories by semantic search against stored queries
- \`list_memories()\` → see all stored query groups with their facts
- \`delete_memory(id="...")\` → remove a query group and all its facts
- \`memory_history(id="...")\` → view change log for a memory
- Queries are automatically deduplicated — similar queries (cosine >= 0.92) merge their facts`;

async function main() {
  // CLI subcommand routing
  if (process.argv[2] === 'migrate') {
    const { runMigration } = await import('./memory/migrate-v3.js');
    runMigration();
    process.exit(0);
  }

  // Hooks call `npx @tai-io/eidetic hook <event>`
  if (process.argv[2] === 'hook') {
    const { runHook } = await import('./hooks/cli-router.js');
    await runHook(process.argv[3]);
    process.exit(0);
  }

  const config = loadConfig();
  console.log(`Config loaded. Model: ${config.embeddingModel}`);

  let handlers: ToolHandlers | null = null;
  let setupError: string | null = null;

  try {
    const embedding = createEmbedding(config);
    await embedding.initialize();

    // Default project for MCP server context (hooks detect project from CWD)
    const project = 'global';
    const memoriesDir = getMemoriesDir(project);
    const cachePath = getVectorCachePath(memoriesDir);

    // Auto-migrate from SQLite if old memorystore.db exists
    migrateToMarkdown(getMemoryStorePath(), memoriesDir, cachePath);

    const memorydb = new MarkdownMemoryDB(memoriesDir, cachePath);
    const memoryHistory = new MemoryHistory(getMemoryDbPath());
    const memoryStore = new MemoryStore(embedding, memorydb, memoryHistory);

    handlers = new ToolHandlers(memoryStore);
    console.log('Memory system initialized (markdown-backed).');
  } catch (err) {
    setupError = err instanceof Error ? err.message : String(err);
    console.warn(`Eidetic initialization failed: ${setupError}`);
    console.warn(
      'Server will start in setup-required mode. All tool calls will return setup instructions.',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- MCP SDK is loosely typed
  const server = new Server(
     
    { name: '@tai-io/eidetic', version: BUILD_VERSION },
    { capabilities: { tools: {} } },
  );

  // eslint-disable-next-line @typescript-eslint/require-await
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [...TOOL_DEFINITIONS],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Tools that work without initialization
    if (name === '__IMPORTANT') {
      return { content: [{ type: 'text' as const, text: WORKFLOW_GUIDANCE }] };
    }

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
