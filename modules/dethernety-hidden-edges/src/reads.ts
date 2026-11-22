/**
 * The module's reads of one model, all read-only, all in one read transaction. The module runs no Cypher but
 * these: its runner refuses any other text.
 *
 * Each read returns flat rows for one fact type, so OPTIONAL MATCH fan-out never multiplies rows and every
 * read has a cap of its own. Attribute values come back as the whole property map of each IS_INSTANCE_OF
 * relation and are rebuilt in TypeScript; no key name is ever put into Cypher. Nothing here aggregates a map,
 * and no list comprehension builds a map literal: both are read differently by Memgraph.
 *
 * The boundary forest is walked one hop at a time from the model's root boundaries, with a visited set kept
 * here. `parentBoundary` is a list, so the forest may be a DAG or even hold a cycle; a variable-length match
 * would enumerate paths, while this visits each boundary once.
 */
import { ATTRIBUTE_BYTES_MAX, CAPS, Deadline, ReadName, ReadOverCap } from './bounds';

export type Row = Record<string, unknown>;
/** Runs one read inside the call's read transaction and returns its rows as plain objects. */
export type Run = (cypher: string, params: Record<string, unknown>) => Promise<Row[]>;

/** The deepest boundary nesting the walk follows; deeper boundaries are left out and counted. */
export const MAX_BOUNDARY_DEPTH = 50;

const over = (read: ReadName) => CAPS[read] + 1;

/** The four element kinds, their labels and the parameter holding their ids. */
const KINDS = [
  ['SecurityBoundary', 'securityBoundary', 'boundaryIds', 'Boundaries'],
  ['Component', 'component', 'componentIds', 'Components'],
  ['DataFlow', 'dataFlow', 'flowIds', 'Flows'],
  ['Data', 'data', 'dataIds', 'Data'],
] as const;
type Suffix = (typeof KINDS)[number][3];

/**
 * One read per element kind, so each is anchored on its own label's id index and capped on its own; the caller
 * keeps a running total across the four. The label and the parameter name come from the fixed list above.
 */
function perKind<N extends string>(
  name: N,
  text: (label: string, kind: string, ids: string) => string,
): Record<`${N}${Suffix}`, string> {
  return Object.fromEntries(KINDS.map(([label, kind, ids, suffix]) => [`${name}${suffix}`, text(label, kind, ids)])) as Record<`${N}${Suffix}`, string>;
}

export const READS = {
  modelExists: `
    MATCH (m:Model {id: $modelId})
    RETURN m.id AS id
    LIMIT 1`,

  rootBoundaries: `
    MATCH (:Model {id: $modelId})-[:CONTAINS]->(b:SecurityBoundary)
    RETURN DISTINCT b.id AS id
    LIMIT ${over('boundaries')}`,

  childBoundaries: `
    UNWIND $parentIds AS parentId
    MATCH (b:SecurityBoundary)-[:BELONGS_TO]->(:SecurityBoundary {id: parentId})
    RETURN DISTINCT b.id AS id, parentId
    LIMIT ${over('boundaryEdges')}`,

  componentEdges: `
    UNWIND $boundaryIds AS parentId
    MATCH (c:Component)-[:BELONGS_TO]->(:SecurityBoundary {id: parentId})
    RETURN DISTINCT c.id AS id, parentId, c.type AS type, c.crownJewel AS crownJewel
    LIMIT ${over('componentEdges')}`,

  flows: `
    UNWIND $componentIds AS sourceId
    MATCH (:Component {id: sourceId})-[:FLOWS]->(df:DataFlow)-[:FLOWS]->(t:Component)
    RETURN DISTINCT df.id AS id, sourceId, t.id AS targetId
    LIMIT ${over('flows')}`,

  flowData: `
    UNWIND $flowIds AS flowId
    MATCH (:DataFlow {id: flowId})-[:HANDLES]->(d:Data)
    RETURN DISTINCT flowId, d.id AS dataId
    LIMIT ${over('flowData')}`,

  dataItems: `
    MATCH (:Model {id: $modelId})-[:CONTAINS]->(d:Data)
    RETURN DISTINCT d.id AS id, d.isCredential AS isCredential
    LIMIT ${over('dataItems')}`,

  ...perKind('instances', (label, kind, ids) => `
    UNWIND $${ids} AS elementId
    MATCH (:${label} {id: elementId})-[r:IS_INSTANCE_OF]->(cls)
    OPTIONAL MATCH (mod:Module)-[:HAS_CLASS]->(cls)
    WITH elementId, r, cls, collect(DISTINCT mod.name) AS classModules
    RETURN elementId, '${kind}' AS kind, cls.id AS classId, cls.name AS className, cls.category AS classCategory, cls.policyHash AS classPolicyHash, classModules, properties(r) AS attributes
    LIMIT ${over('instances')}`),

  ...perKind('exposures', (label, _kind, ids) => `
    UNWIND $${ids} AS elementId
    MATCH (:${label} {id: elementId})-[:HAS_EXPOSURE]->(e:Exposure)
    OPTIONAL MATCH (e)-[:IS_EXPOSURE_OF]->(ec)
    WITH elementId, e, collect(DISTINCT ec.id) AS exposureClassIds
    RETURN elementId, e.id AS id, e.name AS name, exposureClassIds, e.category AS category, e.dispositionKind AS dispositionKind, e.dispositionedBy AS dispositionedBy, e.createdBy AS createdBy
    LIMIT ${over('exposures')}`),

  exposureTechniques: `
    UNWIND $exposureIds AS exposureId
    MATCH (:Exposure {id: exposureId})-[:EXPLOITED_BY]->(t:MitreAttackTechnique)
    RETURN DISTINCT exposureId, t.attack_id AS techniqueId
    LIMIT ${over('exposureTechniques')}`,

  ...perKind('supports', (label, _kind, ids) => `
    UNWIND $${ids} AS elementId
    MATCH (c:Control)-[:SUPPORTS]->(:${label} {id: elementId})
    RETURN DISTINCT c.id AS controlId, elementId
    LIMIT ${over('supports')}`),

  controlClasses: `
    UNWIND $controlIds AS controlId
    MATCH (:Control {id: controlId})-[r:IS_INSTANCE_OF]->(cc)
    RETURN controlId, cc.name AS className, properties(r) AS attributes
    LIMIT ${over('controlClasses')}`,
} as const;

