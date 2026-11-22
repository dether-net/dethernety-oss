/**
 * A small builder for read-row fixtures: models written as their elements, folded as the module folds the
 * database's rows. Class categories come from the open-source catalogue, so a fixture's classes are real ones.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { foldModel, FoldedModel } from '../src/fold';
import type { ModelRows, Row } from '../src/reads';

const CATALOGUE = path.resolve(__dirname, '..', '..', 'dethernety-general', 'data', 'dethernety-general');
const categories = new Map<string, string>();
for (const kind of ['component', 'securityBoundary', 'dataFlow', 'data', 'control']) {
  for (const d of readdirSync(path.join(CATALOGUE, kind))) {
    try {
      const c = JSON.parse(readFileSync(path.join(CATALOGUE, kind, d, 'class.json'), 'utf8'));
      categories.set(`${kind}|${c.name}`, c.category);
    } catch {
      /* not a class folder */
    }
  }
}
const category = (kind: string, name: string) => {
  const c = categories.get(`${kind}|${name}`);
  if (c === undefined && name !== 'Hidden Edge Test') throw new Error(`fixture names an unknown ${kind} class: ${name}`);
  return c ?? 'Hidden Edge';
};

type Attrs = Record<string, unknown>;
type Lifecycle = 'confirmed' | 'pending';

export class ModelBuilder {
  private rows: ModelRows = {
    rootBoundaries: [],
    boundaryEdges: [],
    boundaryDepthCut: false,
    componentEdges: [],
    flows: [],
    flowData: [],
    dataItems: [],
    instances: [],
    exposures: [],
    exposureTechniques: [],
    supports: [],
    controlClasses: [],
  };

  /** The module holding the fixture's classes: the open-source catalogue unless a test says otherwise. */
  classModule = 'dethernety-general';

  private inst(kind: string, elementId: string, cls: string, attributes: Attrs, catKind: string): void {
    this.rows.instances.push({ elementId, kind, classId: `c:${cls.replace(/[^\w.-]/g, '_')}`, className: cls, classCategory: category(catKind, cls), classModule: this.classModule, attributes } as Row);
  }

  boundary(id: string, cls: string, parent: string | null = null, attrs: Attrs = {}): this {
    if (parent) this.rows.boundaryEdges.push({ id, parentId: parent });
    else this.rows.rootBoundaries.push({ id });
    this.inst('securityBoundary', id, cls, attrs, 'securityBoundary');
    return this;
  }

  component(id: string, cls: string, type: 'PROCESS' | 'STORE' | 'EXTERNAL_ENTITY', parent: string, attrs: Attrs = {}, crownJewel = false): this {
    this.rows.componentEdges.push({ id, parentId: parent, type, crownJewel });
    this.inst('component', id, cls, attrs, 'component');
    return this;
  }

  flow(id: string, cls: string, source: string, target: string, attrs: Attrs = {}, items: string[] = []): this {
    this.rows.flows.push({ id, sourceId: source, targetId: target });
    for (const d of items) this.rows.flowData.push({ flowId: id, dataId: d });
    if (cls === 'Hidden Edge Test') this.rows.instances.push({ elementId: id, kind: 'dataFlow', classId: 'c:he', className: cls, classCategory: 'Hidden Edge', attributes: attrs });
    else this.inst('dataFlow', id, cls, attrs, 'dataFlow');
    return this;
  }

  data(id: string, cls: string, isCredential: boolean | null = null): this {
    this.rows.dataItems.push({ id, isCredential });
    this.inst('data', id, cls, {}, 'data');
    return this;
  }

  exposure(id: string, elementId: string, name: string, techniques: string[], lifecycle: Lifecycle = 'confirmed', createdBy = 'SYSTEM'): this {
    this.rows.exposures.push({
      elementId,
      id,
      name,
      category: '',
      dispositionKind: lifecycle === 'confirmed' ? 'AFFIRMED' : null,
      dispositionedBy: lifecycle === 'confirmed' ? 'someone' : null,
      createdBy,
    });
    for (const t of techniques) this.rows.exposureTechniques.push({ exposureId: id, techniqueId: t });
    return this;
  }

  control(id: string, cls: string, supports: string[], attrs: Attrs = {}): this {
    for (const s of supports) this.rows.supports.push({ controlId: id, elementId: s });
    this.rows.controlClasses.push({ controlId: id, className: cls, attributes: attrs });
    return this;
  }

  fold(): FoldedModel {
    return foldModel(this.rows);
  }
}

export const model = () => new ModelBuilder();
