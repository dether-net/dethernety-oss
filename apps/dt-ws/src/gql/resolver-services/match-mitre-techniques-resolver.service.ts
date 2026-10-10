import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import { EmbeddingService } from '../services/embedding.service';
import { safeErrorMessage } from '../../common/utils/safe-error-message';
import { isMiskeyed, readVectorIndexKeys, rebuildVectorIndex } from '../services/vector-index-keys';

/**
 * Resolver for the matchMitreTechniques query.
 *
 * Five-tier cascade per query — EXACT_ID → PREFIX_ID → NAME_MATCH →
 * DESCRIPTION_MATCH → VECTOR_SIMILARITY — short-circuiting at the first
 * non-empty tier. Five corpora (ATTACK_TECHNIQUE / DEFEND_TECHNIQUE /
 * ATTACK_MITIGATION / ATLAS_TECHNIQUE / ATLAS_MITIGATION) selected by the
 * `kind` arg. A kind whose corpus is not loaded (no nodes) is skipped by the
 * vector tier rather than switching it off for every kind.
 *
 * Structural mirror of MatchClassesResolverService for the query path —
 * same auth + monitoring wrapping, same `ensureVectorIndexes` idempotency,
 * same graceful-degradation cascade.
 */

// --- Constants ---

const MAX_QUERIES = 25;
const DEFAULT_TOP_N = 3;
const MAX_TOP_N = 50;
const MIN_SUBSTRING_LENGTH = 3;
const MAX_QUERY_LENGTH = 500;
const VECTOR_CHECK_TTL_MS = 10 * 60 * 1000;
const MITRE_CORPUS_CACHE_TTL_MS = 5 * 60 * 1000;

type MitreKind =
  | 'ATTACK_TECHNIQUE'
  | 'DEFEND_TECHNIQUE'
  | 'ATTACK_MITIGATION'
  | 'ATLAS_TECHNIQUE'
  | 'ATLAS_MITIGATION';
type MitreMatchType =
  | 'EXACT_ID'
  | 'PREFIX_ID'
  | 'NAME_MATCH'
  | 'DESCRIPTION_MATCH'
  | 'VECTOR_SIMILARITY';
type VectorDisabledReason =
  | 'EMBEDDING_DISABLED'
  | 'NO_INDEX_MODULE'
  | 'NO_VECTORS'
  | 'MODEL_MISMATCH';

const MITRE_KINDS: MitreKind[] = [
  'ATTACK_TECHNIQUE',
  'DEFEND_TECHNIQUE',
  'ATTACK_MITIGATION',
  'ATLAS_TECHNIQUE',
  'ATLAS_MITIGATION',
];

const MITRE_LABEL_BY_KIND: Record<MitreKind, string> = {
  ATTACK_TECHNIQUE: 'MitreAttackTechnique',
  DEFEND_TECHNIQUE: 'MitreDefendTechnique',
  ATTACK_MITIGATION: 'MitreAttackMitigation',
  ATLAS_TECHNIQUE: 'MitreAtlasTechnique',
  ATLAS_MITIGATION: 'MitreAtlasMitigation',
};

const MITRE_INDEX_NAME_BY_KIND: Record<MitreKind, string> = {
  ATTACK_TECHNIQUE: 'mitre_attack_technique_embeddings',
  DEFEND_TECHNIQUE: 'mitre_defend_technique_embeddings',
  ATTACK_MITIGATION: 'mitre_attack_mitigation_embeddings',
  ATLAS_TECHNIQUE: 'mitre_atlas_technique_embeddings',
  ATLAS_MITIGATION: 'mitre_atlas_mitigation_embeddings',
};

// The MITRE corpus is keyed by these public ids. Taxonomy artifacts that have
// no key (e.g. the D3FEND OWL "Defensive Technique" root, or unkeyed
// "Particle Radiation Hardening" placeholder) are not addressable from the
// picker and not embedded by the build script. The precheck must measure
// embedding coverage against the *addressable* subset, not the raw label,
// otherwise unkeyed taxonomy artifacts wrongly trip NO_VECTORS.
//
// Static record, enum-keyed — safe to interpolate into Cypher.
const MITRE_KEY_PROPERTY_BY_KIND: Record<MitreKind, string> = {
  ATTACK_TECHNIQUE: 'attack_id',
  DEFEND_TECHNIQUE: 'd3fendId',
  ATTACK_MITIGATION: 'attack_id',
  ATLAS_TECHNIQUE: 'atlas_id',
  ATLAS_MITIGATION: 'atlas_id',
};

