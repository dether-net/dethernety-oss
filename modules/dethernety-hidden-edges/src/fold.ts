/**
 * The fold: read rows into the in-memory model the matching works on. Pure.
 *
 * Rows are untrusted in shape: a value of the wrong type is treated as absent, and a reference the fold cannot
 * resolve (a push may be under way while the reads run) is left out and counted, never guessed. An element with
 * no class or several is left out and counted too, except a boundary, which stays in the forest unclassified
 * so its children keep their place.
 */
import { coerceNeoInt, unflattenFlatKeys } from '@dethernety/dt-module';
import type { ModelRows, Row } from './reads';

export type ComponentType = 'PROCESS' | 'STORE' | 'EXTERNAL_ENTITY';

export type Lifecycle = 'pending' | 'confirmed' | 'disposed';

/**
 * The lifecycle the platform's disposition fields imply for hidden edges: AFFIRMED by someone is confirmed, by no
 * one pending; RISK_ACCEPTED is confirmed and COMPENSATING_CONTROL pending, since the weakness is still there (a
 * person said it is real, or that something else reduces it, not that it blocks a path); any other kind is
 * disposed; no kind is confirmed for a user-authored exposure and pending otherwise.
 */
export function lifecycleOf(e: { dispositionKind: string | null; dispositionedBy: string | null; createdBy: string | null }): Lifecycle {
  if (e.dispositionKind === 'AFFIRMED') return e.dispositionedBy ? 'confirmed' : 'pending';
  if (e.dispositionKind === 'RISK_ACCEPTED') return 'confirmed';
  if (e.dispositionKind === 'COMPENSATING_CONTROL') return 'pending';
  if (e.dispositionKind != null) return 'disposed';
  return e.createdBy === 'USER' ? 'confirmed' : 'pending';
}
export type ElementKind = 'securityBoundary' | 'component' | 'dataFlow' | 'data';

export interface ClassRef {
  id: string;
  name: string | null;
  category: string | null;
  /** The module that holds the class, if the platform records it. */
  module: string | null;
  /** The hash of the class policy the platform holds. */
  policyHash: string | null;
}

interface Classified {
  id: string;
  /** The element's one class; null for a boundary with no class or several. */
  cls: ClassRef | null;
  /** The class relation's attributes, rebuilt from flat keys. Absent keys stay absent. */
  attributes: Record<string, unknown>;
}

export interface Boundary extends Classified {
  parents: string[];
}

export interface Component extends Classified {
  type: ComponentType;
  crownJewel: boolean;
  parents: string[];
}

export interface Flow extends Classified {
  source: string;
  target: string;
  dataItems: string[];
}

export interface DataItem extends Classified {
  /** null when the author has not answered. */
  isCredential: boolean | null;
}

export interface Exposure {
  id: string;
  /** The finding's name, which with its class identifies the policy definition it came from. */
  name: string | null;
  /** The class the finding was evaluated for (it can differ from the element's class after a change). */
  classId: string | null;
  /** Who created it: the platform's evaluation, or a user. */
  createdBy: string | null;
  elementId: string;
  elementKind: ElementKind;
  lifecycle: Lifecycle;
  category: string | null;
  techniques: string[];
}

export interface Control {
  id: string;
  classNames: string[];
  /** Attributes per control class; a control may have several classes. */
  attributesByClass: Record<string, Record<string, unknown>>;
  supports: string[];
}

export interface FoldCounts {
  elementsWithoutClass: number;
  elementsWithSeveralClasses: number;
  boundariesWithSeveralParents: number;
  boundaryDepthCut: boolean;
  flowsWithSeveralEnds: number;
  exposuresOnSeveralElements: number;
  danglingReferences: number;
  attributeKeysDropped: number;
}

export interface FoldedModel {
  boundaries: Map<string, Boundary>;
  roots: string[];
  components: Map<string, Component>;
  flows: Map<string, Flow>;
  dataItems: Map<string, DataItem>;
  exposures: Map<string, Exposure>;
  controls: Map<string, Control>;
  counts: FoldCounts;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** A value as JSON with sorted object keys, so two equal maps compare equal whatever their key order. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null) ?? 'null';
}
const COMPONENT_TYPES: readonly ComponentType[] = ['PROCESS', 'STORE', 'EXTERNAL_ENTITY'];

function groupBy(rows: Row[], key: string): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const r of rows) {
    const k = str(r[key]);
    if (!k) continue;
    const list = out.get(k) ?? [];
    list.push(r);
    out.set(k, list);
  }
  return out;
}

