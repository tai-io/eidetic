export type MemoryKind = 'fact' | 'decision' | 'convention' | 'constraint' | 'intent';
export type QueryProfile = 'feasibility' | 'rationale' | 'procedural';
export type WeightProfile = Record<MemoryKind, number>;

const FEASIBILITY_PATTERNS = ['can i', 'is it possible', 'allowed to', 'should i'];
const RATIONALE_PATTERNS = ['why did', 'why do', 'reason for', 'how come'];
const PROCEDURAL_PATTERNS = ['how to', 'how should', "what's the pattern"];

export function classifyQuery(query: string): QueryProfile {
  const lower = query.toLowerCase();

  // Check procedural first — "how should" must match before "should i"
  for (const p of PROCEDURAL_PATTERNS) {
    if (lower.includes(p)) return 'procedural';
  }
  for (const p of FEASIBILITY_PATTERNS) {
    if (lower.includes(p)) return 'feasibility';
  }
  for (const p of RATIONALE_PATTERNS) {
    if (lower.includes(p)) return 'rationale';
  }

  return 'procedural';
}

const PROFILES: Record<QueryProfile, WeightProfile> = {
  feasibility: { constraint: 2.0, convention: 1.6, decision: 1.4, fact: 1.2, intent: 1.0 },
  rationale: { decision: 2.0, constraint: 1.6, fact: 1.4, convention: 1.2, intent: 1.0 },
  procedural: { convention: 2.0, fact: 1.6, decision: 1.4, constraint: 1.2, intent: 1.0 },
};

export function getWeightProfile(profile: QueryProfile): WeightProfile {
  return PROFILES[profile];
}

export function applyKindWeighting(score: number, kind: string, profile: WeightProfile): number {
  const weight = kind in profile ? profile[kind as MemoryKind] : 1.0;
  return score * weight;
}

const DECAY_RATES: Record<MemoryKind, number> = {
  constraint: 0.001,
  decision: 0.005,
  convention: 0.005,
  fact: 0.01,
  intent: 0.05,
};

export function applyRecencyDecay(score: number, kind: string, validAt: string): number {
  if (!validAt) return score;

  const validDate = new Date(validAt).getTime();
  if (isNaN(validDate)) return score;

  const daysSince = (Date.now() - validDate) / 86400000;
  if (daysSince <= 0) return score;

  const rate = kind in DECAY_RATES ? DECAY_RATES[kind as MemoryKind] : 0.01;
  return score * (1 / (1 + daysSince * rate));
}
