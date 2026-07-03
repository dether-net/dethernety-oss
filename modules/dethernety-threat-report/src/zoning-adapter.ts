/**
 * Zoning adapter — projects the report's graph-native `modelGraph` into the nested `ModelStructure`
 * shape dt-core's zoning engine consumes, then runs the engine to produce the per-boundary DECLARED
 * effective zones + advisory findings folded into the report snapshot.
 *
 * The per-boundary map is the DECLARED effective zone (`resolveEffectiveZone` — the operator's declared
 * `zone` resolved through nesting inheritance), NOT the topological `determineZoneTier` proposal. The
 * report is a declared-zone data-flow-policy checker: it never recomputes/overrides a declared zone;
 * a cross-zone link is a policy violation to flag, not a signal to re-classify.
 *
 * Two responsibilities, split so the fiddly part is pure + unit-testable and the ESM-load concern
 * lives elsewhere:
 *   - `graphToZoningStructure` — PURE (dt-core TYPES only, no value import): rebuilds the nested
 *     boundary/component tree, inverts the HANDLES topology into `dataItemIds`, and translates the
 *     graph's casing/naming to dt-core's local vocabulary. All the silent-false-negative traps live
 *     here (uppercase→lowercase sensitivity, camelCase→snake_case regulatory flags, forest→single
 *     root, component→boundary nesting that adjacency depends on).
 *   - `computeZoning` — takes the engine functions as an argument (injected), so the pure adapter is
 *     testable with a real engine import while production loads the engine via a dynamic import (the
 *     module is CJS, the engine is ESM-only). See `DethernetyThreatReportModule.loadZoningEngine`.
 *
 * The engine reads a specific, narrow slice of the structure (verified against
 * `zone-determination.ts` — `buildZoningContext`, `collectAssetBoundaries`, `buildBoundaryAdjacency`):
 * nesting via `boundaries[]`/`components[]` is the authoritative parent chain (a set `parentBoundary`
 * is overwritten, so we don't set it); assets come from `component.crownJewel`, restricted-or-
 * regulated data items referenced via `component.dataItemIds` / `boundary.dataItemIds`; externality
 * from each boundary's OWN declared `zone`. Everything else the engine derives.
 */

import type {
  ModelStructure,
  StructureBoundary,
  StructureComponent,
  DataFlow,
  SchemaDataItem as DataItem,
  Zone,
  Plane,
  Conduit,
  ComponentType,
  ZoningContext,
  ZoningFinding,
  EffectiveZone,
} from '@dethernety/dt-core';

/** Synthetic single root wrapping the boundary forest. The engine expects one `defaultBoundary`
 *  and deliberately excludes the root from externality, classification, adjacency, and asset
 *  marking — so it is a pure container, never surfaced. */
const ZONING_ROOT_ID = '__zoning_root__';

/** Mirrors the engine's `MAX_DEPTH` / the platform's `BELONGS_TO*0..50` traversal ceiling. */
const MAX_NEST_DEPTH = 50;

// ── Input contract (a structural subset of the module's ModelGraph) ────────────────────────────

export interface ZoningGraphBoundary {
  id: string;
  name: string;
  parentBoundaryId: string | null;
  zone: string | null;
  planes: string[];
  domains: string[];
  conduits: { peerId: string; direction: 'OUTBOUND'; justification: string | null }[];
}

export interface ZoningGraphComponent {
  id: string;
  name: string;
  type: string | null;
  boundaryId: string | null;
  crownJewel: boolean;
}

export interface ZoningGraphFlow {
  id: string;
  name: string;
  sourceId: string | null;
  targetId: string | null;
}

export interface ZoningGraphDataNode {
  id: string;
  name: string;
  sensitivity: string | null;
  regulatoryFlags: string[];
  handledBy: string[];
}

export interface ZoningGraphInput {
  boundaries: ZoningGraphBoundary[];
  components: ZoningGraphComponent[];
  flows: ZoningGraphFlow[];
  dataNodes: ZoningGraphDataNode[];
}

/** The narrow engine surface `computeZoning` needs — injected so the adapter stays pure/testable. */
export interface ZoningEngine {
  buildZoningContext(structure: ModelStructure, flows: DataFlow[], dataItems: DataItem[]): ZoningContext;
  computeZoningFindings(ctx: ZoningContext): ZoningFinding[];
  resolveEffectiveZone(
    boundaryId: string,
    boundariesById: Map<string, StructureBoundary>,
    defaultBoundaryId: string,
  ): EffectiveZone;
}

