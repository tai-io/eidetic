import type { MemoryItem, MemoryAction } from './memory/types.js';
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
    const icon = action.event === 'ADD' ? '+' : '~';
    lines.push(`  ${icon} [${action.event}] ${action.memory}`);
    const projectTag =
      action.project && action.project !== 'global' ? ` | Project: ${action.project}` : '';
    lines.push(`    Kind: ${action.kind ?? 'unknown'} | ID: ${action.id}${projectTag}`);
    if (action.previous) {
      lines.push(`    Previous: ${action.previous}`);
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
    if (m.source) lines.push(`   Source: ${m.source}`);
    if (m.access_count > 0) {
      lines.push(`   Accessed: ${m.access_count}x | Last: ${m.last_accessed.slice(0, 10)}`);
    }
    if (m.created_at || m.updated_at) {
      lines.push(
        `   Created: ${m.created_at || 'unknown'} | Updated: ${m.updated_at || 'unknown'}`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatMemoryList(items: MemoryItem[]): string {
  if (items.length === 0) {
    return 'No memories stored yet. Use `add_memory` to store developer knowledge.';
  }

  const lines: string[] = [`Stored Memories (${items.length}):\n`];

  const grouped = new Map<string, MemoryItem[]>();
  for (const m of items) {
    const k = m.kind;
    let kindList = grouped.get(k);
    if (!kindList) {
      kindList = [];
      grouped.set(k, kindList);
    }
    kindList.push(m);
  }

  for (const [kind, memories] of grouped) {
    lines.push(`### ${kind} (${memories.length})`);
    for (const m of memories) {
      const updatedDate = m.updated_at ? ` (updated: ${m.updated_at.slice(0, 10)})` : '';
      const projectTag = m.project && m.project !== 'global' ? ` [${m.project}]` : '';
      const accessTag = m.access_count > 0 ? ` (accessed: ${m.access_count}x)` : '';
      lines.push(
        `  - ${m.memory}  [${m.id.slice(0, 8)}...]${updatedDate}${projectTag}${accessTag}`,
      );
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
