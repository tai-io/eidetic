import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GraphNode, GraphEdge, GraphTriple, NodeType, RelationType } from './types.js';

interface AdjacencyEntry {
  targetId: string;
  edgeId: string;
}

export class MemoryGraph {
  private db: Database.Database;
  private nodes: Map<string, GraphNode> = new Map();
  /** Forward adjacency: nodeId → list of connected node IDs + edge IDs */
  private adjacency: Map<string, AdjacencyEntry[]> = new Map();
  /** Reverse adjacency: targetId → list of source node IDs + edge IDs */
  private reverseAdj: Map<string, AdjacencyEntry[]> = new Map();
  private edges: Map<string, GraphEdge> = new Map();
  /** Dedup key → nodeId for fast lookup: "name|type|project" */
  private nodeIndex: Map<string, string> = new Map();

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_nodes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        project TEXT NOT NULL DEFAULT 'global',
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_nodes_name ON graph_nodes(name);
      CREATE INDEX IF NOT EXISTS idx_nodes_type ON graph_nodes(type);
      CREATE INDEX IF NOT EXISTS idx_nodes_project ON graph_nodes(project);

      CREATE TABLE IF NOT EXISTS graph_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relationship TEXT NOT NULL,
        project TEXT NOT NULL DEFAULT 'global',
        metadata TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_rel ON graph_edges(relationship);
    `);

    this.migrateDropForeignKeys();
    this.loadFromDb();
  }

  addTriples(triples: GraphTriple[], project: string): void {
    const now = new Date().toISOString();

    for (const triple of triples) {
      const sourceId = this.upsertNode(triple.source.name, triple.source.type, project, now);
      const targetId = this.upsertNode(triple.target.name, triple.target.type, project, now);
      this.addEdge(sourceId, targetId, triple.relationship, project, now);
    }
  }

  findNode(name: string, type?: NodeType, project?: string): GraphNode | undefined {
    for (const node of this.nodes.values()) {
      if (node.name !== name) continue;
      if (type !== undefined && node.type !== type) continue;
      if (project !== undefined && node.project !== project) continue;
      return node;
    }
    return undefined;
  }

  getNeighbors(nodeId: string, depth: number = 1): GraphNode[] {
    if (!this.nodes.has(nodeId)) return [];

    const visited = new Set<string>([nodeId]);
    let frontier = [nodeId];

    for (let d = 0; d < depth; d++) {
      const nextFrontier: string[] = [];
      for (const current of frontier) {
        // Forward edges
        for (const entry of this.adjacency.get(current) ?? []) {
          if (!visited.has(entry.targetId)) {
            visited.add(entry.targetId);
            nextFrontier.push(entry.targetId);
          }
        }
        // Reverse edges (bidirectional traversal)
        for (const entry of this.reverseAdj.get(current) ?? []) {
          if (!visited.has(entry.targetId)) {
            visited.add(entry.targetId);
            nextFrontier.push(entry.targetId);
          }
        }
      }
      frontier = nextFrontier;
    }

    // Collect all visited except the starting node
    const result: GraphNode[] = [];
    for (const id of visited) {
      if (id === nodeId) continue;
      const node = this.nodes.get(id);
      if (node) result.push(node);
    }
    return result;
  }

  getRelated(entityName: string): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const matchingNodes = [...this.nodes.values()].filter((n) => n.name === entityName);
    if (matchingNodes.length === 0) return { nodes: [], edges: [] };

    const nodeIds = new Set<string>(matchingNodes.map((n) => n.id));
    const edgeSet = new Set<string>();

    // Collect all edges touching any matching node
    for (const nodeId of nodeIds) {
      for (const entry of this.adjacency.get(nodeId) ?? []) {
        edgeSet.add(entry.edgeId);
        nodeIds.add(entry.targetId);
      }
      for (const entry of this.reverseAdj.get(nodeId) ?? []) {
        edgeSet.add(entry.edgeId);
        nodeIds.add(entry.targetId);
      }
    }

    const nodes = [...nodeIds].map((id) => this.nodes.get(id)!).filter(Boolean);
    const edges = [...edgeSet].map((id) => this.edges.get(id)!).filter(Boolean);

    return { nodes, edges };
  }

  persist(): void {
    const insertNode = this.db.prepare(
      `INSERT OR REPLACE INTO graph_nodes (id, name, type, project, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertEdge = this.db.prepare(
      `INSERT OR REPLACE INTO graph_edges (id, source_id, target_id, relationship, project, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );

    const tx = this.db.transaction(() => {
      for (const node of this.nodes.values()) {
        insertNode.run(
          node.id,
          node.name,
          node.type,
          node.project,
          node.metadata ? JSON.stringify(node.metadata) : null,
          node.created_at,
          node.updated_at,
        );
      }
      for (const edge of this.edges.values()) {
        insertEdge.run(
          edge.id,
          edge.sourceId,
          edge.targetId,
          edge.relationship,
          edge.project,
          edge.metadata ? JSON.stringify(edge.metadata) : null,
          edge.created_at,
        );
      }
    });

    tx();
  }

  toJSON(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
    };
  }

  close(): void {
    this.db.close();
  }

  // --- Private helpers ---

  /**
   * Migrate existing DBs that have FK constraints on graph_edges.
   * Recreates the table without REFERENCES clauses.
   */
  private migrateDropForeignKeys(): void {
    // Check if the current edges table has FK constraints
    const tableInfo = this.db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='graph_edges'")
      .get() as { sql: string } | undefined;

    if (!tableInfo?.sql.includes('REFERENCES')) return;

    this.db.exec(`
      ALTER TABLE graph_edges RENAME TO graph_edges_old;
      CREATE TABLE graph_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relationship TEXT NOT NULL,
        project TEXT NOT NULL DEFAULT 'global',
        metadata TEXT,
        created_at TEXT NOT NULL
      );
      INSERT INTO graph_edges SELECT * FROM graph_edges_old;
      DROP TABLE graph_edges_old;
      CREATE INDEX IF NOT EXISTS idx_edges_source ON graph_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_edges_target ON graph_edges(target_id);
      CREATE INDEX IF NOT EXISTS idx_edges_rel ON graph_edges(relationship);
    `);
  }

  private loadFromDb(): void {
    const nodeRows = this.db.prepare('SELECT * FROM graph_nodes').all() as Array<{
      id: string;
      name: string;
      type: string;
      project: string;
      metadata: string | null;
      created_at: string;
      updated_at: string;
    }>;

    for (const row of nodeRows) {
      const node: GraphNode = {
        id: row.id,
        name: row.name,
        type: row.type as NodeType,
        project: row.project,
        metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      this.nodes.set(node.id, node);
      this.nodeIndex.set(this.dedupKey(node.name, node.type as NodeType, node.project), node.id);
    }

    const edgeRows = this.db.prepare('SELECT * FROM graph_edges').all() as Array<{
      id: string;
      source_id: string;
      target_id: string;
      relationship: string;
      project: string;
      metadata: string | null;
      created_at: string;
    }>;

    for (const row of edgeRows) {
      const edge: GraphEdge = {
        id: row.id,
        sourceId: row.source_id,
        targetId: row.target_id,
        relationship: row.relationship as RelationType,
        project: row.project,
        metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : undefined,
        created_at: row.created_at,
      };
      this.edges.set(edge.id, edge);
      this.addToAdjacency(edge.sourceId, edge.targetId, edge.id);
    }
  }

  private dedupKey(name: string, type: NodeType, project: string): string {
    return `${name}|${type}|${project}`;
  }

  private upsertNode(name: string, type: NodeType, project: string, now: string): string {
    const key = this.dedupKey(name, type, project);
    const existingId = this.nodeIndex.get(key);
    if (existingId) {
      const existing = this.nodes.get(existingId)!;
      existing.updated_at = now;
      return existingId;
    }

    const id = randomUUID();
    const node: GraphNode = {
      id,
      name,
      type,
      project,
      created_at: now,
      updated_at: now,
    };
    this.nodes.set(id, node);
    this.nodeIndex.set(key, id);
    return id;
  }

  private addEdge(
    sourceId: string,
    targetId: string,
    relationship: RelationType,
    project: string,
    now: string,
  ): void {
    // Check for existing edge with same source+target+relationship
    for (const entry of this.adjacency.get(sourceId) ?? []) {
      if (entry.targetId === targetId) {
        const existingEdge = this.edges.get(entry.edgeId);
        if (existingEdge && existingEdge.relationship === relationship) {
          return; // Edge already exists
        }
      }
    }

    const id = randomUUID();
    const edge: GraphEdge = {
      id,
      sourceId,
      targetId,
      relationship,
      project,
      created_at: now,
    };
    this.edges.set(id, edge);
    this.addToAdjacency(sourceId, targetId, id);
  }

  private addToAdjacency(sourceId: string, targetId: string, edgeId: string): void {
    if (!this.adjacency.has(sourceId)) this.adjacency.set(sourceId, []);
    this.adjacency.get(sourceId)!.push({ targetId, edgeId });

    if (!this.reverseAdj.has(targetId)) this.reverseAdj.set(targetId, []);
    this.reverseAdj.get(targetId)!.push({ targetId: sourceId, edgeId });
  }
}
