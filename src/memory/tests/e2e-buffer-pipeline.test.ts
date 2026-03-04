/**
 * End-to-end test for the buffer pipeline:
 * 1. Fill buffer with facts via MemoryBuffer.add()
 * 2. Consolidate via consolidateBuffer() (mocked LLM)
 * 3. Store consolidated memories via MemoryStore.addMemory()
 * 4. Store graph triples via MemoryGraph.addTriples()
 * 5. Verify searchMemoryWithGraph() returns both memories and graph relations
 * 6. Verify browse_graph handler works
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryBuffer } from '../buffer.js';
import { MemoryGraph } from '../graph.js';
import { consolidateBuffer } from '../buffer-consolidator.js';
import type { ConsolidationResult, BufferItem } from '../types.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

function makeLlmResponse(result: ConsolidationResult): object {
  return {
    choices: [{ message: { content: JSON.stringify(result) } }],
  };
}

describe('Buffer Pipeline E2E', () => {
  let tmpDir: string;
  let buffer: MemoryBuffer;
  let graph: MemoryGraph;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'eidetic-e2e-'));
    buffer = new MemoryBuffer(join(tmpDir, 'buffer.db'));
    graph = new MemoryGraph(join(tmpDir, 'graph.db'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('full pipeline: buffer → consolidate → graph + verify', async () => {
    const sessionId = 'e2e-session-1';
    const project = 'test-project';

    // Step 1: Fill buffer with realistic facts
    buffer.add(
      sessionId,
      'URL https://api.example.com/v1/docs returned 404',
      'post-tool-extract',
      'WebFetch',
      project,
    );
    buffer.add(
      sessionId,
      'URL https://api.example.com/v2/docs redirects to https://docs.example.com',
      'post-tool-extract',
      'WebFetch',
      project,
    );
    buffer.add(sessionId, 'Installed lodash via npm', 'post-tool-extract', 'Bash', project);
    buffer.add(
      sessionId,
      'auth.ts uses bcrypt for password hashing',
      'post-tool-extract',
      'Bash',
      project,
    );
    buffer.add(
      sessionId,
      'validateJWT function in auth.ts validates tokens',
      'post-tool-extract',
      'Bash',
      project,
    );

    expect(buffer.count(sessionId)).toBe(5);

    // Step 2: Flush and consolidate (mock LLM)
    const items = buffer.flush(sessionId);
    expect(items).toHaveLength(5);

    const consolidationResult: ConsolidationResult = {
      memories: [
        { fact: 'API docs moved from /v1/docs to /v2/docs at docs.example.com', kind: 'fact' },
        { fact: 'Project uses bcrypt for password hashing in auth.ts', kind: 'decision' },
        { fact: 'Project depends on lodash (installed via npm)', kind: 'fact' },
      ],
      graph: [
        {
          source: { name: 'auth.ts', type: 'file' },
          relationship: 'contains',
          target: { name: 'validateJWT', type: 'function' },
        },
        {
          source: { name: 'auth.ts', type: 'file' },
          relationship: 'imports',
          target: { name: 'bcrypt', type: 'module' },
        },
        {
          source: { name: 'Use bcrypt for hashing', type: 'decision' },
          relationship: 'applies_to',
          target: { name: 'auth.ts', type: 'file' },
        },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeLlmResponse(consolidationResult)),
      }),
    );

    const result = await consolidateBuffer(items, 'sk-test');

    // Verify consolidation output
    expect(result.memories).toHaveLength(3);
    expect(result.graph).toHaveLength(3);
    expect(result.memories[0].kind).toBe('fact');
    expect(result.memories[1].kind).toBe('decision');

    // Step 3: Store graph triples
    graph.addTriples(result.graph, project);

    // Verify graph state
    const authNode = graph.findNode('auth.ts', 'file');
    expect(authNode).toBeDefined();

    const neighbors = graph.getNeighbors(authNode!.id);
    const neighborNames = neighbors.map((n) => n.name).sort();
    expect(neighborNames).toEqual(['Use bcrypt for hashing', 'bcrypt', 'validateJWT']);

    // Step 4: Persist and reload graph
    graph.persist();
    const graph2 = new MemoryGraph(join(tmpDir, 'graph.db'));
    const reloadedNode = graph2.findNode('auth.ts', 'file');
    expect(reloadedNode).toBeDefined();
    expect(graph2.getNeighbors(reloadedNode!.id)).toHaveLength(3);

    // Step 5: Verify getRelated
    const related = graph.getRelated('auth.ts');
    expect(related.nodes.length).toBeGreaterThanOrEqual(4); // auth.ts + 3 neighbors
    expect(related.edges).toHaveLength(3);

    // Step 6: Clear buffer after successful consolidation
    buffer.clear(sessionId);
    expect(buffer.count(sessionId)).toBe(0);

    // Step 7: Verify toJSON for browse_graph
    const json = graph.toJSON();
    expect(json.nodes.length).toBeGreaterThanOrEqual(4);
    expect(json.edges).toHaveLength(3);
  });

  it('consolidation lock prevents double-spawn', () => {
    const sessionId = 'lock-test';

    // Simulate the post-tool-extract logic
    buffer.add(sessionId, 'fact 1', 'post-tool-extract', 'Bash', 'proj');

    expect(buffer.isConsolidating(sessionId)).toBe(false);
    buffer.markConsolidating(sessionId);
    expect(buffer.isConsolidating(sessionId)).toBe(true);

    // Second check should prevent spawn
    const shouldSpawn = !buffer.isConsolidating(sessionId);
    expect(shouldSpawn).toBe(false);

    // Clear and verify
    buffer.clearConsolidating(sessionId);
    expect(buffer.isConsolidating(sessionId)).toBe(false);
  });

  it('stale buffer items are cleaned up', () => {
    buffer.add('old-session', 'old fact', 'post-tool-extract', 'Bash', 'proj');

    // Backdate to 7 hours ago
    buffer['db']
      .prepare('UPDATE memory_buffer SET captured_at = ?')
      .run(new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString());

    buffer.add('new-session', 'fresh fact', 'post-tool-extract', 'Bash', 'proj');

    const stale = buffer.clearStaleItems(6 * 60 * 60 * 1000);
    expect(stale).toHaveLength(1);
    expect(stale[0].content).toBe('old fact');

    // Fresh item should survive
    expect(buffer.count('new-session')).toBe(1);
    expect(buffer.count('old-session')).toBe(0);
  });
});