/** The computed zoning block folded into the snapshot doc. */
export interface ZoningResult {
  findings: ZoningFinding[];
  /** Per-boundary DECLARED effective zone (declared/inherited/default) — authoritative, never the
   *  topological `determineZoneTier` proposal. Keyed by boundary id; the synthetic root is excluded. */
  effectiveZones: Record<string, EffectiveZone>;
}

// ── Pure graph → ModelStructure adapter ────────────────────────────────────────────────────────

/**
 * Rebuild the nested `ModelStructure` + `DataFlow[]` + `DataItem[]` the engine reads from the report's
 * flat graph. Pure: no I/O, no dt-core value import. Cycle- and depth-guarded so a corrupt
 * `parentBoundaryId` can never produce a self-referential object graph (which `flattenStructure`, being
 * unguarded recursion, would loop on).
 */
export function graphToZoningStructure(graph: ZoningGraphInput): {
  structure: ModelStructure;
  flows: DataFlow[];
  dataItems: DataItem[];
} {
  const boundaries = graph.boundaries ?? [];
  const components = graph.components ?? [];
  const dataNodes = graph.dataNodes ?? [];

  const boundaryById = new Map(boundaries.map((b) => [b.id, b]));
  const componentIds = new Set(components.map((c) => c.id));
  const boundaryIds = new Set(boundaries.map((b) => b.id));

  // 1. Invert HANDLES (dataNode.handledBy) → per-holder dataItemIds, routed by handler TYPE. Only
  //    component- and boundary-level references feed the engine's asset join; DataFlow (and unknown)
  //    handlers are discarded (irrelevant to zoning asset detection).
  const componentDataItemIds = new Map<string, string[]>();
  const boundaryDataItemIds = new Map<string, string[]>();
  for (const d of dataNodes) {
    for (const handlerId of d.handledBy ?? []) {
      if (componentIds.has(handlerId)) {
        (componentDataItemIds.get(handlerId) ?? setDefault(componentDataItemIds, handlerId)).push(d.id);
      } else if (boundaryIds.has(handlerId)) {
        (boundaryDataItemIds.get(handlerId) ?? setDefault(boundaryDataItemIds, handlerId)).push(d.id);
      }
      // else: DataFlow handler or dangling id → not an asset signal for zoning.
    }
  }

  // 2. Reconstruct StructureComponent[] grouped by their parent boundary. `type`/`positionX/Y` are
  //    required by the type but ignored by the engine; `crownJewel` + `dataItemIds` are the asset
  //    signals it actually reads. A component with no resolved boundary can't be placed (the engine
  //    resolves flow endpoints via the component→boundary map), so it is dropped — same semantics as
  //    the existing crossings engine.
  const componentsByBoundary = new Map<string, StructureComponent[]>();
  for (const c of components) {
    if (c.boundaryId == null) continue;
    const sc: StructureComponent = {
      id: c.id,
      name: c.name || '',
      type: (c.type ? c.type.toUpperCase() : 'PROCESS') as ComponentType,
      positionX: 0,
      positionY: 0,
      crownJewel: c.crownJewel === true,
      dataItemIds: componentDataItemIds.get(c.id),
    };
    (componentsByBoundary.get(c.boundaryId) ?? setDefault(componentsByBoundary, c.boundaryId)).push(sc);
  }

  // 3. Build a StructureBoundary shell per boundary (no nesting links yet).
  //    The zone/planes casts are unvalidated by design: the values come from the platform's
  //    enum-typed GraphQL fields, and a hypothetical garbage DB value degrades safely in the
  //    engine (an unknown zone reads as neither external nor declared — never a promotion).
  const shellById = new Map<string, StructureBoundary>();
  for (const b of boundaries) {
    shellById.set(b.id, {
      id: b.id,
      name: b.name || '',
      zone: (b.zone as Zone | null) ?? null,
      planes: (b.planes as Plane[]) ?? [],
      domains: b.domains ?? [],
      conduits: (b.conduits ?? []).map(
        (co): Conduit => ({
          peerId: co.peerId,
          direction: co.direction,
          justification: co.justification ?? undefined,
        }),
      ),
      dataItemIds: boundaryDataItemIds.get(b.id),
      components: componentsByBoundary.get(b.id) ?? [],
      boundaries: [],
    });
  }

  // 4. Link each boundary under its parent — but only when the parent exists AND the ancestor chain is
  //    acyclic and within depth. Any boundary in (or leading into) a cycle, or too deep, is attached to
  //    the synthetic root instead. This guarantees an acyclic forest, so `flattenStructure`'s unguarded
  //    recursion is safe.
  const topLevel: StructureBoundary[] = [];
  for (const b of boundaries) {
    const shell = shellById.get(b.id)!;
    const parentId = b.parentBoundaryId;
    if (parentId != null && shellById.has(parentId) && chainIsAcyclicAndBounded(b.id, boundaryById)) {
      shellById.get(parentId)!.boundaries!.push(shell);
    } else {
      topLevel.push(shell);
    }
  }

  const root: StructureBoundary = { id: ZONING_ROOT_ID, name: 'root', boundaries: topLevel };
  const structure: ModelStructure = { defaultBoundary: root };

  // 5. Flows: component→component edges the engine projects to boundary→boundary. Drop null endpoints.
  const flows: DataFlow[] = [];
  for (const f of graph.flows ?? []) {
    if (f.sourceId == null || f.targetId == null) continue;
    flows.push({ id: f.id, name: f.name || '', source: { id: f.sourceId }, target: { id: f.targetId } });
  }

  // 6. Data items: translate the graph's UPPERCASE sensitivity → lowercase and camelCase
  //    `regulatoryFlags` → snake_case `regulatory_flags` (the exact vocabulary the engine's asset
  //    predicate reads — a miss here silently zeros the asset set).
  const dataItems: DataItem[] = dataNodes.map((d) => ({
    id: d.id,
    name: d.name || '',
    sensitivity: d.sensitivity != null ? d.sensitivity.toLowerCase() : undefined,
    regulatory_flags: d.regulatoryFlags ?? [],
  }));

  return { structure, flows, dataItems };
}

