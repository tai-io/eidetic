export const TOOL_DEFINITIONS = [
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
    name: 'raptor_cluster',
    description:
      'Cluster indexed code chunks using k-means. Returns clusters with their contents and any cached summaries.\n\nUse after `index_codebase` to prepare clusters for RAPTOR knowledge generation. Clusters with cached summaries can be skipped during summarization.\n\nProvide either `path` (absolute) or `project` (name). Use `list_indexed` to see registered projects.',
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
      },
      required: [],
    },
  },
  {
    name: 'raptor_store_summaries',
    description:
      'Store LLM-generated summaries for code clusters. Embeds each summary, stores in the knowledge collection, updates cache, and replicates to global concepts.\n\nCall after `raptor_cluster` with summaries generated by an LLM agent.\n\nProvide either `path` (absolute) or `project` (name). Use `list_indexed` to see registered projects.',
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
        summaries: {
          type: 'array',
          description: 'Array of cluster summaries to store.',
          items: {
            type: 'object',
            properties: {
              clusterId: {
                type: 'string',
                description: 'The cluster ID (hash) from raptor_cluster output.',
              },
              summary: {
                type: 'string',
                description: 'The LLM-generated summary for this cluster.',
              },
            },
            required: ['clusterId', 'summary'],
          },
        },
      },
      required: ['summaries'],
    },
  },
  {
    name: '__IMPORTANT',
    description:
      'Workflow guidance for persistent memory. Use add_memory to store facts, search_memory to recall them. Memories persist across sessions.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
] as const;
