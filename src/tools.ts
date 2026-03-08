import nodePath from 'node:path';
import { normalizePath } from './paths.js';
import { clusterCodeChunks, storeRaptorSummaries } from './knowledge/raptor.js';
import { resolveProject, listProjects } from './state/registry.js';
import type { Embedding } from './embedding/types.js';
import type { VectorDB } from './vectordb/types.js';
import {
  textResult,
  formatMemoryActions,
  formatMemorySearchResults,
  formatMemoryList,
  formatMemoryHistory,
} from './format.js';
import type { MemoryStore } from './memory/store.js';
import type { MemoryKind } from './memory/types.js';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function resolvePath(args: Record<string, unknown>): string | undefined {
  const pathArg = args.path as string | undefined;
  if (pathArg) return normalizePath(pathArg);

  const projectArg = args.project as string | undefined;
  if (projectArg) return resolveProject(projectArg);

  // No fallback to process.cwd() — meaningless for MCP server
  return undefined;
}

function noPathError(): { content: { type: string; text: string }[] } {
  const projects = listProjects();
  const names = Object.keys(projects);
  if (names.length > 0) {
    const list = names.map((n) => `  - ${n} → ${projects[n]}`).join('\n');
    return textResult(`Error: provide \`path\` or \`project\`. Registered projects:\n${list}`);
  }
  return textResult(
    'Error: provide `path` (absolute) or `project` (name). No projects registered yet.',
  );
}

export class ToolHandlers {
  private memoryStore: MemoryStore | null = null;
  private memoryGraph: import('./memory/graph.js').MemoryGraph | null = null;

  constructor(
    private embedding: Embedding,
    private vectordb: VectorDB,
  ) {}

  setMemoryStore(store: MemoryStore): void {
    this.memoryStore = store;
  }

  setMemoryGraph(graph: import('./memory/graph.js').MemoryGraph): void {
    this.memoryGraph = graph;
    if (this.memoryStore) {
      this.memoryStore.setGraph(graph);
    }
  }

  async handleAddMemory(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    if (!this.memoryStore) return textResult('Error: Memory system not initialized.');

    const facts = args.facts as { fact: string; kind: MemoryKind; valid_at?: string }[] | undefined;
    if (!facts || !Array.isArray(facts) || facts.length === 0)
      return textResult(
        'Error: "facts" is required. Provide an array of pre-extracted facts with fact and kind fields.',
      );

    const source = args.source as string | undefined;
    const project = args.project as string | undefined;

    try {
      const actions = await this.memoryStore.addMemory(facts, source, project);
      return textResult(formatMemoryActions(actions));
    } catch (err) {
      const message = getErrorMessage(err);
      return textResult(`Error adding memory: ${message}`);
    }
  }

  async handleSearchMemory(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    if (!this.memoryStore) return textResult('Error: Memory system not initialized.');

    const query = args.query as string | undefined;
    if (!query)
      return textResult('Error: "query" is required. Provide a natural language search query.');

    const limit = (args.limit as number | undefined) ?? 10;
    const kind = args.kind as string | undefined;
    const project = args.project as string | undefined;

    try {
      const result = await this.memoryStore.searchMemoryWithGraph(query, limit, kind, project);
      let output = formatMemorySearchResults(result.memories, query);
      if (result.relations && result.relations.length > 0) {
        output += '\n\n## Related Entities\n';
        for (const rel of result.relations) {
          output += `- ${rel.source} —[${rel.relationship}]→ ${rel.target}\n`;
        }
      }
      return textResult(output);
    } catch (err) {
      const message = getErrorMessage(err);
      return textResult(`Error searching memories: ${message}`);
    }
  }

  async handleListMemories(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    if (!this.memoryStore) return textResult('Error: Memory system not initialized.');

    const kind = args.kind as string | undefined;
    const limit = (args.limit as number | undefined) ?? 50;
    const project = args.project as string | undefined;

    try {
      const results = await this.memoryStore.listMemories(kind, limit, project);
      return textResult(formatMemoryList(results));
    } catch (err) {
      const message = getErrorMessage(err);
      return textResult(`Error listing memories: ${message}`);
    }
  }