/** Everything the reads return, before folding. */
export interface ModelRows {
  rootBoundaries: Row[];
  boundaryEdges: Row[];
  /** True when the walk stopped at `MAX_BOUNDARY_DEPTH` with boundaries left to visit. */
  boundaryDepthCut: boolean;
  componentEdges: Row[];
  flows: Row[];
  flowData: Row[];
  dataItems: Row[];
  instances: Row[];
  exposures: Row[];
  exposureTechniques: Row[];
  supports: Row[];
  controlClasses: Row[];
}

function capped(read: ReadName, rows: Row[]): Row[] {
  if (rows.length > CAPS[read]) throw new ReadOverCap(read);
  return rows;
}

const ids = (rows: Row[], key = 'id'): string[] => [...new Set(rows.map((r) => r[key]).filter((v): v is string => typeof v === 'string'))];

/**
 * Reads one model. Returns null when no model has the id. Throws `ReadOverCap` when a read is over its cap and
 * `DeadlineExceeded` when the deadline passes between reads.
 */
export async function readModel(run: Run, modelId: string, deadline: Deadline): Promise<ModelRows | null> {
  const step = async (read: ReadName, cypher: string, params: Record<string, unknown>): Promise<Row[]> => {
    deadline.check();
    return capped(read, await run(cypher, params));
  };

  deadline.check();
  if ((await run(READS.modelExists, { modelId })).length === 0) return null;

  const rootBoundaries = await step('boundaries', READS.rootBoundaries, { modelId });
  const visited = new Set(ids(rootBoundaries));
  const boundaryEdges: Row[] = [];
  let frontier = [...visited];
  let depth = 0;
  while (frontier.length > 0 && depth < MAX_BOUNDARY_DEPTH) {
    const edges = await step('boundaryEdges', READS.childBoundaries, { parentIds: frontier });
    boundaryEdges.push(...edges);
    if (boundaryEdges.length > CAPS.boundaryEdges) throw new ReadOverCap('boundaryEdges');
    const next: string[] = [];
    for (const id of ids(edges)) {
      if (!visited.has(id)) {
        visited.add(id);
        next.push(id);
      }
    }
    if (visited.size > CAPS.boundaries) throw new ReadOverCap('boundaries');
    frontier = next;
    depth += 1;
  }
  // At the depth limit, the frontier is cut only if one of its boundaries has a child.
  const boundaryDepthCut = frontier.length > 0 && (await step('boundaryEdges', READS.childBoundaries, { parentIds: frontier })).length > 0;
  const boundaryIds = [...visited];

  const componentEdges = await step('componentEdges', READS.componentEdges, { boundaryIds });
  const componentIds = ids(componentEdges);
  if (componentIds.length > CAPS.components) throw new ReadOverCap('components');
  const flows = await step('flows', READS.flows, { componentIds });
  const flowIds = ids(flows);
  const flowData = await step('flowData', READS.flowData, { flowIds });
  const dataItems = await step('dataItems', READS.dataItems, { modelId });
  const dataIds = ids(dataItems);
  const params = { boundaryIds, componentIds, flowIds, dataIds };
  /** The four per-kind reads of one fact type, with a running total against the type's cap. */
  const fourKinds = async (read: 'instances' | 'exposures' | 'supports'): Promise<Row[]> => {
    const out: Row[] = [];
    for (const [, , , suffix] of KINDS) {
      out.push(...(await step(read, READS[`${read}${suffix}`], params)));
      if (out.length > CAPS[read]) throw new ReadOverCap(read);
    }
    return out;
  };
  const instances = await fourKinds('instances');
  let attributeBytes = 0;
  const countBytes = (rows: Row[]) => {
    for (const r of rows) {
      attributeBytes += JSON.stringify(r.attributes ?? null, (_k, v) => (typeof v === 'bigint' ? String(v) : v)).length;
      if (attributeBytes > ATTRIBUTE_BYTES_MAX) throw new ReadOverCap('attributeBytes');
    }
  };
  countBytes(instances);
  const exposures = await fourKinds('exposures');
  const exposureTechniques = await step('exposureTechniques', READS.exposureTechniques, { exposureIds: ids(exposures) });
  const supports = await fourKinds('supports');
  const controlIds = ids(supports, 'controlId');
  if (controlIds.length > CAPS.controls) throw new ReadOverCap('controls');
  const controlClasses = await step('controlClasses', READS.controlClasses, { controlIds });
  countBytes(controlClasses);

  return {
    rootBoundaries,
    boundaryEdges,
    boundaryDepthCut,
    componentEdges,
    flows,
    flowData,
    dataItems,
    instances,
    exposures,
    exposureTechniques,
    supports,
    controlClasses,
  };
}
