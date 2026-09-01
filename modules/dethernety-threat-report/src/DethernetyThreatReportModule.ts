import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  DTModule,
  DTMetadata,
  ModuleResolverContext,
  ResolverMap,
  ExtendedPubSubEngine,
} from '@dethernety/dt-module';
import { AnalysisSession, AnalysisStatus } from '@dethernety/dt-core';
import type { ZoningFinding, EffectiveZone } from '@dethernety/dt-core';
import { computeZoning, type ZoningEngine } from './zoning-adapter';

/**
 * Normalize a graph-engine numeric value to a plain JS number (or null).
 * Handles native numbers, graph-engine Integer wrappers (toNumber()), and
 * string-encoded numerics, so the snapshot doc JSON-stringifies cleanly.
 */
function toNum(v: any): number | null {
  return v == null
    ? null
    : typeof v === 'number'
      ? v
      : typeof v?.toNumber === 'function'
        ? v.toNumber()
        : Number(v);
}

/**
 * Dethernety Threat Report — a read-only, query-based threat-report surface
 * over an existing threat model.
 *
 * This is a "pure" DTModule: it ships NO threat-modelling classes (no
 * components, controls, exposures, policies) and runs NO AI/LangGraph analysis.
 * It mounts entirely through the platform's *native* analysis lifecycle, with
 * zero edits to dt-ui / dt-ws / dt-core:
 *
 *   1. getMetadata().analysisClasses declares one non-AI analysis class. The
 *      module-management reconciler MERGEs the (:Module) node and creates the
 *      (:AnalysisClass) + (:Module)-[:HAS_CLASS]->(:AnalysisClass) edge, so the
 *      class appears in the "New Analysis" menu of a model's Analysis tab.
 *   2. The user creates an instance via the platform's createAnalysisIdempotent
 *      mutation (which wires (:Model)-[:ANALYZED_BY]->(:Analysis) and
 *      (:Analysis)-[:IS_INSTANCE_OF]->(:AnalysisClass) — but stores no document).
 *   3. runAnalysis() is the "generate snapshot" step: it computes a snapshot
 *      over the model and persists it as a JSON property on the standing
 *      Analysis node (the platform's createAnalysisIdempotent never writes a
 *      document field, and the default LangGraph-backed document store is NOT
 *      inherited by a plain DTModule — so the module owns persistence).
 *   4. getAnalysisStatus() returns 'idle' so the Analysis tab's "Results" action
 *      is enabled (it gates on status === 'idle').
 *   5. Opening "Results" routes to /analysisresults, which calls
 *      getDocument({ filter: { document: 'index' } }); we return the snapshot
 *      keyed by the frontend component key (REPORT_COMPONENT_KEY), which the
 *      page resolves via componentRegistry.getComponent(key) and renders.
 *
 * The driver handed to the constructor is the secure, session-scoping driver;
 * resolvers and interface methods must NOT implement their own authz — the JWT
 * guard + session scoping own that.
 */

/**
 * Stable id for the single analysis class this module contributes. Stable
 * because it anchors both the (:Module)-[:HAS_CLASS]->(:AnalysisClass) edge and
 * the getDocument dispatch lookup; it must not change across deployments.
 */
const ANALYSIS_CLASS_ID = 'dethernety-threat-report-snapshot';

/**
 * Key under which the frontend bundle registers its root component
 * (see frontend/index.js). getDocument returns the snapshot under this key so
 * the analysis-results page resolves the right component. Must match exactly.
 */
const REPORT_COMPONENT_KEY = 'threat_report_dashboard';

/** One finding (Exposure) row in the ledger — the fields a residual-risk
 *  reviewer needs. All values are JSON-safe (no graph-engine Integer/temporal
 *  objects); see computeLedger's normalization. */
interface LedgerFinding {
  id: string;
  name: string;
  score: number | null;
  attackVector: string | null;
  description: string | null; // the exposure's own free-text description
  type: string | null; // exposure type classifier
  category: string | null; // exposure category classifier
  references: string | null; // external refs (URLs, CVE IDs) — free text
  mitigationSuggestions: string[]; // class-authored SUGGESTIONS, not applied controls
  detectionMethods: string[]; // how this exposure would be detected
  tags: string[]; // filtering/grouping labels
  createdBy: string | null; // 'USER' | 'SYSTEM'
  authoredBy: string | null;
  dispositionKind: string | null; // null OR 'AFFIRMED' = live (confirmed real); any other kind = muted
  dispositionReason: string | null;
  dispositionedBy: string | null;
  dispositionedAt: string | null;
  dispositionStale: boolean | null;
}

/** A control supporting an element — shown as muted "controls present" context,
 *  never a coverage claim (coverage grading is owned by a separate module). */
interface LedgerControl {
  id: string;
  name: string;
  type: string | null;
  category: string | null;
}

/** One model element with its findings + supporting controls. */
interface LedgerElement {
  id: string;
  name: string;
  type: 'Component' | 'DataFlow' | 'SecurityBoundary' | 'Data';
  findings: LedgerFinding[];
  supportingControls: LedgerControl[];
}

/** A security boundary with its canvas geometry + nesting parent. The geometry
 *  (parent-relative positionX/Y + width/height) lets the minimap reproduce the
 *  hand-laid layout; parentBoundaryId drives both the minimap's nesting and the
 *  Boundary Crossings engine's ancestor-stack walk. */
interface ModelGraphBoundary {
  id: string;
  name: string;
  description: string | null; // the element's own free-text description
  className: string | null; // name of the class this element instantiates
  classDescription: string | null; // that class's description
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
  parentBoundaryId: string | null; // null ⇒ top-level
  // Trust-zoning declarations. `zone` is the declared zone (null ⇒ inherit); `planes`
  // operational planes; `domains` free-text business tags; `conduits` declared OUTBOUND approved
  // channels. Fed to the dt-core engine via the zoning adapter, and consumed raw by the frontend
  // data-flow-policy engine (domains/planes/conduits drive the per-flow verdicts).
  zone: string | null;
  planes: string[];
  domains: string[];
  conduits: { peerId: string; direction: 'OUTBOUND'; justification: string | null }[];
}

