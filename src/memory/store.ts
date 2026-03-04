import { randomUUID } from 'node:crypto';
import type { Embedding } from '../embedding/types.js';
import type { VectorDB } from '../vectordb/types.js';
import type {
  MemoryItem,
  MemoryAction,
  ExtractedFact,
  MemoryKind,
  MemoryPayload,
  GraphRelation,
  MemorySearchResult,
} from './types.js';
import type { MemoryGraph } from './graph.js';
import { MemoryHistory } from './history.js';
import { hashMemory, reconcile, type ExistingMatch } from './reconciler.js';
import {
  classifyQuery,
  getWeightProfile,
  applyKindWeighting,
  applyRecencyDecay,
} from './query-classifier.js';
import { globalConceptsCollectionName } from '../paths.js';

const SEARCH_CANDIDATES = 5;
const ACCESS_BUMP_COUNT = 5;

function collectionName(project: string): string {
  return `eidetic_${project}_memory`;
}

export class MemoryStore {
  private initializedCollections = new Set<string>();
  private initPromises = new Map<string, Promise<string>>();
  private graph?: MemoryGraph;

  constructor(
    private embedding: Embedding,
    private vectordb: VectorDB,
    private history: MemoryHistory,
  ) {}

  setGraph(graph: MemoryGraph): void {
    this.graph = graph;
  }

  private async ensureCollection(project: string): Promise<string> {
    const name = collectionName(project);
    if (this.initializedCollections.has(name)) return name;

    const existing = this.initPromises.get(name);
    if (existing) return existing;

    const promise = (async () => {
      const exists = await this.vectordb.hasCollection(name);
      if (!exists) {
        await this.vectordb.createCollection(name, this.embedding.dimension);
      }
      this.initializedCollections.add(name);
      this.initPromises.delete(name);
      return name;
    })();

    this.initPromises.set(name, promise);
    return promise;
  }

  async addMemory(
    facts: ExtractedFact[],
    source?: string,
    project = 'global',
  ): Promise<MemoryAction[]> {
    await this.ensureCollection(project);

    if (facts.length === 0) return [];

    const actions: MemoryAction[] = [];

    for (const fact of facts) {
      const effectiveProject = fact.project ?? project;
      await this.ensureCollection(effectiveProject);
      const action = await this.processFact(fact, source, effectiveProject);
      if (action) actions.push(action);
    }

    return actions;
  }

  async searchMemory(
    query: string,
    limit = 10,
    kind?: string,
    project?: string,
  ): Promise<MemoryItem[]> {
    const queryVector = await this.embedding.embed(query);
    const profile = classifyQuery(query);
    const weights = getWeightProfile(profile);

    const searchOpts = {
      queryVector,
      queryText: query,
      limit: limit * 2,
      ...(kind ? { extensionFilter: [kind] } : {}),
    };

    // Determine which collections to search
    const collections: string[] = [];
    if (project && project !== 'global') {
      const projCol = collectionName(project);
      if (await this.vectordb.hasCollection(projCol)) {
        collections.push(projCol);
      }
    }
    const globalCol = collectionName('global');
    if (await this.vectordb.hasCollection(globalCol)) {
      collections.push(globalCol);
    }

    // Also search global concepts for broader context
    const conceptsCol = globalConceptsCollectionName();
    const searchConcepts = await this.vectordb.hasCollection(conceptsCol);

    if (collections.length === 0 && !searchConcepts) return [];

    // Search all relevant collections in parallel
    const allResults = await Promise.all(
      collections.map(async (col) => {
        const results = await this.vectordb.search(col, searchOpts);
        const items: { item: MemoryItem; score: number }[] = [];
        for (const r of results) {
          const id = r.relativePath;
          const point = await this.vectordb.getById(col, id);
          if (!point) continue;
          const item = payloadToMemoryItem(id, point.payload);
          // Filter out superseded entries
          if (item.superseded_by) continue;
          items.push({ item, score: r.score });
        }
        return items;
      }),
    );

    // Search global concepts with reduced weight
    if (searchConcepts) {
      const conceptResults = await this.vectordb.search(conceptsCol, searchOpts);
      for (const r of conceptResults) {
        const id = r.relativePath;
        const point = await this.vectordb.getById(conceptsCol, id);
        if (!point) continue;
        const item = payloadToMemoryItem(id, point.payload);
        allResults.push([{ item, score: r.score * 0.8 }]);
      }
    }

    // Flatten and apply kind weighting + recency decay
    const scored = allResults.flat().map(({ item, score }) => {
      let finalScore = applyKindWeighting(score, item.kind, weights);
      finalScore = applyRecencyDecay(finalScore, item.kind, item.valid_at);

      // Project boost: project-specific memories rank above global
      if (project && item.project === project) {
        finalScore *= 1.5;
      }

      return { item, score: finalScore };
    });

    // Sort by final score descending
    scored.sort((a, b) => b.score - a.score);

    const ranked = scored.slice(0, limit).map((s) => s.item);

    // Fire-and-forget: bump access_count for top results
    const topItems = ranked.slice(0, ACCESS_BUMP_COUNT);
    void this.bumpAccessCounts(topItems);

    return ranked;
  }