// The tactic hop of each technique kind (mitigations have no tactic). ATT&CK and
// ATLAS order a multi-tactic technique's tactics by `matrix_order`, stamped at
// ingest from each matrix's ordered tactic list, so the reported tactic is the
// earliest stage and not the alphabetically first name; `coalesce(…, 999)` keeps a
// corpus ingested before that stamp existed working (name order). D3FEND keys on
// name: its tactics carry no matrix_order. Static, enum-keyed: safe to interpolate.
const TACTIC_HOP_BY_KIND: Partial<Record<MitreKind, { pattern: string; orderBy: string }>> = {
  ATTACK_TECHNIQUE: {
    pattern: '<-[:TACTIC_INCLUDES_TECHNIQUE]-(tac:MitreAttackTactic)',
    orderBy: 'coalesce(tac.matrix_order, 999) ASC, tac.name ASC',
  },
  ATLAS_TECHNIQUE: {
    pattern: '<-[:TACTIC_INCLUDES_TECHNIQUE]-(tac:MitreAtlasTactic)',
    orderBy: 'coalesce(tac.matrix_order, 999) ASC, tac.name ASC',
  },
  DEFEND_TECHNIQUE: {
    pattern: '-[:ENABLES]->(tac:MitreDefendTactic)',
    orderBy: 'tac.name ASC',
  },
};

// Capacity is a pre-allocation hint to Memgraph's HNSW; exceeding it triggers
// a resize. ATTACK_TECHNIQUE corpus today is ~1055 base+sub (ATT&CK v18),
// growing to ~1100+ in upcoming releases — bumped from 1500 → 2500 (~130%
// headroom). DEFEND_TECHNIQUE / ATTACK_MITIGATION bumped from 500 → 1000 for
// the same reason.
const MITRE_INDEX_CAPACITY_BY_KIND: Record<MitreKind, number> = {
  ATTACK_TECHNIQUE: 2500,
  DEFEND_TECHNIQUE: 1000,
  ATTACK_MITIGATION: 1000,
  ATLAS_TECHNIQUE: 1000,
  ATLAS_MITIGATION: 500,
};

// Priority order when aggregating per-label reasons into a single
// dominant reason for the response envelope.
const REASON_PRIORITY: Record<VectorDisabledReason, number> = {
  MODEL_MISMATCH: 4,
  NO_VECTORS: 3,
  NO_INDEX_MODULE: 2,
  EMBEDDING_DISABLED: 1,
};

// --- Internal types ---

interface TechniqueQueryInput {
  query: string;
}

interface MatchMitreTechniquesInput {
  queries: TechniqueQueryInput[];
  kind: MitreKind;
  topN?: number;
}

interface MitreRecord {
  mitreId: string;
  name: string;
  description: string | null;
  tactic: string | null;
  tacticOrder: number | null;
}

interface MitreCandidate {
  mitreId: string;
  name: string;
  description: string | null;
  tactic: string | null;
  tacticOrder: number | null;
  kind: MitreKind;
  matchType: MitreMatchType;
  similarityScore: number | null;
}

interface TechniqueQueryMatch {
  query: string;
  candidates: MitreCandidate[];
}

interface MatchMitreTechniquesResult {
  matches: TechniqueQueryMatch[];
  unmatched: string[];
  vectorAvailable: boolean;
  vectorDisabledReason: VectorDisabledReason | null;
}

interface PrecheckState {
  reason: VectorDisabledReason | null;
  checkedAt: number;
}

// A kind's precheck outcome: a disabled reason, null when healthy, or EMPTY when the
// kind has no nodes at all (its framework is not loaded), which skips the kind.
type KindPrecheck = VectorDisabledReason | null | 'EMPTY';

// --- Helpers ---

function toNumber(raw: any): number {
  if (typeof raw === 'number') return raw;
  if (raw && typeof raw.toNumber === 'function') return raw.toNumber();
  return Number(raw);
}

