/**
 * The client for a deployment that has no knowledge graph to reach.
 *
 * One configuration lands here: a deployment pointed at a service but without a usable version pin
 * (a half-finished configuration). A deployment with no service configured gets the local client
 * instead, and where its own database holds no knowledge-graph nodes that client's capability says
 * so, with the same honest "unavailable".
 *
 * It exists because the alternative is worse. A local client running against labels that are not
 * there returns *empty*, and empty is indistinguishable from "there is nothing matching your
 * keys" — a deployment quietly reporting that a knowledge graph found nothing, when it never had
 * one to ask. So capability answers the question honestly and the queries refuse, rather than
 * producing an answer that reads like data.
 */
import { KgCapability, KgClient, KgRule, KgThreat } from '../interfaces/kg-client-interface';

/**
 * No knowledge graph is reachable, so no query can be answered.
 *
 * Reaching this is a caller-side defect, not an outage: `capability()` is the sanctioned way to
 * ask, it never throws, and it says `available: false` before any query is attempted.
 */
export class KgUnavailableError extends Error {
  readonly code = 'kg_unavailable';
  constructor(message?: string) {
    super(message ?? 'No knowledge graph is available — check capability() before querying');
    this.name = 'KgUnavailableError';
  }
}

export class UnavailableKgClient implements KgClient {
  /** Nothing to be pinned to; a malformed pin that led here is configuration, not a version. */
  readonly version = null;

  async capability(): Promise<KgCapability> {
    // `entitled` is false because there is nothing to be entitled to. A consumer folding these two
    // flags reads `available: false` first, so this field never decides the outcome on its own.
    return { available: false, entitled: false, sliceCount: 0 };
  }

  async rulesByClassId(): Promise<Map<string, KgRule[]>> {
    throw new KgUnavailableError();
  }

  async threatsByRuleId(): Promise<Map<string, KgThreat[]>> {
    throw new KgUnavailableError();
  }

  async threatsByTechniqueId(): Promise<Map<string, KgThreat[]>> {
    throw new KgUnavailableError();
  }
}