/** A component with its canvas geometry, DFD type (lower-cased for the minimap),
 *  parent boundary, and crown-jewel flag. */
interface ModelGraphComponent {
  id: string;
  name: string;
  description: string | null; // the element's own free-text description
  className: string | null; // name of the class this element instantiates
  classDescription: string | null; // that class's description
  type: string | null; // 'process' | 'store' | 'external_entity' | … (lower-cased)
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
  boundaryId: string | null; // the resolved parent boundary; in practice every discovered component belongs to the boundary tree, so this is null only if the parent did not resolve
  crownJewel: boolean;
}

/** A flow as a component-to-component edge, with the data sensitivities it
 *  carries. `sensitivities` excludes nulls; `dataItemCount` is the total carried
 *  data count — so the engine distinguishes "no data" (count 0) from
 *  "data-in-motion but unclassified" (count > 0, sensitivities empty). */
interface ModelGraphFlow {
  id: string;
  name: string;
  description: string | null; // the element's own free-text description
  className: string | null; // name of the class this element instantiates
  classDescription: string | null; // that class's description
  sourceId: string | null;
  targetId: string | null;
  sensitivities: string[]; // SensitivityLevel values, nulls dropped
  dataItemCount: number;
}

/** A Data node with its author-asserted sensitivity and the ids of the elements
 *  that HANDLE it (Component / DataFlow / SecurityBoundary). `sensitivity` is
 *  null ⇒ unclassified (never coerced to a level). Feeds the Component Profile
 *  data-handled sub-block: the frontend reverse-indexes `handledBy` to list, per
 *  element, the Data it handles, then joins each `id` to its existing `ledger`
 *  entry for that Data's own exposures (coverage is attributed to the handling
 *  element — Data nodes carry no typed control support). Data exposures are NOT
 *  duplicated here; only the sensitivity + handling topology the ledger lacks. */
interface ModelGraphDataNode {
  id: string;
  name: string;
  description: string | null; // the element's own free-text description
  className: string | null; // name of the class this element instantiates
  classDescription: string | null; // that class's description
  sensitivity: string | null; // SensitivityLevel value, null ⇒ unclassified
  regulatoryFlags: string[]; // regulatory scopes (e.g. "PCI", "PHI"); a non-empty set makes the data an asset
  handledBy: string[]; // element ids with (el)-[:HANDLES]->(this Data)
}

/** The positional model graph — the minimap's `modelGraph` contract and the
 *  Boundary Crossings engine's structural input. Gathered at generate time so the
 *  report is snapshot-faithful (same as-of-generation model as the ledger). */
interface ModelGraph {
  boundaries: ModelGraphBoundary[];
  components: ModelGraphComponent[];
  flows: ModelGraphFlow[];
  /** Data nodes + their HANDLES topology, for the Component Profile data-handled
   *  sub-block. The sensitivity + handler ids the raw `ledger` doesn't carry;
   *  Data's own exposures still come from the ledger (Data is a first-class ledger
   *  element). */
  dataNodes: ModelGraphDataNode[];
}

interface SnapshotDoc {
  generated: boolean;
  modelId?: string;
  generatedAt?: string;
  fingerprint?: string;
  componentCount?: number;
  boundaryCount?: number;
  /** The residual-risk ledger: every element's findings + supporting controls,
   *  gathered at generate time (the frontend aggregates/presents, pure-TS). */
  ledger?: LedgerElement[];
  /** The positional model graph (boundaries/components/flows with canvas
   *  geometry + nesting + per-flow carried sensitivity). Feeds the faithful
   *  minimap and the Boundary Crossings engine; both pure-TS over this + the
   *  raw `ledger` (which carries each element's exposures + supporting controls,
   *  reused for crossed-boundary / on-flow posture — no separate posture query). */
  modelGraph?: ModelGraph;
  /** Computed trust-zoning block: the per-boundary declared effective zones (`effectiveZones`) + the
   *  advisory zoning findings (`findings`), computed at generate time by reusing the dt-core zoning
   *  engine over the model graph. `effectiveZones` is the DECLARED effective zone (declared/inherited/
   *  default, authoritative) — never the topological `determineZoneTier` proposal. Graceful-degrades to empty
   *  (`{ findings: [], effectiveZones: {} }`) on any adapter/engine failure so a zoning fault never
   *  takes down the ledger/modelGraph snapshot. Absent on pre-zoning snapshots — the frontend defaults it. */
  zoning?: { findings: ZoningFinding[]; effectiveZones: Record<string, EffectiveZone> };
}

class DethernetyThreatReportModule implements DTModule {
  private readonly logger: Logger;
  private readonly driver: any;
  /** Captured from the resolver context at startup; used by the no-context
   *  interface methods (runAnalysis/getDocument/getAnalysisStatus) to open
   *  correctly-scoped sessions. Undefined ⇒ the driver's default database. */
  private databaseName: string | undefined;

  constructor(driver: any, logger: Logger) {
    this.driver = driver;
    this.logger = logger;
  }

  getMetadata(): DTMetadata {
    return {
      name: 'dethernety-threat-report',
      description: 'Query-based threat reporting with interactive dashboards.',
      version: '1.0.0',
      author: 'Dethernety',
      analysisClasses: [
        {
          id: ANALYSIS_CLASS_ID,
          name: 'Threat Report',
          description:
            'Read-only posture snapshot — a query-based threat report over this model.',
          // `model_analysis` is the platform contract for a model-scoped analysis
          // creatable from the model's Analysis tab: dt-ui's New Analysis menu
          // fetches only classes of this type (layouts/default.vue →
          // fetchAnalysisClasses({ classType: 'model_analysis' })). `category`
          // is free-form and distinguishes this as a reporting analysis.
          type: 'model_analysis',
          category: 'reporting',
          icon: 'mdi-file-chart-outline',
        },
      ],
    };
  }

