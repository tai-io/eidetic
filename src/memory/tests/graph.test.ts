import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryGraph } from '../graph.js';
import type { GraphTriple } from '../types.js';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('MemoryGraph', () => {
  let graph: MemoryGraph;
  let dbPath: string;

  beforeEach(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'eidetic-graph-test-'));
    dbPath = join(tmpDir, 'graph.db');
    graph = new MemoryGraph(dbPath);
  });

  const tripleA: GraphTriple = {
    source: { name: 'auth.ts', type: 'file' },
    relationship: 'contains',
    target: { name: 'validateJWT', type: 'function' },
  };

  const tripleB: GraphTriple = {
    source: { name: 'validateJWT', type: 'function' },
    relationship: 'calls',
    target: { name: 'hashPassword', type: 'function' },
  };

  const tripleC: GraphTriple = {
    source: { name: 'auth.ts', type: 'file' },
    relationship: 'imports',
    target: { name: 'bcrypt', type: 'module' },
  };

  describe('addTriples', () => {
    it('adds nodes and edges', () => {
      graph.addTriples([tripleA], 'my-project');

      const node = graph.findNode('auth.ts', 'file');
      expect(node).toBeDefined();
      expect(node!.name).toBe('auth.ts');
      expect(node!.type).toBe('file');
      expect(node!.project).toBe('my-project');
    });

    it('deduplicates nodes by name+type+project', () => {
      graph.addTriples([tripleA], 'my-project');
      graph.addTriples([tripleC], 'my-project'); // auth.ts again

      const related = graph.getRelated('auth.ts');
      // auth.ts should be one node with 2 edges
      expect(related.edges).toHaveLength(2);
    });

    it('creates separate nodes for same name in different projects', () => {
      graph.addTriples([tripleA], 'project-a');
      graph.addTriples(
        [
          {
            source: { name: 'auth.ts', type: 'file' },
            relationship: 'contains',
            target: { name: 'login', type: 'function' },
          },
        ],
        'project-b',
      );

      const nodeA = graph.findNode('auth.ts', 'file', 'project-a');
      const nodeB = graph.findNode('auth.ts', 'file', 'project-b');
      expect(nodeA).toBeDefined();
      expect(nodeB).toBeDefined();
      expect(nodeA!.id).not.toBe(nodeB!.id);
    });
  });

  describe('findNode', () => {
    it('returns undefined for non-existent node', () => {
      expect(graph.findNode('nothing')).toBeUndefined();
    });

    it('finds by name only', () => {
      graph.addTriples([tripleA], 'proj');
      expect(graph.findNode('auth.ts')).toBeDefined();
    });

    it('finds by name + type', () => {
      graph.addTriples([tripleA], 'proj');
      expect(graph.findNode('auth.ts', 'file')).toBeDefined();
      expect(graph.findNode('auth.ts', 'class')).toBeUndefined();
    });
  });

  describe('getNeighbors', () => {
    it('returns direct neighbors (depth=1)', () => {
      graph.addTriples([tripleA, tripleB, tripleC], 'proj');

      const authNode = graph.findNode('auth.ts', 'file')!;
      const neighbors = graph.getNeighbors(authNode.id);
      const names = neighbors.map((n) => n.name).sort();
      expect(names).toEqual(['bcrypt', 'validateJWT']);
    });

    it('returns multi-hop neighbors (depth=2)', () => {
      graph.addTriples([tripleA, tripleB, tripleC], 'proj');

      const authNode = graph.findNode('auth.ts', 'file')!;
      const neighbors = graph.getNeighbors(authNode.id, 2);
      const names = neighbors.map((n) => n.name).sort();
      // auth.ts → validateJWT → hashPassword, auth.ts → bcrypt
      expect(names).toEqual(['bcrypt', 'hashPassword', 'validateJWT']);
    });

    it('returns empty array for unknown node', () => {
      expect(graph.getNeighbors('nonexistent')).toEqual([]);
    });
  });

  describe('getRelated', () => {
    it('returns nodes and edges connected to an entity', () => {
      graph.addTriples([tripleA, tripleC], 'proj');

      const related = graph.getRelated('auth.ts');
      expect(related.nodes).toHaveLength(3); // auth.ts, validateJWT, bcrypt
      expect(related.edges).toHaveLength(2);
    });

    it('returns empty for unknown entity', () => {
      const related = graph.getRelated('nonexistent');
      expect(related.nodes).toHaveLength(0);
      expect(related.edges).toHaveLength(0);
    });
  });

  describe('persist and reload', () => {
    it('survives reload from disk', () => {
      graph.addTriples([tripleA, tripleB], 'proj');
      graph.persist();

      // Create a new graph instance from the same DB
      const graph2 = new MemoryGraph(dbPath);
      const node = graph2.findNode('validateJWT', 'function');
      expect(node).toBeDefined();

      const neighbors = graph2.getNeighbors(node!.id);
      const names = neighbors.map((n) => n.name).sort();
      expect(names).toEqual(['auth.ts', 'hashPassword']);
    });
  });

  describe('toJSON', () => {
    it('serializes graph state', () => {
      graph.addTriples([tripleA], 'proj');
      const json = graph.toJSON();
      expect(json.nodes).toHaveLength(2);
      expect(json.edges).toHaveLength(1);
    });
  });
});