export function foldModel(rows: ModelRows): FoldedModel {
  const counts: FoldCounts = {
    elementsWithoutClass: 0,
    elementsWithSeveralClasses: 0,
    boundariesWithSeveralParents: 0,
    boundaryDepthCut: rows.boundaryDepthCut,
    flowsWithSeveralEnds: 0,
    exposuresOnSeveralElements: 0,
    danglingReferences: 0,
    attributeKeysDropped: 0,
  };

  // One class per element, with its attributes. Several distinct classes, or two relations to one class with
  // different attributes, make the element unclassified: which one to read would depend on row order.
  const instancesOf = new Map<string, Map<string, { row: Row; attributes: Set<string>; modules: string[] }>>();
  for (const r of rows.instances) {
    const kind = str(r.kind);
    const id = str(r.elementId);
    const classId = str(r.classId);
    if (!kind || !id || !classId) continue;
    const key = `${kind}\u0000${id}`;
    const byClass = instancesOf.get(key) ?? new Map<string, { row: Row; attributes: Set<string>; modules: string[] }>();
    const entry = byClass.get(classId) ?? { row: r, attributes: new Set<string>(), modules: [] as string[] };
    entry.attributes.add(canonical(r.attributes));
    for (const mod of Array.isArray(r.classModules) ? r.classModules : [r.classModule]) {
      const name = str(mod);
      if (name && !entry.modules.includes(name)) entry.modules.push(name);
    }
    byClass.set(classId, entry);
    instancesOf.set(key, byClass);
  }
  const classOf = (kind: ElementKind, id: string): { cls: ClassRef | null; attributes: Record<string, unknown>; ok: boolean } => {
    const entries = [...(instancesOf.get(`${kind}\u0000${id}`)?.values() ?? [])];
    if (entries.length !== 1 || entries[0].attributes.size !== 1) {
      if (entries.length === 0) counts.elementsWithoutClass += 1;
      else counts.elementsWithSeveralClasses += 1;
      return { cls: null, attributes: {}, ok: false };
    }
    // two rows of one class differ only by the module that holds it: take the lowest module name
    const r = entries[0].row;
    const modules = entries[0].modules;
    const flat = r.attributes && typeof r.attributes === 'object' && !Array.isArray(r.attributes) ? (r.attributes as Record<string, unknown>) : {};
    const { value, dropped } = unflattenFlatKeys(flat, { leaf: coerceNeoInt });
    counts.attributeKeysDropped += dropped.length;
    return {
      cls: { id: str(r.classId)!, name: str(r.className), category: str(r.classCategory), module: [...modules].sort()[0] ?? null, policyHash: str(r.classPolicyHash) },
      attributes: value,
      ok: true,
    };
  };

  // The boundary forest.
  const roots = [...new Set(rows.rootBoundaries.map((r) => str(r.id)).filter((v): v is string => v !== null))];
  const parentsOf = new Map<string, Set<string>>();
  for (const id of roots) parentsOf.set(id, new Set());
  for (const r of rows.boundaryEdges) {
    const id = str(r.id);
    const parent = str(r.parentId);
    if (!id || !parent) continue;
    if (!parentsOf.has(id)) parentsOf.set(id, new Set());
    parentsOf.get(id)!.add(parent);
  }
  const boundaries = new Map<string, Boundary>();
  for (const [id, parents] of parentsOf) {
    if (parents.size > 1) counts.boundariesWithSeveralParents += 1;
    const { cls, attributes } = classOf('securityBoundary', id);
    boundaries.set(id, { id, cls, attributes, parents: [...parents].sort() });
  }

  // Components, under the boundaries the walk reached.
  const components = new Map<string, Component>();
  for (const [id, list] of groupBy(rows.componentEdges, 'id')) {
    const type = list.map((r) => r.type).find((t): t is ComponentType => COMPONENT_TYPES.includes(t as ComponentType));
    const parents = [...new Set(list.map((r) => str(r.parentId)).filter((p): p is string => p !== null && boundaries.has(p)))].sort();
    if (!type || parents.length === 0) {
      counts.danglingReferences += 1;
      continue;
    }
    const c = classOf('component', id);
    if (!c.ok) continue;
    components.set(id, { id, cls: c.cls, attributes: c.attributes, type, crownJewel: list.some((r) => r.crownJewel === true), parents });
  }

  // Data items of the model.
  const dataItems = new Map<string, DataItem>();
  for (const r of rows.dataItems) {
    const id = str(r.id);
    if (!id || dataItems.has(id)) continue;
    const c = classOf('data', id);
    if (!c.ok) continue;
    dataItems.set(id, { id, cls: c.cls, attributes: c.attributes, isCredential: typeof r.isCredential === 'boolean' ? r.isCredential : null });
  }

  // Flows between components the fold kept, with the data items they handle.
  const dataOfFlow = groupBy(rows.flowData, 'flowId');
  const flows = new Map<string, Flow>();
  for (const [id, list] of groupBy(rows.flows, 'id')) {
    const ends = new Set(list.map((r) => `${str(r.sourceId)}\u0000${str(r.targetId)}`));
    if (ends.size !== 1) {
      counts.flowsWithSeveralEnds += 1;
      continue;
    }
    const source = str(list[0].sourceId);
    const target = str(list[0].targetId);
    if (!source || !target || !components.has(source) || !components.has(target)) {
      counts.danglingReferences += 1;
      continue;
    }
    const c = classOf('dataFlow', id);
    if (!c.ok) continue;
    const items: string[] = [];
    for (const r of dataOfFlow.get(id) ?? []) {
      const d = str(r.dataId);
      if (d && dataItems.has(d)) items.push(d);
      else counts.danglingReferences += 1;
    }
    flows.set(id, { id, cls: c.cls, attributes: c.attributes, source, target, dataItems: [...new Set(items)].sort() });
  }

  // Exposures on elements the fold kept, with their ATT&CK techniques.
  const kindOf = (id: string): ElementKind | null =>
    boundaries.has(id) ? 'securityBoundary' : components.has(id) ? 'component' : flows.has(id) ? 'dataFlow' : dataItems.has(id) ? 'data' : null;
  const techniquesOf = groupBy(rows.exposureTechniques, 'exposureId');
  const exposures = new Map<string, Exposure>();
  for (const [id, list] of groupBy(rows.exposures, 'id')) {
    const elements = new Set(list.map((r) => str(r.elementId)));
    if (elements.size !== 1) {
      counts.exposuresOnSeveralElements += 1;
      continue;
    }
    const r = list[0];
    const elementId = str(r.elementId)!;
    const elementKind = kindOf(elementId);
    if (!elementKind) {
      counts.danglingReferences += 1;
      continue;
    }
    const techniques = [...new Set((techniquesOf.get(id) ?? []).map((t) => str(t.techniqueId)).filter((t): t is string => t !== null))].sort();
    exposures.set(id, {
      id,
      name: str(r.name),
      classId:
        [...new Set(list.flatMap((x) => (Array.isArray(x.exposureClassIds) ? x.exposureClassIds : [x.exposureClassId])).map(str).filter((c): c is string => c !== null))].sort()[0] ??
        null,
      createdBy: str(r.createdBy),
      elementId,
      elementKind,
      // Any disposition kind present counts, even a malformed one: it then reads as disposed, never as open.
      lifecycle: lifecycleOf({
        dispositionKind: r.dispositionKind == null ? null : String(r.dispositionKind),
        dispositionedBy: str(r.dispositionedBy),
        createdBy: str(r.createdBy),
      }),
      category: str(r.category),
      techniques,
    });
  }

  // Controls supporting elements the fold kept, by class name.
  const classNamesOf = groupBy(rows.controlClasses, 'controlId');
  const controls = new Map<string, Control>();
  for (const [id, list] of groupBy(rows.supports, 'controlId')) {
    const supports = [...new Set(list.map((r) => str(r.elementId)).filter((e): e is string => e !== null && kindOf(e) !== null))].sort();
    const classRows = classNamesOf.get(id) ?? [];
    const classNames = [...new Set(classRows.map((r) => str(r.className)).filter((n): n is string => n !== null))].sort();
    // keyed by class names from the database: no prototype, so a name such as `__proto__` is an ordinary key
    const attributesByClass: Record<string, Record<string, unknown>> = Object.create(null);
    for (const r of classRows) {
      const name = str(r.className);
      if (!name) continue;
      const flat = r.attributes && typeof r.attributes === 'object' && !Array.isArray(r.attributes) ? (r.attributes as Record<string, unknown>) : {};
      const { value, dropped } = unflattenFlatKeys(flat, { leaf: coerceNeoInt });
      counts.attributeKeysDropped += dropped.length;
      // two relations to one class with different attributes: neither is read
      if (attributesByClass[name] && canonical(attributesByClass[name]) !== canonical(value)) attributesByClass[name] = {};
      else attributesByClass[name] = value;
    }
    if (supports.length === 0) continue;
    controls.set(id, { id, classNames, attributesByClass, supports });
  }

  return { boundaries, roots: roots.sort(), components, flows, dataItems, exposures, controls, counts };
}

/**
 * The boundaries above `id`, nearest first, each once: a breadth-first walk up `parents` with a visited set, so
 * a DAG or a cycle ends. `id` itself is not included.
 */
export function ancestorsOf(model: FoldedModel, id: string): string[] {
  const start = model.boundaries.get(id) ?? model.components.get(id);
  if (!start) return [];
  const seen = new Set<string>([id]);
  const out: string[] = [];
  let frontier = [...start.parents];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const b of frontier) {
      if (seen.has(b)) continue;
      seen.add(b);
      out.push(b);
      next.push(...(model.boundaries.get(b)?.parents ?? []));
    }
    frontier = next;
  }
  return out;
}
