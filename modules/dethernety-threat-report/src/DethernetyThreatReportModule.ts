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
  createdBy: string | null; // 'USER' | 'SYSTEM'
  authoredBy: string | null;
  dispositionKind: string | null; // null = live (no disposition)
  dispositionReason: string | null;
  dispositionedBy: string | null;
  dispositionedAt: string | null;
  dispositionStale: boolean | null;
}

/** A control supporting an element — shown as muted "controls present" context,
 *  never a coverage claim (coverage grading is a later, separate module). */
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
 *  ③ crossing engine's ancestor-stack walk. */
interface ModelGraphBoundary {
  id: string;
  name: string;
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
  parentBoundaryId: string | null; // null ⇒ top-level
}

/** A component with its canvas geometry, DFD type (lower-cased for the minimap),
 *  parent boundary, and crown-jewel flag. */
interface ModelGraphComponent {
  id: string;
  name: string;
  type: string | null; // 'process' | 'store' | 'external_entity' | … (lower-cased)
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
  boundaryId: string | null; // null ⇒ orphan (no BELONGS_TO parent)
  crownJewel: boolean;
}

/** A flow as a component-to-component edge, with the data sensitivities it
 *  carries. `sensitivities` excludes nulls; `dataItemCount` is the total carried
 *  data count — so the engine distinguishes "no data" (count 0) from
 *  "data-in-motion but unclassified" (count > 0, sensitivities empty). */
interface ModelGraphFlow {
  id: string;
  name: string;
  sourceId: string | null;
  targetId: string | null;
  sensitivities: string[]; // SensitivityLevel values, nulls dropped
  dataItemCount: number;
}

/** The positional model graph — the minimap's `modelGraph` contract and the ③
 *  crossing engine's structural input. Gathered at generate time so the report
 *  is snapshot-faithful (same as-of-generation model as the ledger). */
