const READ_FILE_DESCRIPTION = `\
Read a file and return raw content without line-number overhead (~15-20% fewer tokens than built-in Read for code, more for short-line files).

Use offset and limit to page through large files. \
Add lineNumbers=true only when you need line references for editing.`;

const INDEX_DOCUMENT_DESCRIPTION = `\
Cache external documentation (from query-docs, WebFetch, etc.) for cheap semantic search later.

After fetching documentation from an external source, call this tool to store it. \
Subsequent queries about the same library will use search_documents (~20 tokens/result) \
instead of re-fetching (~5K+ tokens).

The content is split into chunks, embedded, and stored in a vector collection grouped by library. \
A TTL tracks staleness — stale docs still return results but are flagged.`;

const SEARCH_DOCUMENTS_DESCRIPTION = `\
Search cached documentation using natural language queries.

Returns results from previously cached documentation (via index_document). \
Much cheaper than re-fetching docs (~20 tokens/result vs ~5K+ tokens/fetch).

If a specific library is provided, searches only that library's collection. \
Otherwise searches across all cached documentation. Results include staleness indicators.`;

const CLEANUP_DESCRIPTION = `\
Remove orphaned vectors for files that no longer exist on disk. Lightweight alternative to re-indexing — no embedding cost.

Provide either \`path\` (absolute) or \`project\` (name). Use \`list_indexed\` to see registered projects.

Use \`dryRun=true\` first to preview which files would be cleaned without making any changes.`;

const INDEX_DESCRIPTION = `\
Index a codebase directory to enable semantic search using a configurable code splitter.

Provide either \`path\` (absolute) or \`project\` (name). Use \`list_indexed\` to see registered projects.

Usage Guidance:
- Use dryRun=true first to preview what files would be indexed and catch configuration issues before committing to a full index.
- This tool is typically used when search fails due to an unindexed codebase.
- If indexing is attempted on an already indexed path, and a conflict is detected, \
you MUST prompt the user to confirm whether to proceed with a force index.`;

const SEARCH_DESCRIPTION = `\
Search the indexed codebase using natural language queries.
Prefer over Grep for conceptual/semantic queries — returns ~20 tokens/result vs ~100+ for Grep.
Try before launching an Explore agent — faster and cheaper for understanding code.

Provide either \`path\` (absolute) or \`project\` (name). Use \`list_indexed\` to see registered projects.

When to Use:
- Code search: Find specific functions, classes, or implementations
- Context-aware assistance: Gather relevant code context before making changes
- Issue identification: Locate problematic code sections or bugs
- Code review: Understand existing implementations and patterns
- Refactoring: Find all related code pieces that need to be updated
- Feature development: Understand existing architecture and similar implementations
- Duplicate detection: Identify redundant or duplicated code patterns

If the codebase is not indexed, this tool will return a clear error message \
indicating that indexing is required first.`;

