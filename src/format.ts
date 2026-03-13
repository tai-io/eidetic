import type { MemoryItem, MemoryAction, QueryWithFacts } from './memory/types.js';
import type { HistoryEntry } from './memory/history.js';

export function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function formatMemoryActions(actions: MemoryAction[]): string {
  if (actions.length === 0) {
    return 'No new facts extracted from the provided content.';
  }

  const lines: string[] = [`Processed ${actions.length} memory action(s):`, ''];

  for (const action of actions) {
    const icon = action.event === 'ADD' ? '+' : action.event === 'MERGE' ? '~' : '-';
    lines.push(`  ${icon} [${action.event}] ${action.query}`);
    const projectTag =
      action.project && action.project !== 'global' ? ` | Project: ${action.project}` : '';
    lines.push(`    Facts added: ${action.factsAdded} | ID: ${action.queryId}${projectTag}`);
    if (action.mergedInto) {
      lines.push(`    Merged into existing query: ${action.mergedInto}`);
    }
  }

  return lines.join('\n');
}

export function formatMemorySearchResults(items: MemoryItem[], query: string): string {
  if (items.length === 0) {
    return `No memories found for "${query}".`;
  }

  const lines: string[] = [`Found ${items.length} memory(ies) for "${query}":\n`];

  for (let i = 0; i < items.length; i++) {
    const m = items[i];
    lines.push(`${i + 1}. ${m.memory}`);
    const projectTag = m.project && m.project !== 'global' ? ` | Project: ${m.project}` : '';
    lines.push(`   Kind: ${m.kind} | ID: ${m.id}${projectTag}`);
    if (m.source) lines.push(`   Query: ${m.source}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function formatQueryGroupList(groups: QueryWithFacts[]): string {
  if (groups.length === 0) {
    return 'No memories stored yet. Use `add_memory` to store developer knowledge.';
  }

  const totalFacts = groups.reduce((sum, g) => sum + g.facts.length, 0);
  const lines: string[] = [`Stored Memories: ${groups.length} queries, ${totalFacts} facts\n`];

  for (const group of groups) {
    const projectTag =
      group.query.project && group.query.project !== 'global' ? ` [${group.query.project}]` : '';
    lines.push(`### ${group.query.query_text}${projectTag}`);
    lines.push(`ID: ${group.query.id} | ${group.query.created_at.slice(0, 10)}`);
    for (const fact of group.facts) {
      lines.push(`  - [${fact.kind}] ${fact.fact_text}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatMemoryHistory(entries: HistoryEntry[], memoryId: string): string {
  if (entries.length === 0) {
    return `No history found for memory ${memoryId}.`;
  }

  const lines: string[] = [`History for memory ${memoryId} (${entries.length} event(s)):\n`];

  for (const e of entries) {
    lines.push(`  [${e.event}] ${e.created_at}`);
    if (e.new_value) lines.push(`    Value: ${e.new_value}`);
    if (e.previous_value) lines.push(`    Previous: ${e.previous_value}`);
    if (e.source) lines.push(`    Source: ${e.source}`);
    lines.push('');
  }

  return lines.join('\n');
}