/**
 * Run the zoning engine over the adapted structure and return the snapshot block. The engine is
 * injected (production loads it via a dynamic import; tests import it directly). The synthetic root is
 * excluded from the effective-zone map (never a real boundary).
 */
export function computeZoning(graph: ZoningGraphInput, engine: ZoningEngine): ZoningResult {
  const { structure, flows, dataItems } = graphToZoningStructure(graph);
  const ctx = engine.buildZoningContext(structure, flows, dataItems);
  const findings = engine.computeZoningFindings(ctx);
  // Declared effective zone per boundary (declared/inherited/default). `buildZoningContext` has
  // normalized `parentBoundary` from nesting, so the resolver's ancestry walk resolves inheritance
  // correctly despite the adapter's flat-graph input never setting `parentBoundary` back-refs.
  // Null-prototype record: keyed by model-controlled boundary ids, so no id can ever collide
  // with Object.prototype members (JSON round-trip is unaffected — own properties only).
  const effectiveZones: Record<string, EffectiveZone> = Object.create(null);
  for (const id of ctx.boundariesById.keys()) {
    if (id === ZONING_ROOT_ID) continue;
    effectiveZones[id] = engine.resolveEffectiveZone(id, ctx.boundariesById, ctx.defaultBoundaryId);
  }
  return { findings, effectiveZones };
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────

/** Get-or-create an array entry in a Map (keeps the inversion/grouping loops terse). */
function setDefault<K, V>(map: Map<K, V[]>, key: K): V[] {
  const arr: V[] = [];
  map.set(key, arr);
  return arr;
}

/**
 * Walk the ancestor chain from `startId` (via `parentBoundaryId`) and report whether it is acyclic and
 * within `MAX_NEST_DEPTH`. Seeds `seen` with `startId` so a chain that loops back to the boundary itself
 * — or forms any cycle among its ancestors — is rejected, breaking every cycle at link time.
 */
function chainIsAcyclicAndBounded(startId: string, boundaryById: Map<string, ZoningGraphBoundary>): boolean {
  const seen = new Set<string>([startId]);
  let cur = boundaryById.get(startId)?.parentBoundaryId ?? null;
  let depth = 0;
  while (cur != null) {
    if (seen.has(cur)) return false; // cycle
    if (++depth > MAX_NEST_DEPTH) return false; // too deep
    seen.add(cur);
    cur = boundaryById.get(cur)?.parentBoundaryId ?? null;
  }
  return true;
}