function toNullableNumber(raw: any): number | null {
  return raw === null || raw === undefined ? null : toNumber(raw);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function byMitreIdAsc(
  a: { mitreId: string },
  b: { mitreId: string },
): number {
  return a.mitreId < b.mitreId ? -1 : a.mitreId > b.mitreId ? 1 : 0;
}

function dominantReason(
  reasons: Array<VectorDisabledReason | null>,
): VectorDisabledReason | null {
  let best: VectorDisabledReason | null = null;
  for (const r of reasons) {
    if (r === null) continue;
    if (best === null || REASON_PRIORITY[r] > REASON_PRIORITY[best]) {
      best = r;
    }
  }
  return best;
}

// --- Service ---

@Injectable()
export class MatchMitreTechniquesResolverService {
  private readonly logger = new Logger(MatchMitreTechniquesResolverService.name);

  private vectorSearchAvailable: boolean | null = null;
  private vectorSearchAvailableCheckedAt = 0;
  private vectorIndexesEnsured = false;
  // Single-flight handle so concurrent cold-cache callers await one ensure
  // pass instead of racing two CREATE VECTOR INDEX statements.
  private ensurePromise: Promise<void> | null = null;
  // Global precheck outcome: null while at least one loaded kind is healthy
  // (or a tier-wide fault such as a missing vector module or an index
  // dimension mismatch otherwise).
  private vectorPrecheckResult: PrecheckState | null = null;
  // Healthy kinds, indexed by the last precheck. A kind outside it has no
  // vector tier of its own: either it has no nodes, or it is in kindReasons.
  private vectorKinds = new Set<MitreKind>();
  // Kinds with nodes whose corpus failed its own precheck (missing or
  // mismatched embeddings). Each reports its own reason; the healthy kinds
  // keep their vector tier.
  private kindReasons = new Map<MitreKind, VectorDisabledReason>();
  private corpusCacheByKind = new Map<
    MitreKind,
    { records: MitreRecord[]; cachedAt: number }
  >();

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly authorizationService: AuthorizationService,
    private readonly monitoringService: MonitoringService,
    private readonly embeddingService: EmbeddingService,
  ) {
    this.logger.log('MatchMitreTechniquesResolverService initialized');
  }

  // --- Input validation ---

  private validateInput(input: MatchMitreTechniquesInput): void {
    if (!input.queries || input.queries.length === 0) {
      throw new Error('queries must be a non-empty array');
    }
    if (input.queries.length > MAX_QUERIES) {
      throw new Error(
        `queries length ${input.queries.length} exceeds MAX_QUERIES (${MAX_QUERIES})`,
      );
    }
    for (const q of input.queries) {
      if (typeof q.query !== 'string') {
        throw new Error('each query must be a string');
      }
      if (q.query.length > MAX_QUERY_LENGTH) {
        throw new Error(
          `query length ${q.query.length} exceeds MAX_QUERY_LENGTH (${MAX_QUERY_LENGTH})`,
        );
      }
    }
    if (!MITRE_LABEL_BY_KIND[input.kind]) {
      throw new Error(`unknown kind: ${input.kind}`);
    }
    // Defense-in-depth: the GraphQL Int scalar should reject non-finite
    // topN at the schema layer, but reject here too so direct-instance
    // callers (and tests) don't smuggle NaN into the inline `${topN}`
    // Cypher template-string position.
    if (input.topN !== undefined && input.topN !== null) {
      if (typeof input.topN !== 'number' || !Number.isFinite(input.topN)) {
        throw new Error('topN must be a finite number');
      }
    }
  }

  // --- Vector availability ---

  /**
   * Detect whether the database supports vector search (Memgraph 3.0+).
   * Mirrors MatchClassesResolverService.checkVectorSearchAvailability —
   * cached with VECTOR_CHECK_TTL_MS so an upgrade/rollback toggle is
   * picked up without restart but per-request probing is avoided.
   */
  private async checkVectorSearchAvailability(): Promise<boolean> {
    const now = Date.now();
    if (
      this.vectorSearchAvailable !== null &&
      now - this.vectorSearchAvailableCheckedAt < VECTOR_CHECK_TTL_MS
    ) {
      return this.vectorSearchAvailable;
    }
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
    try {
      await session.executeRead(async (tx: any) =>
        tx.run('CALL vector_search.show_index_info() YIELD *'),
      );
      this.vectorSearchAvailable = true;
      this.logger.log('Vector search is available (Memgraph detected)');
    } catch {
      this.vectorSearchAvailable = false;
      this.logger.log('Vector search not available (Neo4j or older Memgraph)');
    } finally {
      await session.close();
    }
    this.vectorSearchAvailableCheckedAt = now;
    return this.vectorSearchAvailable;
  }

  /**
   * Per-label model-coherence precheck.
   * Single Cypher per kind; returns the per-label disabled reason, `null`
   * when the kind's corpus is healthy, or `EMPTY` when it has no nodes.
   */
  private async runPrecheckForKind(kind: MitreKind): Promise<KindPrecheck> {
    const label = MITRE_LABEL_BY_KIND[kind];
    const keyProperty = MITRE_KEY_PROPERTY_BY_KIND[kind];
    const runtimeModel = this.embeddingService.getModel();
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
    try {
      // Restrict the corpus to addressable nodes (n.<keyProperty> IS NOT NULL).
      // Unkeyed taxonomy artifacts are not embedded by the build script and
      // cannot surface in picker results, so they must not count against
      // coverage.
      const r = await session.executeRead(async (tx: any) =>
        tx.run(
          `MATCH (n:${label})
           WHERE n.${keyProperty} IS NOT NULL
           WITH count(n) AS total,
                count(CASE WHEN n.embeddingModel IS NOT NULL THEN 1 END) AS withModel,
                collect(DISTINCT n.embeddingModel) AS models
           RETURN total, withModel, models`,
        ),
      );
      const rec = r.records[0];
      const total = toNumber(rec.get('total'));
      const withModel = toNumber(rec.get('withModel'));
      const modelsRaw = (rec.get('models') ?? []) as Array<string | null>;
      const models = modelsRaw.filter(
        (m): m is string => m != null,
      );

      if (total === 0) return 'EMPTY';
      if (withModel === 0) return 'NO_VECTORS';
      if (withModel < total) return 'NO_VECTORS';
      if (models.length > 1) return 'MODEL_MISMATCH';
      if (models[0] !== runtimeModel) return 'MODEL_MISMATCH';
      return null;
    } finally {
      await session.close();
    }
  }

  /**
   * Lazy-idempotent ensure: run the per-label precheck and create the HNSW
   * index of every healthy kind. An unhealthy kind (nodes present, embeddings
   * missing or from another model) is excluded on its own. The
   * label-property key indexes are startup DDL (EnsureIndexesService).
   *
   * Sets vectorPrecheckResult on every call so the cascade can read the
   * aggregated reason; sets vectorIndexesEnsured only after a fully
   * successful pass so failure modes are retried on the next call after
   * VECTOR_CHECK_TTL_MS (or process restart).
   */
  async ensureMitreVectorIndexes(): Promise<void> {
    if (this.vectorIndexesEnsured) return;
    // Coalesce concurrent cold-cache callers onto one ensure pass: without
    // this, two queries could both pass the index-existence check and both
    // issue CREATE VECTOR INDEX — the loser's CREATE throws uncaught and fails
    // that query.
    if (this.ensurePromise) return this.ensurePromise;
    this.ensurePromise = this.runEnsureMitreVectorIndexes().finally(() => {
      this.ensurePromise = null;
    });
    return this.ensurePromise;
  }

  /**
   * Rebuild a MITRE vector index that is keyed on another label or property, or that holds fewer
   * entries than there are embedded nodes of its label (see vector-index-keys.ts). Creating the index
   * indexes the nodes that already carry the property. A failure is logged and leaves the index as is.
   */
  private async healMitreVectorIndex(
    session: any,
    spec: { indexName: string; label: string; property: string; dimensions: number; capacity: number },
    key: { label: string; property: string; size: number } | undefined,
  ): Promise<void> {
    try {
      const counted = await session.executeRead((tx: any) =>
        tx.run(`MATCH (n:${spec.label}) WHERE n.embedding IS NOT NULL RETURN count(n) AS n`),
      );
      const embedded = toNumber(counted.records[0]?.get('n'));
      const miskeyed = isMiskeyed(key, spec);
      if (!miskeyed && (key === undefined || key.size >= embedded)) return;
      this.logger.warn(
        miskeyed
          ? `MITRE vector index ${spec.indexName} is keyed on :${key!.label}(${key!.property}) instead of :${spec.label}(embedding) — rebuilding it`
          : `MITRE vector index ${spec.indexName} holds ${key!.size} of ${embedded} embedded :${spec.label} nodes — rebuilding it`,
      );
      await rebuildVectorIndex(session, spec);
      const after = (await readVectorIndexKeys(session))?.get(spec.indexName);
      this.logger.log(`MITRE vector index ${spec.indexName} rebuilt: holds ${after?.size ?? 'unknown'} of ${embedded} embedded nodes`);
    } catch (error) {
      this.logger.warn(`MITRE vector index ${spec.indexName} could not be verified or rebuilt`, {
        error: safeErrorMessage(error),
      });
    }
  }

  private async runEnsureMitreVectorIndexes(): Promise<void> {
    // 1. Vector_search module availability
    const supported = await this.checkVectorSearchAvailability();
    if (!supported) {
      this.vectorPrecheckResult = {
        reason: 'NO_INDEX_MODULE',
        checkedAt: Date.now(),
      };
      return;
    }

    // 2. Per-label precheck. A kind with no nodes (its framework is not
    // loaded) is skipped, not counted: a deployment without ATLAS keeps the
    // vector tier for ATT&CK and D3FEND.
    const checked: Array<{ kind: MitreKind; reason: VectorDisabledReason | null }> = [];
    for (const kind of MITRE_KINDS) {
      let outcome: KindPrecheck;
      try {
        outcome = await this.runPrecheckForKind(kind);
      } catch (err) {
        this.logger.warn(`MITRE precheck failed for kind ${kind}`, {
          error: safeErrorMessage(err),
        });
        // Read failure on the precheck Cypher is treated conservatively
        // as NO_VECTORS — operator sees the warn in logs and the picker
        // gracefully degrades.
        outcome = 'NO_VECTORS';
      }
      if (outcome === 'EMPTY') {
        this.logger.log(
          `MITRE vector kind ${kind} skipped: no :${MITRE_LABEL_BY_KIND[kind]} nodes`,
        );
        continue;
      }
      checked.push({ kind, reason: outcome });
    }
    const healthy = checked.filter((c) => c.reason === null).map((c) => c.kind);
    this.vectorKinds = new Set(healthy);
    this.kindReasons = new Map(
      checked
        .filter((c): c is { kind: MitreKind; reason: VectorDisabledReason } => c.reason !== null)
        .map((c) => [c.kind, c.reason]),
    );
    const perLabel = checked.map((c) => `${c.kind}: ${c.reason ?? 'OK'}`).join('; ');
    // The tier is down only when no loaded kind is healthy; then the dominant
    // per-kind reason is the tier's reason.
    const aggregate =
      healthy.length > 0
        ? null
        : checked.length === 0
          ? 'NO_VECTORS'
          : dominantReason(checked.map((c) => c.reason));
    this.vectorPrecheckResult = { reason: aggregate, checkedAt: Date.now() };

    if (aggregate !== null) {
      this.logger.log('MITRE vector tier disabled', { reason: aggregate, perLabel });
      return;
    }
    if (this.kindReasons.size > 0) {
      this.logger.warn('MITRE vector tier disabled for some kinds; the others keep it', { perLabel });
    }

    // 3. Dimension cross-check + HNSW index creation
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
    try {
      let existingIndexes: Set<string>;
      let existingDimensions: Map<string, number> | null;
      try {
        const r = await session.executeRead(async (tx: any) =>
          tx.run(
            'CALL vector_search.show_index_info() YIELD index_name, dimension RETURN index_name, dimension',
          ),
        );
        existingIndexes = new Set<string>();
        existingDimensions = new Map<string, number>();
        for (const rec of r.records as any[]) {
          const name = rec.get('index_name');
          existingIndexes.add(name);
          const dim = toNumber(rec.get('dimension'));
          if (Number.isFinite(dim)) existingDimensions.set(name, dim);
        }
      } catch (err) {
        this.logger.warn(
          'Memgraph vector index dimension projection not available — skipping cross-check',
          { error: safeErrorMessage(err) },
        );
        const r = await session.executeRead(async (tx: any) =>
          tx.run(
            'CALL vector_search.show_index_info() YIELD index_name RETURN index_name',
          ),
        );
        existingIndexes = new Set<string>(
          r.records.map((rec: any) => rec.get('index_name')),
        );
        existingDimensions = null;
      }

      const dimensions = this.embeddingService.getDimensions();
      const keys = await readVectorIndexKeys(session);

      for (const kind of this.vectorKinds) {
        const indexName = MITRE_INDEX_NAME_BY_KIND[kind];
        const label = MITRE_LABEL_BY_KIND[kind];
        const capacity = MITRE_INDEX_CAPACITY_BY_KIND[kind];

        if (!existingIndexes.has(indexName)) {
          this.logger.log(
            `Creating MITRE vector index: ${indexName} on :${label}(embedding)`,
          );
          // DDL must run as auto-committing (implicit) transaction —
          // Memgraph rejects CREATE VECTOR INDEX inside explicit/multi-
          // command transactions.
          await session.run(
            `CREATE VECTOR INDEX ${indexName} ON :${label}(embedding) ` +
              `WITH CONFIG {"dimension": ${dimensions}, "capacity": ${capacity}, "metric": "cos"}`,
          );
        } else if (existingDimensions) {
          const existing = existingDimensions.get(indexName);
          if (existing !== undefined && existing !== dimensions) {
            this.embeddingService.disableForSession(
              `MITRE vector index ${indexName} has dimension ${existing} but EMBEDDING_DIMENSIONS=${dimensions}. ` +
                `Pre-existing vectors would be scored against mismatched new vectors. ` +
                `Recommended: drop the index and restart, or set EMBEDDING_DIMENSIONS to ${existing}.`,
            );
            this.vectorPrecheckResult = {
              reason: 'MODEL_MISMATCH',
              checkedAt: Date.now(),
            };
            return;
          }
        }
        if (existingIndexes.has(indexName)) {
          await this.healMitreVectorIndex(session, { indexName, label, property: 'embedding', dimensions, capacity }, keys?.get(indexName));
        }
      }

      this.vectorIndexesEnsured = true;
    } finally {
      await session.close();
    }
  }

  /**
   * Compute vectorAvailable + vectorDisabledReason for the response
   * envelope. Reads through the cached precheck state when fresh; refreshes
   * on TTL expiry.
   */
  private async computeVectorAvailability(kind: MitreKind): Promise<{
    vectorAvailable: boolean;
    vectorDisabledReason: VectorDisabledReason | null;
  }> {
    if (!this.embeddingService.isEnabled()) {
      return {
        vectorAvailable: false,
        vectorDisabledReason: 'EMBEDDING_DISABLED',
      };
    }

    // Refresh the precheck if stale or absent.
    const fresh =
      this.vectorPrecheckResult !== null &&
      Date.now() - this.vectorPrecheckResult.checkedAt < VECTOR_CHECK_TTL_MS;
    if (!fresh) {
      // Reset the gate so ensureMitreVectorIndexes re-runs the precheck.
      this.vectorIndexesEnsured = false;
      await this.ensureMitreVectorIndexes();
    }

    const cached = this.vectorPrecheckResult;
    if (cached === null || cached.reason !== null) {
      return {
        vectorAvailable: false,
        vectorDisabledReason: cached?.reason ?? 'NO_VECTORS',
      };
    }
    // The tier is up, but this kind's own corpus failed its precheck.
    const kindReason = this.kindReasons.get(kind);
    if (kindReason) {
      return { vectorAvailable: false, vectorDisabledReason: kindReason };
    }
    // The tier is up, but this kind was skipped (no nodes): nothing to search.
    if (!this.vectorKinds.has(kind)) {
      return { vectorAvailable: false, vectorDisabledReason: 'NO_VECTORS' };
    }
    return { vectorAvailable: true, vectorDisabledReason: null };
  }

  // --- Corpus read + cache ---

  private async readCorpusFromGraph(kind: MitreKind): Promise<MitreRecord[]> {
    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
    try {
      // Filter out unkeyed taxonomy artifacts. D3FEND in particular has two
      // OWL nodes (`Defensive Technique` root, `Particle Radiation Hardening`)
      // with d3fendId = NULL — they cannot be addressed from the picker and
      // they crash the deterministic-tier matchers (`r.mitreId.toUpperCase()`
      // on null throws). Mirrors the WHERE filter on the vector precheck.
      const label = MITRE_LABEL_BY_KIND[kind];
      const key = MITRE_KEY_PROPERTY_BY_KIND[kind];
      const hop = TACTIC_HOP_BY_KIND[kind];
      const cypher = hop
        ? `MATCH (n:${label})
           WHERE n.${key} IS NOT NULL
           OPTIONAL MATCH (n)${hop.pattern}
           WITH n, tac
           ORDER BY n.id ASC, ${hop.orderBy}
           WITH n, collect(DISTINCT tac) AS tacs
           RETURN n.${key} AS mitreId,
                  n.name AS name,
                  n.description AS description,
                  CASE WHEN size(tacs) = 0 THEN null ELSE tacs[0].name END AS tactic,
                  CASE WHEN size(tacs) = 0 THEN null ELSE tacs[0].matrix_order END AS tacticOrder`
        : `MATCH (n:${label})
           WHERE n.${key} IS NOT NULL
           RETURN n.${key} AS mitreId,
                  n.name AS name,
                  n.description AS description,
                  null AS tactic,
                  null AS tacticOrder`;
      const r = await session.executeRead(async (tx: any) => tx.run(cypher));
      return r.records.map((rec: any) => ({
        mitreId: rec.get('mitreId'),
        name: rec.get('name'),
        description: rec.get('description') ?? null,
        tactic: rec.get('tactic') ?? null,
        tacticOrder: toNullableNumber(rec.get('tacticOrder')),
      }));
    } finally {
      await session.close();
    }
  }

  private async fetchMitreRecords(kind: MitreKind): Promise<MitreRecord[]> {
    const cached = this.corpusCacheByKind.get(kind);
    if (cached && Date.now() - cached.cachedAt < MITRE_CORPUS_CACHE_TTL_MS) {
      return cached.records;
    }
    const records = await this.readCorpusFromGraph(kind);
    this.corpusCacheByKind.set(kind, { records, cachedAt: Date.now() });
    return records;
  }

  // --- Deterministic tier predicates ---

  private normalizeMitreId(query: string): string {
    return query.trim().toUpperCase();
  }

  private exactIdMatch(query: string, records: MitreRecord[]): MitreRecord[] {
    const norm = this.normalizeMitreId(query);
    if (!norm) return [];
    return records.filter((r) => r.mitreId.toUpperCase() === norm);
  }

  private prefixIdMatch(
    query: string,
    records: MitreRecord[],
  ): MitreRecord[] {
    const norm = this.normalizeMitreId(query);
    if (!norm) return [];
    return records.filter((r) => {
      const id = r.mitreId.toUpperCase();
      return id.startsWith(norm) && id !== norm;
    });
  }

  private nameMatch(query: string, records: MitreRecord[]): MitreRecord[] {
    if (query.length < MIN_SUBSTRING_LENGTH) return [];
    const lower = query.toLowerCase();
    return records.filter((r) => r.name.toLowerCase().includes(lower));
  }

  private descriptionMatch(
    query: string,
    records: MitreRecord[],
  ): MitreRecord[] {
    if (query.length < MIN_SUBSTRING_LENGTH) return [];
    const lower = query.toLowerCase();
    return records.filter((r) =>
      (r.description ?? '').toLowerCase().includes(lower),
    );
  }

  // --- Vector tier ---

  private renderVectorCypher(
    kind: MitreKind,
    indexName: string,
    searchLimit: number,
    topN: number,
  ): string {
    // The `WITH node, similarity` separator between YIELD and WHERE is
    // required by the Memgraph parser. The explicit ORDER BY before `collect()`
    // makes tactic selection deterministic when a technique has multiple
    // tactics; TACTIC_HOP_BY_KIND says how each kind orders them.
    const key = MITRE_KEY_PROPERTY_BY_KIND[kind];
    const hop = TACTIC_HOP_BY_KIND[kind];
    const search = `
        CALL vector_search.search('${indexName}', ${searchLimit}, $query_vector)
        YIELD node, similarity
        WITH id(node) AS hit, similarity
        WHERE similarity >= $threshold
        // A node deleted since it was indexed can stay in the index until the database's garbage
        // collection runs, and reading it fails; matching each hit by its internal id skips it.
        MATCH (node) WHERE id(node) = hit
        WITH node, similarity`;
    if (hop) {
      return `${search}
        OPTIONAL MATCH (node)${hop.pattern}
        WITH node, similarity, tac
        ORDER BY ${hop.orderBy}
        WITH node, similarity, collect(DISTINCT tac) AS tacs
        RETURN node.${key} AS mitreId,
               node.name AS name,
               node.description AS description,
               CASE WHEN size(tacs) = 0 THEN null ELSE tacs[0].name END AS tactic,
               CASE WHEN size(tacs) = 0 THEN null ELSE tacs[0].matrix_order END AS tacticOrder,
               similarity
        ORDER BY similarity DESC
        LIMIT ${topN}
      `;
    }
    return `${search}
        RETURN node.${key} AS mitreId,
               node.name AS name,
               node.description AS description,
               null AS tactic,
               null AS tacticOrder,
               similarity
        ORDER BY similarity DESC
        LIMIT ${topN}
      `;
  }

  private async vectorSimilarityMatch(
    query: string,
    kind: MitreKind,
    topN: number,
  ): Promise<{
    hits: Array<{ record: MitreRecord; similarity: number }>;
    embeddingMs: number;
    vectorSearchMs: number;
  }> {
    if (!query.trim()) {
      return { hits: [], embeddingMs: 0, vectorSearchMs: 0 };
    }

    const embedStart = Date.now();
    let vectors: number[][] | null;
    try {
      vectors = await this.embeddingService.embedBatch([query]);
    } catch (err) {
      // Don't log the raw query — picker fires per keystroke, so an
      // embedding-service hiccup would mass-log attacker-influenced text
      // (potential PII like credentials pasted into the picker). Log
      // shape only.
      this.logger.warn('Embedding failed for vector tier, skipping', {
        kind,
        queryLength: query.length,
        error: safeErrorMessage(err),
      });
      return {
        hits: [],
        embeddingMs: Date.now() - embedStart,
        vectorSearchMs: 0,
      };
    }
    const embeddingMs = Date.now() - embedStart;
    if (!vectors || vectors.length === 0) {
      return { hits: [], embeddingMs, vectorSearchMs: 0 };
    }
    const queryVector = vectors[0];

    const indexName = MITRE_INDEX_NAME_BY_KIND[kind];
    // Oversample for the threshold filter: if the top-`topN*3` HNSW hits
    // include candidates below threshold, survivors can drop below `topN`
    // even when valid hits exist deeper in the result set. Use 10x with a
    // 50-row floor — marginal cost on a 1k-node HNSW is ~0.5ms.
    const searchLimit = Math.max(Math.floor(Number(topN) * 10), 50);
    const threshold = this.embeddingService.getThreshold();
    const cypher = this.renderVectorCypher(
      kind,
      indexName,
      searchLimit,
      Math.floor(Number(topN)),
    );

    const session = this.neo4jDriver.session({
      database: this.configService.get('database.name'),
    });
    const searchStart = Date.now();
    try {
      const r = await session.executeRead(async (tx: any) =>
        tx.run(cypher, { query_vector: queryVector, threshold }),
      );
      const hits = r.records.map((rec: any) => ({
        record: {
          mitreId: rec.get('mitreId'),
          name: rec.get('name'),
          description: rec.get('description') ?? null,
          tactic: rec.get('tactic') ?? null,
          tacticOrder: toNullableNumber(rec.get('tacticOrder')),
        },
        similarity: Number(rec.get('similarity')),
      }));
      return { hits, embeddingMs, vectorSearchMs: Date.now() - searchStart };
    } finally {
      await session.close();
    }
  }

  // --- Candidate builder ---

  private toCandidate(
    record: MitreRecord,
    kind: MitreKind,
    matchType: MitreMatchType,
    similarityScore: number | null,
  ): MitreCandidate {
    return {
      mitreId: record.mitreId,
      name: record.name,
      description: record.description,
      tactic: record.tactic,
      tacticOrder: record.tacticOrder,
      kind,
      matchType,
      similarityScore,
    };
  }

  // --- Cascade controller ---

  private async executeMatchMitreTechniques(
    input: MatchMitreTechniquesInput,
  ): Promise<{
    result: MatchMitreTechniquesResult;
    timing: {
      corpusFetchMs: number;
      deterministicMs: number;
      embeddingMs: number;
      vectorSearchMs: number;
    };
  }> {
    this.validateInput(input);

    const topN = clamp(input.topN ?? DEFAULT_TOP_N, 1, MAX_TOP_N);
    const kind = input.kind;

    // 1. Vector availability (drives the response envelope + tier-5 gate)
    const { vectorAvailable, vectorDisabledReason } =
      await this.computeVectorAvailability(kind);

    // 2. Corpus fetch (cache-aware)
    const corpusStart = Date.now();
    const records = await this.fetchMitreRecords(kind);
    const corpusFetchMs = Date.now() - corpusStart;

    const matches: TechniqueQueryMatch[] = [];
    const unmatched: string[] = [];
    let deterministicMs = 0;
    let embeddingMs = 0;
    let vectorSearchMs = 0;

    for (const q of input.queries) {
      const trimmed = q.query.trim();
      let candidates: MitreCandidate[] = [];
      let matched = false;

      // Tier 1: EXACT_ID
      const detStart = Date.now();
      const exact = this.exactIdMatch(trimmed, records);
      if (exact.length > 0) {
        candidates = exact
          .slice(0, topN)
          .map((r) => this.toCandidate(r, kind, 'EXACT_ID', null));
        matched = true;
      }

      // Tier 2: PREFIX_ID
      if (!matched) {
        const prefix = this.prefixIdMatch(trimmed, records);
        if (prefix.length > 0) {
          candidates = prefix
            .sort(byMitreIdAsc)
            .slice(0, topN)
            .map((r) => this.toCandidate(r, kind, 'PREFIX_ID', null));
          matched = true;
        }
      }

      // Tier 3: NAME_MATCH (gated on MIN_SUBSTRING_LENGTH)
      if (!matched && trimmed.length >= MIN_SUBSTRING_LENGTH) {
        const name = this.nameMatch(trimmed, records);
        if (name.length > 0) {
          candidates = name
            .sort(byMitreIdAsc)
            .slice(0, topN)
            .map((r) => this.toCandidate(r, kind, 'NAME_MATCH', null));
          matched = true;
        }
      }

      // Tier 4: DESCRIPTION_MATCH (gated on MIN_SUBSTRING_LENGTH)
      if (!matched && trimmed.length >= MIN_SUBSTRING_LENGTH) {
        const desc = this.descriptionMatch(trimmed, records);
        if (desc.length > 0) {
          candidates = desc
            .sort(byMitreIdAsc)
            .slice(0, topN)
            .map((r) => this.toCandidate(r, kind, 'DESCRIPTION_MATCH', null));
          matched = true;
        }
      }
      deterministicMs += Date.now() - detStart;

      // Tier 5: VECTOR_SIMILARITY
      if (!matched && vectorAvailable && trimmed.length > 0) {
        const vec = await this.vectorSimilarityMatch(trimmed, kind, topN);
        embeddingMs += vec.embeddingMs;
        vectorSearchMs += vec.vectorSearchMs;
        if (vec.hits.length > 0) {
          candidates = vec.hits.map(({ record, similarity }) =>
            this.toCandidate(record, kind, 'VECTOR_SIMILARITY', similarity),
          );
          matched = true;
        }
      }

      if (matched) {
        matches.push({ query: q.query, candidates });
      } else {
        unmatched.push(q.query);
      }
    }

    return {
      result: { matches, unmatched, vectorAvailable, vectorDisabledReason },
      timing: { corpusFetchMs, deterministicMs, embeddingMs, vectorSearchMs },
    };
  }

  // --- Test-only inspection ---

  /**
   * Test-only inspection of the corpus cache state. NOT part of the public
   * API; do not call from production code. Exposed so e2e specs can verify
   * cache-hit behaviour without instrumenting the neo4j driver.
   */
  __testOnlyCacheSnapshot(): Array<{
    kind: MitreKind;
    size: number;
    cachedAt: number;
  }> {
    return Array.from(this.corpusCacheByKind.entries()).map(([k, v]) => ({
      kind: k,
      size: v.records.length,
      cachedAt: v.cachedAt,
    }));
  }

  // --- Resolver registration ---

  getResolvers() {
    return {
      Query: {
        matchMitreTechniques: async (
          _parent: any,
          args: { input: MatchMitreTechniquesInput },
          context: any,
        ) => {
          const startTime = Date.now();
          const authContext =
            this.authorizationService.extractAuthContext(context);

          const authResult =
            await this.authorizationService.checkAuthorization(authContext, {
              operationType: 'query',
              operationName: 'matchMitreTechniques',
              resourceType: 'Mitre',
            });

          if (!authResult.allowed) {
            throw new Error(
              `Authorization denied: ${authResult.reason || 'insufficient permissions'}`,
            );
          }

          try {
            const { result, timing } =
              await this.executeMatchMitreTechniques(args.input);
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'matchMitreTechniques',
              duration,
              success: true,
              timestamp: new Date(),
              metadata: {
                queryCount: args.input.queries.length,
                matchCount: result.matches.length,
                unmatchedCount: result.unmatched.length,
                kind: args.input.kind,
                vectorAvailable: result.vectorAvailable,
                vectorDisabledReason: result.vectorDisabledReason,
                corpusFetchMs: timing.corpusFetchMs,
                deterministicMs: timing.deterministicMs,
                embeddingMs: timing.embeddingMs,
                vectorSearchMs: timing.vectorSearchMs,
              },
            });

            this.logger.debug('matchMitreTechniques completed', {
              queryCount: args.input.queries.length,
              matchCount: result.matches.length,
              unmatchedCount: result.unmatched.length,
              kind: args.input.kind,
              vectorAvailable: result.vectorAvailable,
              vectorDisabledReason: result.vectorDisabledReason,
              duration,
            });

            return result;
          } catch (error) {
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'matchMitreTechniques',
              duration,
              success: false,
              timestamp: new Date(),
              metadata: {
                error: safeErrorMessage(error),
                kind: args.input?.kind,
              },
            });

            this.logger.error('matchMitreTechniques failed', {
              error: safeErrorMessage(error),
              kind: args.input?.kind,
              queryCount: args.input?.queries?.length,
              duration,
            });

            throw new Error(
              safeErrorMessage(error, 'matchMitreTechniques failed'),
              { cause: error },
            );
          }
        },
      },
    };
  }
}