interface ModelGraph {
  boundaries: ModelGraphBoundary[];
  components: ModelGraphComponent[];
  flows: ModelGraphFlow[];
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
   *  minimap and the ③ boundary-crossing engine; both pure-TS over this + the
   *  raw `ledger` (which carries each element's exposures + supporting controls,
   *  reused for crossed-boundary / on-flow posture — no separate posture query). */
  modelGraph?: ModelGraph;
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
   * one stored in a snapshot to detect staleness (the staleness UX itself is a
   * later slice). Every field declared here has a resolver in getResolvers().
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
              [x IN fs | x.id] AS dataFlowIds,
              bs + cs + ds + fs AS allEls
         UNWIND (CASE WHEN size(allEls) = 0 THEN [null] ELSE allEls END) AS el
         OPTIONAL MATCH (el)-[:HAS_EXPOSURE]->(ex:Exposure)
         WITH boundaryIds, componentIds, dataIds, dataFlowIds,
              collect(DISTINCT ex.id + '|' + coalesce(ex.dispositionKind, '') + '|' + coalesce(toString(ex.dispositionStale), '')) AS exposureSigs
         RETURN boundaryIds, componentIds, dataIds, dataFlowIds, exposureSigs`,
        { modelId },
      );
      const rec = result.records[0];
      const boundaryIds: string[] = (rec?.get('boundaryIds') ?? []) as string[];
      const componentIds: string[] = (rec?.get('componentIds') ?? []) as string[];
      const dataIds: string[] = (rec?.get('dataIds') ?? []) as string[];
      const dataFlowIds: string[] = (rec?.get('dataFlowIds') ?? []) as string[];
      const exposureSigs: string[] = (rec?.get('exposureSigs') ?? []) as string[];

      const digestInput = JSON.stringify({
        b: [...boundaryIds].sort(),
        c: [...componentIds].sort(),
        d: [...dataIds].sort(),
        f: [...dataFlowIds].sort(),
        e: [...exposureSigs].sort(),
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
   * (control-gaps-resolver) and the S1 fingerprint query. Maps are built with
   * scalar fields only (no nodes-in-maps) + labels()-derived type, for
   * Neo4j/Memgraph portability; toString() the timestamp; Integer score is
   * normalized to a JS number below so the doc JSON-stringifies cleanly.
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
         WITH el, elType, collect(DISTINCT CASE WHEN ex IS NULL THEN NULL ELSE {
           id: ex.id, name: ex.name, score: ex.score, attackVector: ex.attackVector,
           createdBy: ex.createdBy, authoredBy: ex.authoredBy,
           dispositionKind: ex.dispositionKind, dispositionReason: ex.dispositionReason,
           dispositionedBy: ex.dispositionedBy, dispositionedAt: toString(ex.dispositionedAt),
           dispositionStale: ex.dispositionStale } END) AS findings
         OPTIONAL MATCH (ctrl:Control)-[:SUPPORTS]->(el)
         WITH el, elType, findings, collect(DISTINCT CASE WHEN ctrl IS NULL THEN NULL ELSE {
           id: ctrl.id, name: ctrl.name, type: ctrl.type, category: ctrl.category } END) AS controls
         RETURN collect({ id: el.id, name: el.name, type: elType, findings: findings, supportingControls: controls }) AS ledger`,
        { modelId },
      );

      const toNum = (v: any): number | null =>
        v == null
          ? null
          : typeof v === 'number'
            ? v
            : typeof v?.toNumber === 'function'
              ? v.toNumber()
              : Number(v);

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
   * the faithful minimap and the ③ boundary-crossing engine — both pure-TS over
   * this graph joined with the raw `ledger` (which already carries every
   * element's exposures + supporting controls, reused for crossed-boundary /
   * on-flow posture, so ③ needs no separate posture query).
   *
   * Three small, independently-portable passes (boundaries, components, flows),
   * each in the same OPTIONAL MATCH + collect style as computeLedger — no
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
         RETURN collect({
           id: b.id, name: b.name,
           positionX: b.positionX, positionY: b.positionY,
           width: b.dimensionsWidth, height: b.dimensionsHeight,
           parentBoundaryId: pb.id
         }) AS boundaries`,
        { modelId },
      );

      const componentsRes = await session.run(
        `MATCH (m:Model {id: $modelId})
         OPTIONAL MATCH (m)-[:CONTAINS]->(:SecurityBoundary)<-[:BELONGS_TO*0..50]-(:SecurityBoundary)<-[:BELONGS_TO]-(c:Component)
         WITH collect(DISTINCT c) AS cs
         UNWIND (CASE WHEN size(cs) = 0 THEN [null] ELSE cs END) AS c
         WITH c WHERE c IS NOT NULL
         OPTIONAL MATCH (c)-[:BELONGS_TO]->(cb:SecurityBoundary)
         RETURN collect({
           id: c.id, name: c.name, type: toLower(c.type),
           positionX: c.positionX, positionY: c.positionY,
           width: c.dimensionsWidth, height: c.dimensionsHeight,
           boundaryId: cb.id, crownJewel: c.crownJewel
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
         RETURN collect({
           id: df.id, name: df.name,
           sourceId: head(srcIds), targetId: head(dstIds),
           sensitivities: [s IN sensRaw WHERE s IS NOT NULL],
           dataItemCount: size(dataIds)
         }) AS flows`,
        { modelId },
      );

      const toNum = (v: any): number | null =>
        v == null
          ? null
          : typeof v === 'number'
            ? v
            : typeof v?.toNumber === 'function'
              ? v.toNumber()
              : Number(v);

      const rawB = (boundariesRes.records[0]?.get('boundaries') ?? []) as any[];
      const rawC = (componentsRes.records[0]?.get('components') ?? []) as any[];
      const rawF = (flowsRes.records[0]?.get('flows') ?? []) as any[];

      return {
        boundaries: rawB
          .filter((b) => b && b.id)
          .map((b) => ({
            id: b.id,
            name: b.name ?? '',
            positionX: toNum(b.positionX),
            positionY: toNum(b.positionY),
            width: toNum(b.width),
            height: toNum(b.height),
            parentBoundaryId: b.parentBoundaryId ?? null,
          })),
        components: rawC
          .filter((c) => c && c.id)
          .map((c) => ({
            id: c.id,
            name: c.name ?? '',
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
            sourceId: f.sourceId ?? null,
            targetId: f.targetId ?? null,
            sensitivities: Array.isArray(f.sensitivities)
              ? f.sensitivities.filter((s: any) => s != null)
              : [],
            dataItemCount: toNum(f.dataItemCount) ?? 0,
          })),
      };
    } finally {
      await session.close();
    }
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
        throw new Error(
          `threat-report: cannot generate snapshot — Analysis node '${analysisId}' not found`,
        );
      }
    } finally {
      await session.close();
    }

    return { sessionId: analysisId };
  }

  /**
   * Static 'idle' status. A report is not a long-running run; reporting 'idle'
   * keeps the Analysis tab's "Results" action enabled (it gates on
   * status === 'idle'). Cheap and side-effect-free — this is called on every
   * analysis listing.
   */
  async getAnalysisStatus(_id: string): Promise<AnalysisStatus> {
    return {
      createdAt: '',
      updatedAt: '',
      status: 'idle',
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
        parsed = { generated: false };
      }
      return { [REPORT_COMPONENT_KEY]: parsed };
    } finally {
      await session.close();
    }
  }
}

export default DethernetyThreatReportModule;
