/**
 * The knowledge-graph client backed by the deployment's own graph.
 *
 * Runs the relocated Cypher (`./queries`) through the injected driver, in the caller's scoped
 * database, and assembles the keyed maps in TypeScript. The `token` every method accepts is
 * ignored here — entitlement is a statement about a caller of a service, and there is no service.
 *
 * The driver is typed `any`, as everywhere else in this package: `dt-module` deliberately carries
 * no `neo4j-driver` dependency, so bolt values are duck-typed rather than instance-checked.
 */
import { Logger } from '@nestjs/common';
import {
  KgCapability,
  KgClient,
  KgRule,
  KgRuleKind,
  KgRuleRef,
  KgThreat,
} from '../interfaces/kg-client-interface';
import {
  KG_PRESENCE_PROBE,
  KG_RULES_BY_CLASS_ID,
  KG_THREATS_BY_RULE_ID,
  KG_THREATS_BY_TECHNIQUE_ID,
} from './queries';
import { distinct, distinctRefs, kgRefKey, seededMap } from './keys';
import { toRule, toThreat } from './normalize';
import { KgUnavailableError } from './unavailable-client';

/** A bolt record — `get(key)` throws for a key the statement did not project, so only read aliases. */
interface BoltRecord {
  get(key: string): unknown;
}

/**
 * File each row under the key it carries, into a map already holding every requested key.
 *
 * A row keyed outside the requested set cannot happen — every statement returns the unwound key
 * verbatim — but dropping it is preferable to creating a key nobody asked for.
 */
function group<T>(keys: string[], records: BoltRecord[], keyOf: (r: BoltRecord) => string, map: (r: BoltRecord) => T): Map<string, T[]> {
  const out = seededMap<T>(keys);
  for (const rec of records) {
    out.get(keyOf(rec))?.push(map(rec));
  }
  return out;
}

export interface LocalKgClientOptions {
  driver: any;
  logger?: Logger;
  /** `undefined` means the server's default database — the only value valid on every engine. */
  databaseName?: string;
}

export class LocalKgClient implements KgClient {
  private readonly driver: any;
  private readonly databaseName?: string;
  /** The in-flight or settled probe. Memoised as a *promise* so concurrent callers share one
   * round trip, and cleared on rejection so a transient failure is not cached as "no graph". */
  private probe?: Promise<KgCapability>;

  constructor(opts: LocalKgClientOptions) {
    this.driver = opts.driver;
    this.databaseName = opts.databaseName;
  }

  private async read(cypher: string, params: Record<string, unknown>): Promise<BoltRecord[]> {
    const session = this.driver.session(this.databaseName ? { database: this.databaseName } : {});
    try {
      const result = await session.executeRead((tx: any) => tx.run(cypher, params));
      return result.records as BoltRecord[];
    } finally {
      await session.close();
    }
  }

  capability(): Promise<KgCapability> {
    if (!this.probe) {
      const pending = this.read(KG_PRESENCE_PROBE, {}).then((records) => ({
        available: records.length > 0,
        // Unconditionally true, and deliberately not read off the zero beside it: a local graph has
        // no entitlement gate, so "may this caller query it" is always yes. Resolving it false here
        // would make every local deployment report itself as locked.
        entitled: true,
        // Slices are a property of the served corpus. Zero is not a statement about access.
        sliceCount: 0,
      }));
      this.probe = pending;
      // Driver failures propagate — the client does not translate a broken graph into "no graph
      // here", which is the one answer a caller must never be given falsely. A consumer that wants
      // to degrade catches it at its own call site, where that policy belongs. The memo is dropped
      // on failure so a transient outage does not disable the graph for the process's lifetime.
      pending.catch(() => {
        if (this.probe === pending) this.probe = undefined;
      });
    }
    return this.probe;
  }

  /**
   * Refuse to answer a graph that holds no knowledge-graph nodes.
   *
   * Without this the statements would run against labels that are not there and return **empty** —
   * a deployment reporting "the knowledge graph matched nothing" when it never had one. The check
   * rides the memoised probe, so it costs a round trip only if the caller queries before asking
   * capability, and nothing at all afterwards.
   */
  private async requireAvailable(): Promise<void> {
    const { available } = await this.capability();
    if (!available) {
      throw new KgUnavailableError('This deployment holds no knowledge-graph data');
    }
  }

  async rulesByClassId(classIds: string[], opts?: { kind?: KgRuleKind }): Promise<Map<string, KgRule[]>> {
    const keys = distinct(classIds);
    // An empty request has an empty answer whatever the graph holds, and costs no round trip. The
    // other implementation must short-circuit here too: the wire rejects an empty key set outright.
    if (keys.length === 0) return new Map();
    await this.requireAvailable();
    // `$kind` is bound on every call: Memgraph rejects a statement referencing an unsupplied
    // parameter rather than treating it as null.
    const records = await this.read(KG_RULES_BY_CLASS_ID, { classIds: keys, kind: opts?.kind ?? null });
    return group(keys, records, (r) => r.get('classId') as string, (r) => toRule((k) => r.get(k)));
  }

  async threatsByRuleId(refs: KgRuleRef[]): Promise<Map<string, KgThreat[]>> {
    const seen = distinctRefs(refs);
    if (seen.size === 0) return new Map();
    await this.requireAvailable();
    // The pairs go over as maps here and as joined strings on the wire; both come back keyed by
    // the joined string, which is what makes the two implementations interchangeable to a caller.
    const records = await this.read(KG_THREATS_BY_RULE_ID, { ruleRefs: Array.from(seen.values()) });
    return group(
      Array.from(seen.keys()),
      records,
      (r) => kgRefKey(r.get('classId') as string, r.get('ruleId') as string),
      (r) => toThreat((k) => r.get(k)),
    );
  }

  async threatsByTechniqueId(techniqueIds: string[]): Promise<Map<string, KgThreat[]>> {
    const keys = distinct(techniqueIds);
    if (keys.length === 0) return new Map();
    await this.requireAvailable();
    const records = await this.read(KG_THREATS_BY_TECHNIQUE_ID, { techniqueIds: keys });
    return group(keys, records, (r) => r.get('techniqueId') as string, (r) => toThreat((k) => r.get(k)));
  }
}