  async handleDeleteMemory(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    if (!this.memoryStore) return textResult('Error: Memory system not initialized.');

    const id = args.id as string | undefined;
    if (!id)
      return textResult('Error: "id" is required. Provide the UUID of the memory to delete.');

    try {
      const deleted = await this.memoryStore.deleteMemory(id);
      if (!deleted) return textResult(`Memory not found: ${id}`);
      return textResult(`Memory deleted: ${id}`);
    } catch (err) {
      const message = getErrorMessage(err);
      return textResult(`Error deleting memory: ${message}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleMemoryHistory(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    if (!this.memoryStore) return textResult('Error: Memory system not initialized.');

    const id = args.id as string | undefined;
    if (!id)
      return textResult(
        'Error: "id" is required. Provide the UUID of the memory to view history for.',
      );

    try {
      const entries = this.memoryStore.getHistory(id);
      return textResult(formatMemoryHistory(entries, id));
    } catch (err) {
      const message = getErrorMessage(err);
      return textResult(`Error retrieving memory history: ${message}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleBrowseGraph(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    if (!this.memoryGraph) {
      return textResult('Knowledge graph not initialized. No graph data available yet.');
    }

    const entity = args.entity as string | undefined;
    const typeFilter = args.type as string | undefined;
    const projectFilter = args.project as string | undefined;

    if (entity) {
      const node = this.memoryGraph.findNode(
        entity,
        typeFilter as import('./memory/types.js').NodeType | undefined,
        projectFilter,
      );
      if (!node) return textResult(`No entity found: "${entity}"`);

      const related = this.memoryGraph.getRelated(entity);
      let output = `## ${node.name} (${node.type})\n`;
      output += `Project: ${node.project}\n\n`;

      if (related.edges.length > 0) {
        output += '### Relationships\n';
        for (const edge of related.edges) {
          const source = related.nodes.find((n) => n.id === edge.sourceId);
          const target = related.nodes.find((n) => n.id === edge.targetId);
          if (source && target) {
            output += `- ${source.name} —[${edge.relationship}]→ ${target.name}\n`;
          }
        }
      } else {
        output += 'No relationships found.\n';
      }

      return textResult(output);
    }

    // No entity specified — show summary
    const json = this.memoryGraph.toJSON();
    let nodes = json.nodes;
    if (typeFilter) nodes = nodes.filter((n) => n.type === typeFilter);
    if (projectFilter) nodes = nodes.filter((n) => n.project === projectFilter);

    let output = `## Knowledge Graph Summary\n`;
    output += `Nodes: ${json.nodes.length} | Edges: ${json.edges.length}\n\n`;

    // Group by type
    const byType = new Map<string, string[]>();
    for (const node of nodes) {
      const list = byType.get(node.type) ?? [];
      list.push(node.name);
      byType.set(node.type, list);
    }

    for (const [type, names] of byType) {
      output += `### ${type} (${names.length})\n`;
      output += names.slice(0, 20).join(', ');
      if (names.length > 20) output += `, ... (+${names.length - 20} more)`;
      output += '\n\n';
    }

    return textResult(output);
  }

  async handleRaptorCluster(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    const normalizedPath = resolvePath(args);
    if (!normalizedPath) return noPathError();
    const project = (args.project as string | undefined) ?? nodePath.basename(normalizedPath);

    try {
      const collectionName = `eidetic_${project}_code`;
      const result = await clusterCodeChunks(project, collectionName, this.vectordb);
      if (result.clusters.length === 0) {
        return textResult(
          `No clusters generated (${result.totalPoints} points — need at least 3). Index more code first.`,
        );
      }

      const cached = result.clusters.filter((c) => c.cachedSummary).length;
      const uncached = result.clusters.length - cached;

      let output = `## RAPTOR Clusters\n\n`;
      output += `**${result.clusters.length}** clusters from **${result.totalPoints}** code chunks\n`;
      output += `- ${cached} cached (no summarization needed)\n`;
      output += `- ${uncached} uncached (need LLM summarization)\n\n`;

      for (const cluster of result.clusters) {
        output += `### Cluster \`${cluster.clusterId}\``;
        if (cluster.cachedSummary) {
          output += ` ✓ cached\n`;
          output += `> ${cluster.cachedSummary}\n\n`;
        } else {
          output += ` — needs summary\n`;
          output += `Files: ${[...new Set(cluster.chunks.map((c) => c.file))].join(', ')}\n`;
          output += `<details><summary>${cluster.chunks.length} chunks</summary>\n\n`;
          for (const chunk of cluster.chunks) {
            output += `**${chunk.file}:${chunk.lines}**\n\`\`\`\n${chunk.content.slice(0, 500)}\n\`\`\`\n\n`;
          }
          output += `</details>\n\n`;
        }
      }

      return textResult(output);
    } catch (err) {
      const message = getErrorMessage(err);
      return textResult(`Error clustering: ${message}`);
    }
  }

  async handleRaptorStoreSummaries(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    const normalizedPath = resolvePath(args);
    if (!normalizedPath) return noPathError();
    const project = (args.project as string | undefined) ?? nodePath.basename(normalizedPath);

    const summaries = args.summaries as { clusterId: string; summary: string }[] | undefined;
    if (!summaries || !Array.isArray(summaries) || summaries.length === 0) {
      return textResult(
        'Error: "summaries" is required. Provide an array of {clusterId, summary} objects.',
      );
    }

    try {
      const result = await storeRaptorSummaries(
        project,
        summaries,
        this.embedding,
        this.vectordb,
      );

      let output = `## RAPTOR Summaries Stored\n\n`;
      output += `- **${result.stored}** summaries embedded and stored in knowledge collection\n`;
      output += `- Global concepts replication: ${result.replicatedToGlobal ? 'success' : 'skipped/failed'}\n`;
      output += `\nKnowledge summaries are now searchable via \`search_memory\`.`;

      return textResult(output);
    } catch (err) {
      const message = getErrorMessage(err);
      return textResult(`Error storing summaries: ${message}`);
    }
  }
}
