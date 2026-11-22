/**
 * The structural bounds of one call. The platform's resolver timeout cancels nothing and Memgraph ignores the
 * driver's transaction timeout, so the work is bounded by what it may read: every read returns at most its cap
 * plus one row, and one row over the cap refuses the call as `model_too_large` before any matching starts.
 * The caps are module constants, never caller input, so they are written into the Cypher as integer literals
 * (a Bolt parameter would arrive as a float, which Memgraph refuses in LIMIT).
 */
export const CAPS = {
  boundaries: 2_000,
  boundaryEdges: 4_000,
  components: 5_000,
  componentEdges: 10_000,
  flows: 10_000,
  flowData: 20_000,
  dataItems: 5_000,
  instances: 25_000,
  exposures: 20_000,
  exposureTechniques: 40_000,
  controls: 5_000,
  controlClasses: 10_000,
  supports: 20_000,
} as const;
export type ReadName = keyof typeof CAPS;

/**
 * The most attribute data one call holds: the JSON size of every class relation's property map, which any user
 * who can edit a model can grow.
 */
export const ATTRIBUTE_BYTES_MAX = 32 * 1024 * 1024;

/** The module's own deadline, below the platform's 30 s resolver timeout, checked between reads and as matching yields. */
export const DEADLINE_MS = 25_000;

/** The largest `options` string a call may pass. */
export const OPTIONS_MAX_BYTES = 128 * 1024;

/** A model id is a platform id: a short string. */
export const MODEL_ID_MAX = 128;

export class DeadlineExceeded extends Error {
  constructor() {
    super('the call passed its deadline');
    this.name = 'DeadlineExceeded';
  }
}

export class ReadOverCap extends Error {
  constructor(readonly read: ReadName | 'attributeBytes') {
    super(`the ${read} read is over its cap`);
    this.name = 'ReadOverCap';
  }
}

/** A deadline measured on an injected clock, so tests need not wait. */
export class Deadline {
  private readonly end: number;

  constructor(ms: number = DEADLINE_MS, private readonly now: () => number = Date.now) {
    this.end = now() + ms;
  }

  /** Throws `DeadlineExceeded` once the deadline has passed. */
  check(): void {
    if (this.now() >= this.end) throw new DeadlineExceeded();
  }

  remaining(): number {
    return Math.max(0, this.end - this.now());
  }
}
