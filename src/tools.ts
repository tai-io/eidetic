import {
  textResult,
  formatMemoryActions,
  formatMemorySearchResults,
  formatQueryGroupList,
  formatMemoryHistory,
} from './format.js';
import type { MemoryStore } from './memory/store.js';
import type { MemoryKind } from './memory/types.js';

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ToolHandlers {
  constructor(private memoryStore: MemoryStore) {}

  async handleAddMemory(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    const query = args.query as string | undefined;
    if (!query)
      return textResult('Error: "query" is required. Provide the user question or intent.');

    const facts = args.facts as { fact: string; kind: MemoryKind }[] | undefined;
    if (!facts || !Array.isArray(facts) || facts.length === 0)
      return textResult(
        'Error: "facts" is required. Provide an array of facts with fact and kind fields.',
      );

    const project = args.project as string | undefined;

    try {
      const action = await this.memoryStore.addQueryWithFacts(query, facts, 'mcp-tool', project);
      return textResult(formatMemoryActions([action]));
    } catch (err) {
      const message = getErrorMessage(err);
      return textResult(`Error adding memory: ${message}`);
    }
  }

  async handleSearchMemory(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    const query = args.query as string | undefined;
    if (!query)
      return textResult('Error: "query" is required. Provide a natural language search query.');

    const limit = (args.limit as number | undefined) ?? 10;
    const kind = args.kind as string | undefined;
    const project = args.project as string | undefined;

    try {
      const results = await this.memoryStore.searchMemory(query, limit, kind, project);
      return textResult(formatMemorySearchResults(results, query));
    } catch (err) {
      const message = getErrorMessage(err);
      return textResult(`Error searching memories: ${message}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleListMemories(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    const kind = args.kind as string | undefined;
    const limit = (args.limit as number | undefined) ?? 50;
    const project = args.project as string | undefined;

    try {
      const results = this.memoryStore.listMemories(kind, limit, project);
      return textResult(formatQueryGroupList(results));
    } catch (err) {
      const message = getErrorMessage(err);
      return textResult(`Error listing memories: ${message}`);
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async handleDeleteMemory(
    args: Record<string, unknown>,
  ): Promise<{ content: { type: string; text: string }[] }> {
    const id = args.id as string | undefined;
    if (!id)
      return textResult('Error: "id" is required. Provide the UUID of the memory to delete.');

    try {
      const deleted = this.memoryStore.deleteMemory(id);
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
}
