export const TOOL_DEFINITIONS = [
  {
    name: 'add_memory',
    description:
      'Store developer knowledge as a query with associated facts. The query is the user intent or question that prompted learning these facts. Facts are grouped under the query and automatically deduplicated against existing memories (queries with cosine similarity ≥ 0.92 are merged).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'The user question or intent that prompted these facts (e.g., "How does auth work in this project?"). This becomes the search key.',
        },
        facts: {
          type: 'array',
          description:
            'Array of facts learned while addressing the query. Each fact must be a concise, self-contained statement.',
          items: {
            type: 'object',
            properties: {
              fact: {
                type: 'string',
                description: 'A concise, self-contained statement of developer knowledge.',
              },
              kind: {
                type: 'string',
                description:
                  'Memory kind: fact (verifiable info), decision (rationale-bearing), convention (patterns/rules), constraint (hard limits), or intent (planned/future).',
                enum: ['fact', 'decision', 'convention', 'constraint', 'intent'],
              },
            },
            required: ['fact', 'kind'],
          },
        },
        project: {
          type: 'string',
          description:
            'Optional project name to scope this memory (e.g., "my-app"). Defaults to "global" for cross-project memories.',
        },
      },
      required: ['query', 'facts'],
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
    description: 'Delete a memory query group and all its associated facts by query ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'The UUID of the query group to delete (cascades to all associated facts).',
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