  /**
   * One custom query: a cheap structural fingerprint of a model's current
   * report-relevant content. The frontend compares the live fingerprint to the
   * one stored in a snapshot to detect staleness. Every field declared here has
   * a resolver in getResolvers().
   */
  getSchemaExtension(): string {
    return /* GraphQL */ `
      extend type Query {
        """Structural fingerprint of a model's current threat-report-relevant content (counts + element ids, hashed). Cheap; used for snapshot staleness detection."""
        threatReportFingerprint(modelId: ID!): String
      }
    `;
  }

  getResolvers(context: ModuleResolverContext): ResolverMap {
    // getResolvers is called once at startup — capture the database name here
    // so the no-context interface methods can open scoped sessions.
    this.databaseName = context.databaseName;

    return {
      Query: {
        threatReportFingerprint: async (_parent, args) => {
          const modelId = String(args?.modelId ?? '');
          if (!modelId) return null;
          const { fingerprint } = await this.computeStructure(modelId);
          return fingerprint;
        },
      },
    };
  }

  private session() {
    return this.driver.session(
      this.databaseName ? { database: this.databaseName } : {},
    );
  }

  /**
   * Compute the model's structural digest. Elements reach the model via the
   * boundary forest: (:Model)-[:CONTAINS]->(top:SecurityBoundary), then
   * descendants via BELONGS_TO, then (:Component)-[:BELONGS_TO]->(boundary);
   * DataFlows hang off components via FLOWS; Data via (:Model)-[:CONTAINS].
   * This mirrors the platform's own traversals, so it is engine-portable (the
   * *0..50 bound matches the schema's allDescendantComponents).
   *
   * The digest is hashed in TS (sorted ids) to stay independent of any
   * graph-engine hash function. It is DISPOSITION-AWARE: alongside the element
   * ids it folds in each exposure's id + disposition signature
   * (dispositionKind + dispositionStale, via HAS_EXPOSURE across all four
   * element types). So disposing/clearing a finding or a stale-flip changes the
   * fingerprint (→ the open snapshot reads stale), while a no-op model save does
   * not. This is what the staleness UX compares the snapshot's stored
   * fingerprint against.
   *
   * It is also SENSITIVITY- and HANDLES-AWARE: each Data's id + sensitivity
   * and each (element)-[:HANDLES]->(Data) edge are folded in, because the
   * Boundary Crossings ranking and the Component Profile data sub-block render
   * those — so re-classifying a Data (PUBLIC→RESTRICTED) or re-wiring which
   * element handles it flips the fingerprint, instead of a now-misclassified
   * snapshot reading "fresh". Stays cheap (scalar id/sensitivity collects only —
   * never the full ledger), so the live staleness poll remains light.
   */
  private async computeStructure(
    modelId: string,
  ): Promise<{ fingerprint: string; componentCount: number; boundaryCount: number }> {
    const session = this.session();
    try {
      const result = await session.run(
        `MATCH (m:Model {id: $modelId})
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(b:SecurityBoundary)
         WITH m, collect(DISTINCT b) AS bs
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(c:Component)
         WITH m, bs, collect(DISTINCT c) AS cs
         OPTIONAL MATCH (m)-[:CONTAINS]->(d:Data)
         WITH m, bs, cs, collect(DISTINCT d) AS ds
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(:Component)-[:FLOWS]-(df:DataFlow)
         WITH bs, cs, ds, collect(DISTINCT df) AS fs
         WITH [x IN bs | x.id] AS boundaryIds,
              [x IN cs | x.id] AS componentIds,
              [x IN ds | x.id] AS dataIds,
              [x IN ds | x.id + '|' + coalesce(x.sensitivity, '')] AS dataSigs,
              [x IN fs | x.id] AS dataFlowIds,
              bs + cs + ds + fs AS allEls
         UNWIND (CASE WHEN size(allEls) = 0 THEN [null] ELSE allEls END) AS el
         WITH boundaryIds, componentIds, dataIds, dataSigs, dataFlowIds, el WHERE el IS NOT NULL
         OPTIONAL MATCH (el)-[:HAS_EXPOSURE]->(ex:Exposure)
         OPTIONAL MATCH (el)-[:HANDLES]->(hd:Data)
         WITH boundaryIds, componentIds, dataIds, dataSigs, dataFlowIds,
              collect(DISTINCT ex.id + '|' + coalesce(ex.dispositionKind, '') + '|' + coalesce(toString(ex.dispositionStale), '')) AS exposureSigs,
              collect(DISTINCT el.id + '|' + hd.id) AS handlesSigs
         RETURN boundaryIds, componentIds, dataIds, dataSigs, dataFlowIds, exposureSigs, handlesSigs`,
        { modelId },
      );
      const rec = result.records[0];
      const boundaryIds: string[] = (rec?.get('boundaryIds') ?? []) as string[];
      const componentIds: string[] = (rec?.get('componentIds') ?? []) as string[];
      const dataIds: string[] = (rec?.get('dataIds') ?? []) as string[];
      const dataSigs: string[] = (rec?.get('dataSigs') ?? []) as string[];
      const dataFlowIds: string[] = (rec?.get('dataFlowIds') ?? []) as string[];
      const exposureSigs: string[] = (rec?.get('exposureSigs') ?? []) as string[];
      // (el)-[:HANDLES]->(hd) yields "elId|hdId" pairs; for an el with no HANDLES
      // the concat with a null hd is null, which collect() drops — so this holds
      // exactly the real handler→data edges. Re-wiring HANDLES changes the set.
      const handlesSigs: string[] = (rec?.get('handlesSigs') ?? []) as string[];

      // ZONING staleness signals — a separate structural query so the proven digest query above stays
      // untouched. Every input the zoning engine reads must fold in, or a re-zoned/re-tagged/re-wired
      // model would read FRESH: per-boundary zone/planes/domains, crownJewel flags (also fixes a
      // pre-existing gap — crownJewel drove no prior digest term), Data regulatory flags (a flag alone
      // makes data an asset), declared CONDUIT edges, and flow ENDPOINTS (re-wiring a flow, same id,
      // changes the boundary adjacency → tiers/findings). List members are sorted in TS for
      // determinism; the sentinel keeps one returned row even when there are no flows.
      const zoningRes = await session.run(
        `MATCH (m:Model {id: $modelId})
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(b:SecurityBoundary)
         OPTIONAL MATCH (b)-[:BELONGS_TO]->(bp:SecurityBoundary)
         WITH m, collect(DISTINCT { id: b.id, zone: coalesce(b.zone, ''), planes: coalesce(b.planes, []), domains: coalesce(b.domains, []), parent: coalesce(bp.id, '') }) AS bZoning
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(cb:SecurityBoundary)<-[:BELONGS_TO]-(c:Component)
         WITH m, bZoning, collect(DISTINCT c.id + '|' + coalesce(toString(c.crownJewel), '') + '<' + cb.id) AS cjSigs
         OPTIONAL MATCH (m)-[:CONTAINS]->(d:Data)
         WITH m, bZoning, cjSigs, collect(DISTINCT { id: d.id, flags: coalesce(d.regulatoryFlags, []) }) AS dRegs
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(bc:SecurityBoundary)-[co:CONDUIT]->(peer:SecurityBoundary)
         WITH m, bZoning, cjSigs, dRegs, collect(DISTINCT bc.id + '>' + peer.id + '|' + coalesce(co.justification, '')) AS conduitSigs
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(:Component)-[:FLOWS]-(df:DataFlow)
         WITH bZoning, cjSigs, dRegs, conduitSigs, collect(DISTINCT df) AS fs
         UNWIND (CASE WHEN size(fs) = 0 THEN [null] ELSE fs END) AS df
         OPTIONAL MATCH (s:Component)-[:FLOWS]->(df)
         WITH bZoning, cjSigs, dRegs, conduitSigs, df, collect(DISTINCT s.id) AS srcIds
         OPTIONAL MATCH (df)-[:FLOWS]->(t:Component)
         WITH bZoning, cjSigs, dRegs, conduitSigs, df, srcIds, collect(DISTINCT t.id) AS tgtIds
         WITH bZoning, cjSigs, dRegs, conduitSigs,
              collect(CASE WHEN df IS NULL THEN NULL ELSE df.id + '|' + coalesce(head(srcIds), '') + '>' + coalesce(head(tgtIds), '') END) AS flowSigsRaw
         RETURN bZoning, cjSigs, dRegs, conduitSigs, [x IN flowSigsRaw WHERE x IS NOT NULL] AS flowSigs`,
        { modelId },
      );
      const zrec = zoningRes.records[0];
      const bZoning = (zrec?.get('bZoning') ?? []) as { id: string; zone: string; planes: string[]; domains: string[]; parent: string }[];
      const cjSigs = (zrec?.get('cjSigs') ?? []) as string[];
      const dRegs = (zrec?.get('dRegs') ?? []) as { id: string; flags: string[] }[];
      const conduitSigs = (zrec?.get('conduitSigs') ?? []) as string[];
      const flowEndpointSigs = (zrec?.get('flowSigs') ?? []) as string[];

      const sortedJoin = (xs: string[] | undefined): string => [...(xs ?? [])].sort().join(',');
      // `.filter(b => b.id)` drops the `{id:null}` sentinel map an empty model yields (the map-valued
      // collects don't null-drop like the string-concat ones). `parent`/`<cb.id` fold CONTAINMENT into
      // the digest so re-parenting a boundary or moving a component between boundaries (both change the
      // engine's tiers/findings via the nesting parentMap) flips the fingerprint instead of reading fresh.
      const boundaryZoningSigs = bZoning
        .filter((b) => b.id)
        .map((b) => `${b.id}|${b.zone ?? ''}|${sortedJoin(b.planes)}|${sortedJoin(b.domains)}|${b.parent ?? ''}`)
        .sort();
      const dataRegulatorySigs = dRegs.filter((d) => d.id).map((d) => `${d.id}|${sortedJoin(d.flags)}`).sort();

      const digestInput = JSON.stringify({
        b: [...boundaryIds].sort(),
        c: [...componentIds].sort(),
        d: [...dataIds].sort(),
        ds: [...dataSigs].sort(), // Data id|sensitivity — Boundary Crossings / Component Profile render sensitivity
        f: [...dataFlowIds].sort(),
        e: [...exposureSigs].sort(),
        h: [...handlesSigs].sort(), // HANDLES edges — Component Profile data sub-block
        bz: boundaryZoningSigs, // boundary zone/planes/domains + parent — tiers/mgmt-plane/domain findings + nesting
        cj: [...cjSigs].sort(), // crownJewel flags + component→boundary — directAssetIds/tiers + component containment
        dr: dataRegulatorySigs, // Data regulatory flags — a flag alone makes data an asset
        cd: [...conduitSigs].sort(), // declared CONDUIT edges — conduit-policy findings
        fe: [...flowEndpointSigs].sort(), // flow endpoints — adjacency → tiers/ingress findings
      });
      const fingerprint = createHash('sha256')
        .update(digestInput)
        .digest('hex')
        .slice(0, 16);

      return {
        fingerprint,
        componentCount: componentIds.length,
        boundaryCount: boundaryIds.length,
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Gather the full residual-risk ledger for a model in ONE query: every
   * element (Component + DataFlow + SecurityBoundary + Data) with its findings
   * (Exposures, full disposition + provenance fields) and its supporting
   * controls. Heavier than computeStructure (which is the cheap fingerprint
   * digest) — only run at generate time, never on the live staleness check.
   *
   * Element discovery mirrors the platform's own model→all-elements traversal
   * (control-gaps-resolver) and the fingerprint query. Maps are built with
   * scalar fields only (no nodes-in-maps) + labels()-derived type, for
   * Neo4j/Memgraph portability; toString() the timestamp; Integer score is
   * normalized to a JS number below so the doc JSON-stringifies cleanly.
   *
   * SHAPE IS LOAD-BEARING — three engine behaviours, each measured on Memgraph
   * 3.8.1 (see test/compute-ledger.e2e.spec.ts), and each of which silently
   * returns plausible-but-wrong data rather than erroring:
   *
   *  1. DEDUPE ON THE NODE, NOT ON A PROJECTED MAP. `collect(DISTINCT <map>)`
   *     does not dedupe when any map VALUE is null, and most exposure fields
   *     are null on an active finding. That inflated `findings` ~8x and, via
   *     duplicate SUPPORTS edges, `supportingControls` ~6x.
   *  2. NEVER CARRY A `List<Map>` AS A GROUPING KEY. The previous shape put
   *     `findings` in the second `WITH`, which failed to collapse and
   *     multiplied the element rows themselves ~8x.
   *  3. RE-PROJECT FROM SCALAR TUPLES BY INDEX — never from the collected
   *     node. A list comprehension whose map performs two or more bare
   *     property accesses on the loop variable (`[ex IN exs | {id: ex.id,
   *     name: ex.name}]`) yields the FIRST element repeated N times, dropping
   *     every other entry. Measured: right count, wrong contents — strictly
   *     worse than the inflation it replaced. Wrapping each access in a
   *     function also avoids it, but the tuple form is the one pinned by a
   *     test, and it preserves nulls where `coalesce` would erase them.
   *
   *  4. THE `CASE WHEN … IS NULL` GUARD IS LOAD-BEARING. `collect` skips a
   *     null, but a TUPLE of nulls is not null — so an element with no
   *     exposures would collect one phantom finding whose every field is null,
   *     and the report would render it. The guard is what keeps an
   *     unexposed element's array empty.
   *
   * So: `collect(DISTINCT CASE WHEN … IS NULL THEN NULL ELSE [scalars…] END)`,
   * then index the tuple. The tuple is the dedupe key, which is why
   * `toString()` is applied inside the collect — the projection must not
   * re-touch the node.
   */
  private async computeLedger(modelId: string): Promise<LedgerElement[]> {
    const session = this.session();
    try {
      const result = await session.run(
        `MATCH (m:Model {id: $modelId})
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(b:SecurityBoundary)
         WITH m, collect(DISTINCT b) AS bs
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(c:Component)
         WITH m, bs, collect(DISTINCT c) AS cs
         OPTIONAL MATCH (m)-[:CONTAINS]->(d:Data)
         WITH m, bs, cs, collect(DISTINCT d) AS ds
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(:Component)-[:FLOWS]-(df:DataFlow)
         WITH bs + cs + ds + collect(DISTINCT df) AS els
         UNWIND (CASE WHEN size(els) = 0 THEN [null] ELSE els END) AS el
         WITH el WHERE el IS NOT NULL
         WITH el, [lbl IN labels(el) WHERE lbl IN ['Component', 'DataFlow', 'SecurityBoundary', 'Data']][0] AS elType
         OPTIONAL MATCH (el)-[:HAS_EXPOSURE]->(ex:Exposure)
         OPTIONAL MATCH (ctrl:Control)-[:SUPPORTS]->(el)
         WITH el, elType,
           collect(DISTINCT CASE WHEN ex IS NULL THEN NULL ELSE
             [ex.id, ex.name, ex.score, ex.attackVector, ex.description, ex.type,
              ex.category, ex.references, ex.mitigationSuggestions,
              ex.detectionMethods, ex.tags, ex.createdBy, ex.authoredBy,
              ex.dispositionKind, ex.dispositionReason, ex.dispositionedBy,
              toString(ex.dispositionedAt), ex.dispositionStale] END) AS exs,
           collect(DISTINCT CASE WHEN ctrl IS NULL THEN NULL ELSE
             [ctrl.id, ctrl.name, ctrl.type, ctrl.category] END) AS ctrls
         RETURN collect({ id: el.id, name: el.name, type: elType,
           findings: [t IN exs | {
             id: t[0], name: t[1], score: t[2], attackVector: t[3], description: t[4],
             type: t[5], category: t[6], references: t[7], mitigationSuggestions: t[8],
             detectionMethods: t[9], tags: t[10], createdBy: t[11], authoredBy: t[12],
             dispositionKind: t[13], dispositionReason: t[14], dispositionedBy: t[15],
             dispositionedAt: t[16], dispositionStale: t[17] }],
           supportingControls: [u IN ctrls | {
             id: u[0], name: u[1], type: u[2], category: u[3] }] }) AS ledger`,
        { modelId },
      );

      const raw = (result.records[0]?.get('ledger') ?? []) as any[];
      return raw.map((el) => ({
        id: el.id,
        name: el.name ?? '',
        type: el.type,
        findings: (el.findings ?? []).map((f: any) => ({
          id: f.id,
          name: f.name ?? '',
          score: toNum(f.score),
          attackVector: f.attackVector ?? null,
          description: f.description ?? null,
          type: f.type ?? null,
          category: f.category ?? null,
          references: f.references ?? null,
          mitigationSuggestions: Array.isArray(f.mitigationSuggestions) ? f.mitigationSuggestions : [],
          detectionMethods: Array.isArray(f.detectionMethods) ? f.detectionMethods : [],
          tags: Array.isArray(f.tags) ? f.tags : [],
          createdBy: f.createdBy ?? null,
          authoredBy: f.authoredBy ?? null,
          dispositionKind: f.dispositionKind ?? null,
          dispositionReason: f.dispositionReason ?? null,
          dispositionedBy: f.dispositionedBy ?? null,
          dispositionedAt: f.dispositionedAt ?? null,
          dispositionStale: f.dispositionStale ?? null,
        })),
        supportingControls: (el.supportingControls ?? []).map((c: any) => ({
          id: c.id,
          name: c.name ?? '',
          type: c.type ?? null,
          category: c.category ?? null,
        })),
      }));
    } finally {
      await session.close();
    }
  }

  /**
   * Gather the positional model graph (boundaries/components/flows with canvas
   * geometry + nesting + per-flow carried data sensitivity) for a model. Feeds
   * the faithful minimap and the Boundary Crossings engine — both pure-TS over
   * this graph joined with the raw `ledger` (which already carries every
   * element's exposures + supporting controls, reused for crossed-boundary /
   * on-flow posture, so Boundary Crossings needs no separate posture query).
   *
   * Four small, independently-portable passes (boundaries, components, flows,
   * dataNodes), each in the same OPTIONAL MATCH + collect style as computeLedger — no
   * pattern comprehensions, no nodes-in-maps, scalar fields only — so they run
   * on both Neo4j and Memgraph. Element discovery mirrors computeStructure /
   * computeLedger (same boundary-forest traversal), so the modelGraph element
   * set matches the ledger's exactly. Canvas geometry uses the schema's
   * dimensionsWidth/Height (aliased to width/height for the minimap); the
   * component DFD type is lower-cased to match the minimap's shape vocabulary.
   */
  private async computeModelGraph(modelId: string): Promise<ModelGraph> {
    const session = this.session();
    try {
      const boundariesRes = await session.run(
        `MATCH (m:Model {id: $modelId})
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(b:SecurityBoundary)
         WITH collect(DISTINCT b) AS bs
         UNWIND (CASE WHEN size(bs) = 0 THEN [null] ELSE bs END) AS b
         WITH b WHERE b IS NOT NULL
         OPTIONAL MATCH (b)-[:BELONGS_TO]->(pb:SecurityBoundary)
         OPTIONAL MATCH (b)-[:IS_INSTANCE_OF]->(bcls)
         // head() assumes a single class per element (the platform assigns one), so it is deterministic in practice.
         WITH b, head(collect(DISTINCT pb)) AS pb, head(collect(DISTINCT bcls)) AS cls
         RETURN collect({
           id: b.id, name: b.name, description: b.description,
           positionX: b.positionX, positionY: b.positionY,
           width: b.dimensionsWidth, height: b.dimensionsHeight,
           parentBoundaryId: pb.id,
           zone: b.zone, planes: b.planes, domains: b.domains,
           className: cls.name, classDescription: cls.description
         }) AS boundaries`,
        { modelId },
      );

      // The boundary-forest traversal intentionally mirrors the platform's
      // canonical model->elements enumeration, so an element outside the model's
      // boundary tree is out of scope by the same definition the platform uses.
      const componentsRes = await session.run(
        `MATCH (m:Model {id: $modelId})
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(c:Component)
         WITH collect(DISTINCT c) AS cs
         UNWIND (CASE WHEN size(cs) = 0 THEN [null] ELSE cs END) AS c
         WITH c WHERE c IS NOT NULL
         OPTIONAL MATCH (c)-[:BELONGS_TO]->(cb:SecurityBoundary)
         OPTIONAL MATCH (c)-[:IS_INSTANCE_OF]->(ccls)
         // head() assumes a single class per element (the platform assigns one), so it is deterministic in practice.
         WITH c, head(collect(DISTINCT cb)) AS cb, head(collect(DISTINCT ccls)) AS cls
         RETURN collect({
           id: c.id, name: c.name, description: c.description, type: toLower(c.type),
           positionX: c.positionX, positionY: c.positionY,
           width: c.dimensionsWidth, height: c.dimensionsHeight,
           boundaryId: cb.id, crownJewel: c.crownJewel,
           className: cls.name, classDescription: cls.description
         }) AS components`,
        { modelId },
      );

      const flowsRes = await session.run(
        `MATCH (m:Model {id: $modelId})
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(:Component)-[:FLOWS]-(df:DataFlow)
         WITH collect(DISTINCT df) AS fs
         UNWIND (CASE WHEN size(fs) = 0 THEN [null] ELSE fs END) AS df
         WITH df WHERE df IS NOT NULL
         // Resolve endpoints by collecting + head() rather than two OPTIONAL
         // MATCHes that multiply rows: the schema types source/target as lists,
         // so a malformed multi-endpoint DataFlow would otherwise fan out into
         // duplicate flow-id rows with conflicting endpoints. One row per df.
         OPTIONAL MATCH (src:Component)-[:FLOWS]->(df)
         WITH df, collect(DISTINCT src.id) AS srcIds
         OPTIONAL MATCH (df)-[:FLOWS]->(dst:Component)
         WITH df, srcIds, collect(DISTINCT dst.id) AS dstIds
         OPTIONAL MATCH (df)-[:HANDLES]->(d:Data)
         WITH df, srcIds, dstIds,
              collect(DISTINCT d.sensitivity) AS sensRaw,
              collect(DISTINCT d.id) AS dataIds
         OPTIONAL MATCH (df)-[:IS_INSTANCE_OF]->(fcls)
         // head() assumes a single class per element (the platform assigns one), so it is deterministic in practice.
         WITH df, srcIds, dstIds, sensRaw, dataIds, head(collect(DISTINCT fcls)) AS cls
         RETURN collect({
           id: df.id, name: df.name, description: df.description,
           sourceId: head(srcIds), targetId: head(dstIds),
           sensitivities: [s IN sensRaw WHERE s IS NOT NULL],
           dataItemCount: size(dataIds),
           className: cls.name, classDescription: cls.description
         }) AS flows`,
        { modelId },
      );

      // Data nodes + their HANDLES topology. Data hangs off the model via
      // CONTAINS (mirrors computeStructure/computeLedger); handlers reach it via
      // (el)-[:HANDLES]->(d) where el is a Component, DataFlow, or
      // SecurityBoundary (all three can HANDLE data per the schema). collect +
      // scalar-only map keeps it Neo4j/Memgraph-portable; the Data's own
      // exposures are NOT gathered here (they're already first-class ledger
      // elements) — only the sensitivity + handler ids the ledger lacks.
      const dataNodesRes = await session.run(
        `MATCH (m:Model {id: $modelId})
         OPTIONAL MATCH (m)-[:CONTAINS]->(d:Data)
         WITH collect(DISTINCT d) AS ds
         UNWIND (CASE WHEN size(ds) = 0 THEN [null] ELSE ds END) AS d
         WITH d WHERE d IS NOT NULL
         OPTIONAL MATCH (el)-[:HANDLES]->(d)
         WHERE el:Component OR el:DataFlow OR el:SecurityBoundary
         WITH d, collect(DISTINCT el.id) AS handledBy
         OPTIONAL MATCH (d)-[:IS_INSTANCE_OF]->(dcls)
         // head() assumes a single class per element (the platform assigns one), so it is deterministic in practice.
         WITH d, handledBy, head(collect(DISTINCT dcls)) AS cls
         RETURN collect({
           id: d.id, name: d.name, description: d.description,
           sensitivity: d.sensitivity, regulatoryFlags: d.regulatoryFlags,
           handledBy: handledBy,
           className: cls.name, classDescription: cls.description
         }) AS dataNodes`,
        { modelId },
      );

      // Declared approved channels (conduits). OUTBOUND-canonical only — on-disk data records a
      // crossing once as OUTBOUND on the source; the INBOUND mirror is re-derived and would only
      // double-count. Scalar relationship props only (peer.id + co.justification) for
      // Neo4j/Memgraph portability; `controlRefs` is intentionally not gathered (the plugin never
      // authors it, so the column would be permanently empty).
      const conduitsRes = await session.run(
        `MATCH (m:Model {id: $modelId})
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(b:SecurityBoundary)
         WITH collect(DISTINCT b) AS bs
         UNWIND (CASE WHEN size(bs) = 0 THEN [null] ELSE bs END) AS b
         WITH b WHERE b IS NOT NULL
         OPTIONAL MATCH (b)-[co:CONDUIT]->(peer:SecurityBoundary)
         WITH b, collect(DISTINCT CASE WHEN peer IS NULL THEN NULL ELSE
           { peerId: peer.id, justification: co.justification } END) AS conduits
         RETURN collect({ boundaryId: b.id, conduits: [x IN conduits WHERE x IS NOT NULL] }) AS rows`,
        { modelId },
      );

      const rawB = (boundariesRes.records[0]?.get('boundaries') ?? []) as any[];
      const rawC = (componentsRes.records[0]?.get('components') ?? []) as any[];
      const rawF = (flowsRes.records[0]?.get('flows') ?? []) as any[];
      const rawD = (dataNodesRes.records[0]?.get('dataNodes') ?? []) as any[];
      const rawConduitRows = (conduitsRes.records[0]?.get('rows') ?? []) as any[];

      // boundaryId → declared OUTBOUND conduits (peerId + optional justification).
      const conduitsByBoundary = new Map<string, { peerId: string; direction: 'OUTBOUND'; justification: string | null }[]>();
      for (const row of rawConduitRows) {
        if (!row || !row.boundaryId) continue;
        conduitsByBoundary.set(
          row.boundaryId,
          (row.conduits ?? [])
            .filter((c: any) => c && c.peerId)
            .map((c: any) => ({ peerId: c.peerId, direction: 'OUTBOUND' as const, justification: c.justification ?? null })),
        );
      }

      return {
        boundaries: rawB
          .filter((b) => b && b.id)
          .map((b) => ({
            id: b.id,
            name: b.name ?? '',
            description: b.description ?? null,
            className: b.className ?? null,
            classDescription: b.classDescription ?? null,
            positionX: toNum(b.positionX),
            positionY: toNum(b.positionY),
            width: toNum(b.width),
            height: toNum(b.height),
            parentBoundaryId: b.parentBoundaryId ?? null,
            zone: b.zone ?? null,
            planes: Array.isArray(b.planes) ? b.planes.filter((p: any) => p != null) : [],
            domains: Array.isArray(b.domains) ? b.domains.filter((d: any) => d != null) : [],
            conduits: conduitsByBoundary.get(b.id) ?? [],
          })),
        components: rawC
          .filter((c) => c && c.id)
          .map((c) => ({
            id: c.id,
            name: c.name ?? '',
            description: c.description ?? null,
            className: c.className ?? null,
            classDescription: c.classDescription ?? null,
            type: c.type ?? null,
            positionX: toNum(c.positionX),
            positionY: toNum(c.positionY),
            width: toNum(c.width),
            height: toNum(c.height),
            boundaryId: c.boundaryId ?? null,
            crownJewel: c.crownJewel === true,
          })),
        flows: rawF
          .filter((f) => f && f.id)
          .map((f) => ({
            id: f.id,
            name: f.name ?? '',
            description: f.description ?? null,
            className: f.className ?? null,
            classDescription: f.classDescription ?? null,
            sourceId: f.sourceId ?? null,
            targetId: f.targetId ?? null,
            sensitivities: Array.isArray(f.sensitivities)
              ? f.sensitivities.filter((s: any) => s != null)
              : [],
            dataItemCount: toNum(f.dataItemCount) ?? 0,
          })),
        dataNodes: rawD
          .filter((d) => d && d.id)
          .map((d) => ({
            id: d.id,
            name: d.name ?? '',
            description: d.description ?? null,
            className: d.className ?? null,
            classDescription: d.classDescription ?? null,
            sensitivity: d.sensitivity ?? null,
            regulatoryFlags: Array.isArray(d.regulatoryFlags)
              ? d.regulatoryFlags.filter((f: any) => f != null)
              : [],
            handledBy: Array.isArray(d.handledBy)
              ? d.handledBy.filter((x: any) => x != null)
              : [],
          })),
      };
    } finally {
      await session.close();
    }
  }

  /**
   * Load the pure dt-core zoning engine at runtime. The module compiles to CommonJS, but dt-core is
   * ESM-only (its `exports` carry only an `import` condition), so a literal dynamic `import()` would be
   * down-emitted by tsc into a `require()` helper → `ERR_REQUIRE_ESM`. The `new Function` indirection
   * preserves a genuine runtime `import()` that Node resolves against the ESM `./zone-determination`
   * subpath — which reaches the self-contained engine directly, bypassing the package barrel's
   * Apollo/Vue-Flow deps. Returns just the three functions the adapter drives.
   */
  private async loadZoningEngine(): Promise<ZoningEngine> {
    // eslint-disable-next-line no-new-func -- intentional: preserves a genuine runtime import() (a literal
    // import() would be down-emitted to require() under module:commonjs → ERR_REQUIRE_ESM). Specifier is a
    // hardcoded constant, never model/user input.
    const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<any>;
    let zd: any;
    try {
      // Primary: the self-contained engine subpath (bypasses the barrel's Apollo/Vue-Flow deps).
      zd = await dynamicImport('@dethernety/dt-core/zone-determination');
    } catch (subpathErr) {
      // Fallback: a dt-core whose package.json predates the ./zone-determination subpath export
      // (a stale published/baked build) throws ERR_PACKAGE_PATH_NOT_EXPORTED. The main barrel
      // re-exports the same engine functions and is always present, so fall back to it. Logged so
      // the degradation is never silent; a total failure still propagates to computeZoning's guard.
      this.logger.warn(
        'threat-report: ./zone-determination subpath import failed; falling back to the @dethernety/dt-core barrel',
        subpathErr as Error,
      );
      zd = await dynamicImport('@dethernety/dt-core');
    }
    return {
      buildZoningContext: zd.buildZoningContext,
      computeZoningFindings: zd.computeZoningFindings,
      resolveEffectiveZone: zd.resolveEffectiveZone,
    };
  }

  /**
   * "Generate snapshot." Positional args from the platform resolver are
   * (analysisId, analysisClassId, scope=elementId, pubSub, additionalParams).
   * For a model-scoped report, scope IS the model id. Computes the snapshot and
   * atomically SETs it (+ generatedAt + fingerprint) on the standing Analysis
   * node, then returns the minimal AnalysisSession.
   */
  async runAnalysis(
    analysisId: string,
    _analysisClassId: string,
    scope: string,
    _pubSub: ExtendedPubSubEngine,
    _additionalParams?: object,
  ): Promise<AnalysisSession> {
    const modelId = scope;
    // Compute BEFORE the write: a compute failure throws here, before any SET,
    // so a prior snapshot is left intact (keep-prior-on-partial-failure). Both
    // the cheap digest and the full ledger are gathered up front.
    const { fingerprint, componentCount, boundaryCount } =
      await this.computeStructure(modelId);
    const ledger = await this.computeLedger(modelId);
    const modelGraph = await this.computeModelGraph(modelId);

    // Trust-zoning: reuse the dt-core engine (loaded via the ESM subpath) to compute per-boundary
    // tiers + advisory findings over the gathered graph. Advisory and additive — a fault here must
    // never take down the core snapshot, so it degrades to an empty zoning block (rendered as "no
    // findings"; the model's completeness surface is unaffected).
    let zoning: SnapshotDoc['zoning'] = { findings: [], effectiveZones: {} };
    try {
      const engine = await this.loadZoningEngine();
      zoning = computeZoning(modelGraph, engine);
    } catch (err) {
      this.logger.warn(
        `threat-report: zoning computation failed for model '${modelId}'; snapshot carries an empty zoning block`,
        err as Error,
      );
    }

    const generatedAt = new Date().toISOString();
    const doc: SnapshotDoc = {
      generated: true,
      modelId,
      generatedAt,
      fingerprint,
      componentCount,
      boundaryCount,
      ledger,
      modelGraph,
      zoning,
    };

    const session = this.session();
    try {
      // Single-statement SET ⇒ atomic snapshot replacement. Fail loud if the
      // Analysis node is missing: MATCH yields zero rows, the SET silently
      // no-ops, and we must NOT report success for a write that didn't land.
      const result = await session.run(
        `MATCH (a:Analysis {id: $analysisId})
         SET a.threatReportDoc = $doc,
             a.threatReportGeneratedAt = $generatedAt,
             a.threatReportFingerprint = $fingerprint
         RETURN a.id AS id`,
        {
          analysisId,
          doc: JSON.stringify(doc),
          generatedAt,
          fingerprint,
        },
      );
      if (result.records.length === 0) {
        const message = `threat-report: cannot generate snapshot — Analysis node '${analysisId}' not found`;
        this.logger.error(message);
        throw new Error(message);
      }
    } finally {
      await session.close();
    }

    return { sessionId: analysisId };
  }

  /**
   * Static 'idle' status. A report is not a long-running run; reporting 'idle'
   * keeps the Analysis tab's "Results" action enabled (it gates on
   * status === 'idle'). hasDocument reflects whether a snapshot has been
   * persisted, so the UI can tell a never-run report (Ready) from a completed
   * one (Done) — a cheap indexed single-node lookup, called on every listing.
   */
  async getAnalysisStatus(id: string): Promise<AnalysisStatus> {
    let hasDocument = false;
    const session = this.session();
    try {
      const r = await session.run(
        `MATCH (a:Analysis {id: $id}) RETURN a.threatReportDoc IS NOT NULL AS hasDoc`,
        { id },
      );
      hasDocument = r.records[0]?.get('hasDoc') ?? false;
    } catch (err) {
      // A status read should never flip the row to the error fallback; default
      // false, but log so a persistently unhealthy DB is observable.
      this.logger.debug(`threat-report: hasDocument check failed for ${id}`, err);
    } finally {
      await session.close();
    }
    return {
      createdAt: '',
      updatedAt: '',
      status: 'idle',
      hasDocument,
      interrupts: {},
      messages: [],
      metadata: {},
    };
  }

  /**
   * Read the persisted snapshot back. Positional args from the platform
   * resolver are (scope=elementId, analysisId, analysisClassId, filter); the
   * document is keyed to the Analysis instance, so we read by analysisId.
   * Returns the snapshot under REPORT_COMPONENT_KEY (the first non-`metadata.*`
   * key the analysis-results page uses to resolve the component). A
   * never-generated instance returns a { generated: false } signal so the
   * component still resolves and can show an empty state.
   */
  async getDocument(
    _scope: string,
    analysisId: string,
    _analysisClassId: string,
    _filter: object,
  ): Promise<object> {
    const session = this.session();
    try {
      const result = await session.run(
        `MATCH (a:Analysis {id: $analysisId})
         RETURN a.threatReportDoc AS doc`,
        { analysisId },
      );
      const raw = result.records[0]?.get('doc');
      if (!raw) {
        return { [REPORT_COMPONENT_KEY]: { generated: false } as SnapshotDoc };
      }
      let parsed: SnapshotDoc;
      try {
        parsed = JSON.parse(raw) as SnapshotDoc;
      } catch {
        this.logger.warn(
          `threat-report: snapshot document for Analysis '${analysisId}' failed to parse; returning empty state`,
        );
        parsed = { generated: false };
      }
      return { [REPORT_COMPONENT_KEY]: parsed };
    } finally {
      await session.close();
    }
  }
}

export default DethernetyThreatReportModule;