export const TOOL_DEFINITIONS = [
  {
    name: 'index_codebase',
    description: INDEX_DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the codebase directory to index.',
        },
        project: {
          type: 'string',
          description:
            'Project name (resolves via registry). Use list_indexed to see registered projects.',
        },
        force: {
          type: 'boolean',
          description: 'Force re-indexing even if already indexed',
          default: false,
        },
        dryRun: {
          type: 'boolean',
          description:
            'Preview what would be indexed without actually indexing. Returns file counts by extension, top directories, estimated cost, and warnings.',
          default: false,
        },
        customExtensions: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Additional file extensions to include beyond defaults (e.g., [".dart", ".arb"]). Extensions should include the dot prefix.',
          default: [],
        },
        customIgnorePatterns: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Additional glob patterns to exclude (e.g., ["**/Pods/**", "**/DerivedData/**"]).',
          default: [],
        },
      },
      required: [],
    },
  },
  {
    name: 'search_code',
    description: SEARCH_DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the codebase directory to search in.',
        },
        project: {
          type: 'string',
          description:
            'Project name (resolves via registry). Use list_indexed to see registered projects.',
        },
        query: {
          type: 'string',
          description: 'Natural language query to search for in the codebase',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 10,
          maximum: 50,
        },
        extensionFilter: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional: List of file extensions to filter results (e.g., [".ts", ".py"]).',
          default: [],
        },
        compact: {
          type: 'boolean',
          description:
            'Return compact table (file, lines, score, ~tokens) instead of full code snippets. Use Read tool to fetch interesting results. Default: true.',
          default: true,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'clear_index',
    description:
      'Clear the search index. Provide either `path` (absolute) or `project` (name). Use `list_indexed` to see registered projects.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the codebase directory to clear.',
        },
        project: {
          type: 'string',
          description:
            'Project name (resolves via registry). Use list_indexed to see registered projects.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_indexing_status',
    description:
      'Get the current indexing status of a codebase. Provide either `path` (absolute) or `project` (name). Use `list_indexed` to see registered projects.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the codebase directory to check status for.',
        },
        project: {
          type: 'string',
          description:
            'Project name (resolves via registry). Use list_indexed to see registered projects.',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_indexed',
    description:
      'List all currently indexed codebases with their status. Returns paths, file/chunk counts, and indexing status for all known codebases in this session.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'cleanup_vectors',
    description: CLEANUP_DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the codebase directory.',
        },
        project: {
          type: 'string',
          description:
            'Project name (resolves via registry). Use list_indexed to see registered projects.',
        },
        dryRun: {
          type: 'boolean',
          description: 'List files that would be cleaned without actually deleting any vectors.',
          default: false,
        },
      },
      required: [],
    },
  },
  {
    name: 'index_document',
    description: INDEX_DOCUMENT_DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The full text content of the documentation to cache.',
        },
        source: {
          type: 'string',
          description:
            'Source URL or identifier (e.g., "https://docs.langfuse.com/guides/evaluators" or "context7:langfuse/hooks").',
        },
        library: {
          type: 'string',
          description: 'Library name (e.g., "react", "langfuse"). Used for collection grouping.',
        },
        topic: {
          type: 'string',
          description: 'Topic within the library (e.g., "hooks", "evaluators").',
        },
        ttlDays: {
          type: 'number',
          description: 'Days before the cached content is considered stale.',
          default: 7,
        },
      },
      required: ['content', 'source', 'library', 'topic'],
    },
  },
  {
    name: 'search_documents',
    description: SEARCH_DOCUMENTS_DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query to search cached documentation.',
        },
        library: {
          type: 'string',
          description:
            'Optional: limit search to a specific library (e.g., "langfuse"). Omit to search all cached docs.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return.',
          default: 5,
          maximum: 20,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_file',
    description: READ_FILE_DESCRIPTION,
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute file path to read.',
        },
        offset: {
          type: 'number',
          description: '1-based line number to start reading from.',
          default: 1,
        },
        limit: {
          type: 'number',
          description: 'Maximum number of lines to return.',
          default: 5000,
          maximum: 10000,
        },
        lineNumbers: {
          type: 'boolean',
          description:
            'Prefix each line with its line number. Only enable when you need line references for editing.',
          default: false,
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'add_memory',
    description:
      'Store pre-extracted developer knowledge facts. Before calling, extract facts yourself from the relevant content. Each fact should be a concise, self-contained statement classified by kind: fact (verifiable info), decision (rationale), convention (patterns), constraint (hard limits), or intent (planned). Automatically deduplicates against existing memories.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        facts: {
          type: 'array',
          description:
            'Array of facts to store. Extract these yourself before calling. Each fact must be a concise, self-contained statement.',
          items: {
            type: 'object',
            properties: {
              fact: {
                type: 'string',
                description:
                  'A concise, self-contained statement of a developer preference or convention.',
              },
              kind: {
                type: 'string',
                description:
                  'Memory kind: fact (verifiable info), decision (rationale-bearing), convention (patterns/rules), constraint (hard limits), or intent (planned/future).',
                enum: ['fact', 'decision', 'convention', 'constraint', 'intent'],
              },
              valid_at: {
                type: 'string',
                description:
                  'ISO timestamp for when this fact was true (e.g., when a decision was made). Defaults to now if not provided.',
              },
            },
            required: ['fact', 'kind'],
          },
        },
        source: {
          type: 'string',
          description:
            'Optional source identifier (e.g., "conversation", "claude-code", "user-note").',
        },
        project: {
          type: 'string',
          description:
            'Optional project name to scope this memory (e.g., "my-app"). Defaults to "global" for cross-project memories.',
        },
      },
      required: ['facts'],
    },
  },
  {
    name: 'search_memory',
    description:
      'Search stored developer memories using natural language. Returns semantically similar memories ranked by relevance. When a project is specified, project-specific memories are ranked higher.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language query to search memories.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results.',
          default: 10,
          maximum: 50,
        },
        kind: {
          type: 'string',
          description: 'Filter by kind: fact, decision, convention, constraint, or intent.',
          enum: ['fact', 'decision', 'convention', 'constraint', 'intent'],
        },
        project: {
          type: 'string',
          description:
            'Optional project name to boost project-specific memories in results (e.g., "my-app"). Cross-project memories still appear but ranked lower.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_memories',
    description: 'List all stored developer memories, optionally filtered by kind or project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        kind: {
          type: 'string',
          description: 'Filter by kind: fact, decision, convention, constraint, or intent.',
          enum: ['fact', 'decision', 'convention', 'constraint', 'intent'],
        },
        limit: {
          type: 'number',
          description: 'Maximum number of memories to return.',
          default: 50,
          maximum: 100,
        },
        project: {
          type: 'string',
          description:
            'Optional project name to filter memories. Returns only project-specific and global memories.',
        },
      },
      required: [],
    },
  },
  {
    name: 'delete_memory',
    description: 'Delete a specific memory by its ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'The UUID of the memory to delete.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_history',
    description: 'View the change history for a specific memory (additions, updates, deletions).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'The UUID of the memory to view history for.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'browse_structure',
    description:
      'Show a condensed structural map of the indexed codebase — classes, functions, methods with signatures, grouped by file.\nPrefer over Glob + Read cascades for understanding architecture — one call vs many.\n\nProvide either `path` (absolute) or `project` (name). Use `list_indexed` to see registered projects.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the codebase directory.',
        },
        project: {
          type: 'string',
          description:
            'Project name (resolves via registry). Use list_indexed to see registered projects.',
        },
        pathFilter: {
          type: 'string',
          description: 'Glob pattern to filter by file path (e.g., "src/core/**", "**/*.ts").',
        },
        kind: {
          type: 'string',
          description:
            'Filter by symbol kind: function, class, interface, method, type, enum, etc.',
        },
        maxTokens: {
          type: 'number',
          description:
            'Approximate token budget for the output (1 token ≈ 4 chars). Default: 4000.',
          default: 4000,
        },
      },
      required: [],
    },
  },
  {
    name: 'list_symbols',
    description:
      'List symbols (functions, classes, methods, etc.) from the indexed codebase as a compact table. Supports filtering by name, kind, or path.\n\nProvide either `path` (absolute) or `project` (name). Use `list_indexed` to see registered projects.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to the codebase directory.',
        },
        project: {
          type: 'string',
          description:
            'Project name (resolves via registry). Use list_indexed to see registered projects.',
        },
        pathFilter: {
          type: 'string',
          description: 'Glob pattern to filter by file path (e.g., "src/core/**").',
        },
        kind: {
          type: 'string',
          description:
            'Filter by symbol kind: function, class, interface, method, type, enum, etc.',
        },
        nameFilter: {
          type: 'string',
          description: 'Substring filter on symbol name (case-insensitive).',
        },
      },
      required: [],
    },
  },
  {
    name: 'browse_graph',
    description:
      'Explore the knowledge graph of entity relationships extracted from memory consolidation.\nShows how code entities (files, functions, classes) and knowledge entities (decisions, conventions) relate to each other.\n\nOptionally filter by entity name, type, or project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        entity: {
          type: 'string',
          description: 'Entity name to explore (e.g., "auth.ts", "validateJWT").',
        },
        type: {
          type: 'string',
          description:
            'Filter by node type: file, function, class, module, decision, convention, constraint, project.',
        },
        project: {
          type: 'string',
          description: 'Filter by project name.',
        },
      },
      required: [],
    },
  },
  {
    name: '__IMPORTANT',
    description:
      'Workflow guidance for efficient code search. ALWAYS index before searching. Use project names after first index. Use extensionFilter to narrow results.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
] as const;