  /**
   * Search memory and enrich with graph relations from top results.
   * Returns both memories and any related entity relationships.
   */
  async searchMemoryWithGraph(
    query: string,
    limit = 10,
    kind?: string,
    project?: string,
  ): Promise<MemorySearchResult> {
    const memories = await this.searchMemory(query, limit, kind, project);
    const relations = this.getGraphRelations(memories);
    return { memories, relations: relations.length > 0 ? relations : undefined };
  }

  private getGraphRelations(memories: MemoryItem[]): GraphRelation[] {
    if (!this.graph) return [];

    const relations: GraphRelation[] = [];
    const seen = new Set<string>();

    for (const mem of memories.slice(0, 5)) {
      // Extract potential entity names from memory text (words that look like identifiers)
      const words = mem.memory.split(/[\s,.:;()[\]{}'"]+/).filter((w) => w.length > 2);
      for (const word of words) {
        const node = this.graph.findNode(word);
        if (!node) continue;

        const related = this.graph.getRelated(word);
        for (const edge of related.edges) {
          const sourceNode = related.nodes.find((n) => n.id === edge.sourceId);
          const targetNode = related.nodes.find((n) => n.id === edge.targetId);
          if (!sourceNode || !targetNode) continue;

          const key = `${sourceNode.name}|${edge.relationship}|${targetNode.name}`;
          if (seen.has(key)) continue;
          seen.add(key);

          relations.push({
            source: sourceNode.name,
            relationship: edge.relationship,
            target: targetNode.name,
          });
        }
      }
    }

    return relations;
  }

  async listMemories(kind?: string, limit = 50, project?: string): Promise<MemoryItem[]> {
    const queryVector = await this.embedding.embed('developer knowledge');
    const searchOpts = {
      queryVector,
      queryText: '',
      limit,
      ...(kind ? { extensionFilter: [kind] } : {}),
    };

    // Determine collections
    const collections: string[] = [];
    if (project && project !== 'global') {
      const projCol = collectionName(project);
      if (await this.vectordb.hasCollection(projCol)) {
        collections.push(projCol);
      }
    }
    const globalCol = collectionName('global');
    if (await this.vectordb.hasCollection(globalCol)) {
      collections.push(globalCol);
    }

    if (collections.length === 0) return [];

    const allResults = await Promise.all(
      collections.map(async (col) => {
        const results = await this.vectordb.search(col, searchOpts);
        const items: MemoryItem[] = [];
        for (const r of results) {
          const id = r.relativePath;
          const point = await this.vectordb.getById(col, id);
          if (!point) continue;
          const item = payloadToMemoryItem(id, point.payload);
          if (item.superseded_by) continue;
          items.push(item);
        }
        return items;
      }),
    );

    return allResults.flat().slice(0, limit);
  }

  async deleteMemory(id: string, project?: string): Promise<boolean> {
    // Try project collection first, then global
    const collectionsToTry: string[] = [];
    if (project && project !== 'global') {
      collectionsToTry.push(collectionName(project));
    }
    collectionsToTry.push(collectionName('global'));

    // Also try any initialized collection (fallback for unknown project)
    for (const col of this.initializedCollections) {
      if (!collectionsToTry.includes(col)) {
        collectionsToTry.push(col);
      }
    }

    for (const col of collectionsToTry) {
      const exists = await this.vectordb.hasCollection(col);
      if (!exists) continue;

      const existing = await this.vectordb.getById(col, id);
      if (!existing) continue;

      const ep = asPayload(existing.payload);
      const memory = ep.memory ?? ep.content ?? '';
      await this.vectordb.deleteByPath(col, id);
      this.history.log(id, 'DELETE', null, memory);
      return true;
    }

    return false;
  }

  getHistory(memoryId: string) {
    return this.history.getHistory(memoryId);
  }

  private async bumpAccessCounts(items: MemoryItem[]): Promise<void> {
    const now = new Date().toISOString();
    for (const item of items) {
      try {
        const col = collectionName(item.project);
        const exists = await this.vectordb.hasCollection(col);
        if (!exists) continue;
        const point = await this.vectordb.getById(col, item.id);
        if (!point) continue;
        const currentCount = Number(point.payload.access_count ?? 0);
        await this.vectordb.updatePoint(col, item.id, point.vector, {
          ...point.payload,
          access_count: currentCount + 1,
          last_accessed: now,
        });
      } catch {
        // Silently ignore — access tracking is a best-effort utility signal
      }
    }
  }

  private async processFact(
    fact: ExtractedFact,
    source?: string,
    project = 'global',
  ): Promise<MemoryAction | null> {
    const col = collectionName(project);
    const hash = hashMemory(fact.fact);
    const vector = await this.embedding.embed(fact.fact);

    const searchResults = await this.vectordb.search(col, {
      queryVector: vector,
      queryText: fact.fact,
      limit: SEARCH_CANDIDATES,
    });

    const candidates: ExistingMatch[] = [];
    for (const result of searchResults) {
      const id = result.relativePath;
      if (!id) continue;
      const point = await this.vectordb.getById(col, id);
      if (!point) continue;
      candidates.push({
        id,
        memory: result.content,
        hash: asPayload(point.payload).hash ?? '',
        vector: point.vector,
        score: result.score,
        kind: asPayload(point.payload).kind ?? '',
      });
    }

    const decision = reconcile(hash, vector, candidates, fact.kind);

    if (decision.action === 'NONE') return null;

    const now = new Date().toISOString();
    const validAt = fact.valid_at ?? now;

    // SUPERSEDE: create new entry, link old → new
    if (decision.action === 'SUPERSEDE' && decision.existingId) {
      const id = randomUUID();

      // Mark old entry as superseded
      const existingPoint = await this.vectordb.getById(col, decision.existingId);
      if (existingPoint) {
        await this.vectordb.updatePoint(col, decision.existingId, existingPoint.vector, {
          ...existingPoint.payload,
          superseded_by: id,
        });
      }

      // Create new entry with supersedes pointer
      await this.vectordb.updatePoint(col, id, vector, {
        content: fact.fact,
        relativePath: id,
        fileExtension: fact.kind,
        language: source ?? '',
        startLine: 0,
        endLine: 0,
        hash,
        memory: fact.fact,
        kind: fact.kind,
        source: source ?? '',
        project,
        access_count: 0,
        last_accessed: '',
        supersedes: decision.existingId,
        superseded_by: null,
        valid_at: validAt,
        created_at: now,
        updated_at: now,
      });

      this.history.log(id, 'SUPERSEDE', fact.fact, decision.existingMemory, source, now);

      return {
        event: 'SUPERSEDE',
        id,
        memory: fact.fact,
        previous: decision.existingMemory,
        kind: fact.kind,
        source,
        project,
        supersedes: decision.existingId,
      };
    }

    if (decision.action === 'UPDATE' && decision.existingId) {
      const existingPoint = await this.vectordb.getById(col, decision.existingId);
      const ep = existingPoint ? asPayload(existingPoint.payload) : null;
      const createdAt = ep?.created_at ?? now;
      const existingAccessCount = ep?.access_count ?? 0;
      const existingLastAccessed = ep?.last_accessed ?? '';

      await this.vectordb.updatePoint(col, decision.existingId, vector, {
        content: fact.fact,
        relativePath: decision.existingId,
        fileExtension: fact.kind,
        language: source ?? '',
        startLine: 0,
        endLine: 0,
        hash,
        memory: fact.fact,
        kind: fact.kind,
        source: source ?? '',
        project,
        access_count: existingAccessCount,
        last_accessed: existingLastAccessed,
        supersedes: ep?.supersedes ?? null,
        superseded_by: ep?.superseded_by ?? null,
        valid_at: validAt,
        created_at: createdAt,
        updated_at: now,
      });

      this.history.log(
        decision.existingId,
        'UPDATE',
        fact.fact,
        decision.existingMemory,
        source,
        now,
      );

      return {
        event: 'UPDATE',
        id: decision.existingId,
        memory: fact.fact,
        previous: decision.existingMemory,
        kind: fact.kind,
        source,
        project,
      };
    }

    // ADD
    const id = randomUUID();
    await this.vectordb.updatePoint(col, id, vector, {
      content: fact.fact,
      relativePath: id,
      fileExtension: fact.kind,
      language: source ?? '',
      startLine: 0,
      endLine: 0,
      hash,
      memory: fact.fact,
      kind: fact.kind,
      source: source ?? '',
      project,
      access_count: 0,
      last_accessed: '',
      supersedes: null,
      superseded_by: null,
      valid_at: validAt,
      created_at: now,
      updated_at: now,
    });

    this.history.log(id, 'ADD', fact.fact, null, source, now);

    return {
      event: 'ADD',
      id,
      memory: fact.fact,
      kind: fact.kind,
      source,
      project,
    };
  }
}

function asPayload(raw: Record<string, unknown>): MemoryPayload {
  return raw as MemoryPayload;
}

function payloadToMemoryItem(id: string, raw: Record<string, unknown>): MemoryItem {
  const p = asPayload(raw);
  return {
    id,
    memory: p.memory ?? p.content ?? '',
    hash: p.hash ?? '',
    kind: (p.kind ?? p.fileExtension ?? 'fact') as MemoryKind,
    source: p.source ?? p.language ?? '',
    project: p.project ?? 'global',
    access_count: p.access_count ?? 0,
    last_accessed: p.last_accessed ?? '',
    supersedes: p.supersedes ?? null,
    superseded_by: p.superseded_by ?? null,
    valid_at: p.valid_at ?? '',
    created_at: p.created_at ?? '',
    updated_at: p.updated_at ?? '',
  };
}
