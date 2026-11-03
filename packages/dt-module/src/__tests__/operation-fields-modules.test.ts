/**
 * The operation fields through both serving implementations: the same class content comes out with the
 * same fields from a file module and from a remote module, no fallback carries them, and evaluation input
 * never does, on the wire or in a local policy evaluation.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DtFileOpaModule } from '../dt-file-opa-module';
import { DtRemoteModule } from '../dt-remote-module';
import { deriveClassId } from '../identity';
import { MockContentServer } from '../testing/mock-content-server';
import { fakeDriver } from '../testing/contract/suite';
import {
  CLASS_ID,
  ENTITLED_TOKEN,
  MODULE_KEY,
  PIN,
  UNENTITLED_TOKEN,
  moduleDocument,
  templateResponse,
} from '../testing/fixtures';
import { OPERATION_OPERATOR_KEY, RESERVED_ATTRIBUTE_PREFIX, OPERATION_PRODUCT_KEY, OPERATION_VERSION_KEY } from '../operation-fields';

const MODULE_NAME = 'general';

/** A class template as authored: the authoring key `uiSchema`, a root Categorization. */
const authoredSchema = () => ({
  schema: {
    type: 'object',
    properties: { tls_min_version: { type: 'string' }, mfa_enforced: { type: 'boolean' } },
    required: ['tls_min_version'],
  },
  uiSchema: {
    type: 'Categorization',
    elements: [
      {
        type: 'Category',
        label: 'Access',
        elements: [{ type: 'Control', scope: '#/properties/tls_min_version' }, { type: 'Control', scope: '#/properties/mfa_enforced' }],
      },
    ],
  },
});
/** The same template as a content service serves it, normalized to `uischema`. */
const servedTemplate = () => {
  const { uiSchema, ...rest } = authoredSchema();
  return { ...rest, uischema: uiSchema };
};
const guide = () => [
  { option_name: 'tls_min_version', option_description: 'd', security_impact: 's', how_to_obtain: [], typical_values: [], value_type: 'string' },
];

const stubLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), verbose: vi.fn() };

let root: string;
let cacheDir: string;
const mock = new MockContentServer();

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-operation-'));
  cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-operation-cache-'));
  mock.reset();
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

// ── File module ──────────────────────────────────────────────────────────────────────────────

interface ClassFiles {
  typeDir: string;
  slug: string;
  schema?: unknown;
  guide?: unknown;
  /** Written as it is, in place of `guide`. */
  guideText?: string;
  rego?: string;
}

/** Write one class into a fresh module data dir and return a module whose `dbOps` points at it. */
function fileModule(spec: ClassFiles, attributes: Record<string, unknown> = {}) {
  const dataDir = fs.mkdtempSync(path.join(root, 'mod-'));
  const classDir = path.join(dataDir, MODULE_NAME, spec.typeDir, spec.slug);
  fs.mkdirSync(classDir, { recursive: true });
  if (spec.schema !== undefined) fs.writeFileSync(path.join(classDir, 'schema.json'), JSON.stringify(spec.schema));
  const guideText = spec.guideText ?? (spec.guide === undefined ? undefined : JSON.stringify(spec.guide));
  if (guideText !== undefined) fs.writeFileSync(path.join(classDir, 'guide.json'), guideText);
  if (spec.rego !== undefined) fs.writeFileSync(path.join(classDir, 'policies.rego'), spec.rego);
  const mod = new DtFileOpaModule(dataDir, MODULE_NAME, {} as any, stubLogger as any);
  (mod as any).dbOps = {
    getAttribute: vi.fn().mockResolvedValue(path.relative(dataDir, classDir)),
    getInstantiationAttributes: vi.fn().mockResolvedValue(attributes),
  };
  return mod;
}

const keysOf = (served: string) => Object.keys(JSON.parse(served).schema.properties);

describe('DtFileOpaModule', () => {
  it('serves a component its three fields, and a boundary its two', async () => {
    const component = fileModule({ typeDir: 'component', slug: 'web', schema: authoredSchema(), guide: guide() });
    expect(keysOf(await component.getClassTemplate('c'))).toEqual(['tls_min_version', 'mfa_enforced', OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY, OPERATION_VERSION_KEY]);
    const boundary = fileModule({ typeDir: 'securityBoundary', slug: 'subnet', schema: authoredSchema(), guide: guide() });
    expect(keysOf(await boundary.getClassTemplate('b'))).toEqual(['tls_min_version', 'mfa_enforced', OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY]);
    expect(JSON.parse(await boundary.getClassGuide('b')).map((e: any) => e.option_name)).toEqual(['tls_min_version', OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY]);
  });

  it('serves a control class, and its guide, byte for byte as before', async () => {
    const mod = fileModule({ typeDir: 'control', slug: 'mfa', schema: authoredSchema(), guide: guide() });
    expect(keysOf(await mod.getClassTemplate('x'))).toEqual(['tls_min_version', 'mfa_enforced']);
    expect(await mod.getClassGuide('x')).toBe(JSON.stringify(guide()));
  });

  it('does not extend its fallbacks', async () => {
    const mod = fileModule({ typeDir: 'component', slug: 'bare' });
    expect(await mod.getClassTemplate('c')).not.toContain(RESERVED_ATTRIBUTE_PREFIX);
    expect(await mod.getClassGuide('c')).not.toContain(RESERVED_ATTRIBUTE_PREFIX);
  });

  it('returns a guide it cannot parse as it is', async () => {
    const mod = fileModule({ typeDir: 'component', slug: 'web', schema: authoredSchema(), guideText: '{ not json' });
    expect(await mod.getClassGuide('c')).toBe('{ not json');
  });

  it('never hands the operation fields to the policy engine', async () => {
    const mod = fileModule(
      { typeDir: 'component', slug: 'web', schema: authoredSchema(), rego: 'package x\n' },
      { tls_min_version: '1.0', [OPERATION_OPERATOR_KEY]: 'VENDOR', [OPERATION_PRODUCT_KEY]: 'p', [OPERATION_VERSION_KEY]: '1', dethernety_example: 'x' },
    );
    const engine = (mod as any).regoEngine;
    vi.spyOn(engine, 'has').mockReturnValue(true);
    const evaluate = vi.spyOn(engine, 'evaluate').mockReturnValue([]);
    await mod.getExposures('el-1', 'c');
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0][2]).toEqual({ tls_min_version: '1.0' });
  });
});

// ── Remote module ────────────────────────────────────────────────────────────────────────────

const remote = (pin: string = PIN, driver: unknown = {}) =>
  new DtRemoteModule({ moduleKey: MODULE_KEY, pin }, driver, stubLogger as any, {
    fetchImpl: mock.fetch,
    baseUrl: 'https://mock.local',
    cacheDir,
  });

describe('DtRemoteModule', () => {
  it('extends a template once, served fresh or from its cache', async () => {
    const mod = remote();
    await mod.getMetadata();
    const first = await mod.getClassTemplate(CLASS_ID, ENTITLED_TOKEN);
    const before = mock.requests.length;
    const second = await mod.getClassTemplate(CLASS_ID, ENTITLED_TOKEN);
    expect(mock.requests.length).toBe(before); // served from the cache
    expect(second).toBe(first);
    expect(keysOf(second).filter((k) => k.startsWith(RESERVED_ATTRIBUTE_PREFIX))).toEqual([OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY, OPERATION_VERSION_KEY]);
  });

  it('leaves a class the module document does not list as it came', async () => {
    const mod = remote();
    await mod.getMetadata();
    expect(await mod.getClassTemplate('acme-compute.unlisted', ENTITLED_TOKEN)).not.toContain(RESERVED_ATTRIBUTE_PREFIX);
  });

  it('extends a class whose id the platform stamps, because the document gives none', async () => {
    const unnamed = { ...moduleDocument.module.componentClasses![0], id: undefined };
    mock.setModuleDocument({
      ...moduleDocument,
      module: { ...moduleDocument.module, componentClasses: [unnamed] },
    });
    const mod = remote();
    await mod.getMetadata();
    const stamped = deriveClassId(MODULE_KEY, 'componentClasses', 'Virtual Machine');
    expect(await mod.getClassTemplate(stamped, ENTITLED_TOKEN)).toContain(OPERATION_OPERATOR_KEY);
  });

  it('does not extend its read-only fallbacks: no credential, a denial, an outage', async () => {
    const mod = remote();
    await mod.getMetadata();
    expect(await mod.getClassTemplate(CLASS_ID)).not.toContain(RESERVED_ATTRIBUTE_PREFIX);
    expect(await mod.getClassGuide(CLASS_ID)).not.toContain(RESERVED_ATTRIBUTE_PREFIX);
    expect(await mod.getClassTemplate(CLASS_ID, UNENTITLED_TOKEN)).not.toContain(RESERVED_ATTRIBUTE_PREFIX);
    mock.setFailureMode('network');
    const outage = remote();
    // The outage client registered from the cache the first one wrote.
    await outage.getMetadata();
    expect(await outage.getClassTemplate(CLASS_ID, ENTITLED_TOKEN)).not.toContain(RESERVED_ATTRIBUTE_PREFIX);
  });

  it('extends a class it learns of when a background refresh adopts its own pin', async () => {
    const BUMPED = 'sha256:bumped-for-operation-test';
    await remote().getMetadata(); // a good entry at the fixture pin
    mock.setFailureMode('network');
    const mod = remote(BUMPED);
    await mod.getMetadata(); // registered from the fixture pin's entry
    mock.setFailureMode('none');
    const boundaryId = 'acme-compute.subnet';
    mock.setModuleDocument({
      ...moduleDocument,
      module: {
        ...moduleDocument.module,
        securityBoundaryClasses: [{ id: boundaryId, name: 'Subnet', description: 'd', category: 'network', properties: {} } as any],
      },
    });
    expect(await mod.getClassTemplate(boundaryId, ENTITLED_TOKEN)).not.toContain(OPERATION_OPERATOR_KEY);
    await mod.getMetadata(); // starts the background fetch of its own pin
    await vi.waitFor(async () => expect(await mod.getClassTemplate(boundaryId, ENTITLED_TOKEN)).toContain(OPERATION_OPERATOR_KEY), {
      timeout: 5000,
    });
    expect(keysOf(await mod.getClassTemplate(boundaryId, ENTITLED_TOKEN))).not.toContain(OPERATION_VERSION_KEY);
  });
});

// ── Parity ───────────────────────────────────────────────────────────────────────────────────

describe('file and remote modules', () => {
  it('serve the same class content with the same operation fields', async () => {
    const file = fileModule({ typeDir: 'component', slug: 'vm', schema: authoredSchema(), guide: guide() });
    mock.setTemplate(servedTemplate());
    mock.setGuide(guide());
    const mod = remote();
    await mod.getMetadata();
    expect(JSON.parse(await mod.getClassTemplate(CLASS_ID, ENTITLED_TOKEN))).toEqual(JSON.parse(await file.getClassTemplate('c')));
    expect(JSON.parse(await mod.getClassGuide(CLASS_ID, ENTITLED_TOKEN))).toEqual(JSON.parse(await file.getClassGuide('c')));
  });
});

// ── Egress ───────────────────────────────────────────────────────────────────────────────────

describe('remote evaluation', () => {
  const attributes = {
    authentication_enabled: false,
    tls_version: '1.2',
    [OPERATION_OPERATOR_KEY]: 'VENDOR',
    [OPERATION_PRODUCT_KEY]: 'Example product',
    [OPERATION_VERSION_KEY]: '2.1.0',
    [`${OPERATION_OPERATOR_KEY}[0]`]: 'VENDOR',
    dethernety_example: 'reserved',
  };
  const evalBodies = () => mock.requests.filter((r) => r.method === 'POST').map((r) => r.bodyText ?? '');

  it('never sends an operation field (the schema allowlist alone already drops them)', async () => {
    const mod = remote(PIN, fakeDriver(attributes));
    await mod.getMetadata();
    await mod.getExposures('el-1', CLASS_ID, ENTITLED_TOKEN);
    const bodies = evalBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toContain(RESERVED_ATTRIBUTE_PREFIX);
    expect(JSON.parse(bodies[0]).attributes).toEqual({ authentication_enabled: false, tls_version: '1.2' });
  });

  it('never sends one even when the served schema declares it', async () => {
    const declaring = JSON.parse(JSON.stringify(templateResponse.template));
    declaring.schema.properties[OPERATION_PRODUCT_KEY] = { type: 'string' };
    declaring.schema.properties[OPERATION_OPERATOR_KEY] = { type: 'string' };
    mock.setTemplate(declaring);
    const mod = remote(PIN, fakeDriver(attributes));
    await mod.getMetadata();
    await mod.getExposures('el-1', CLASS_ID, ENTITLED_TOKEN);
    expect(evalBodies()[0]).not.toContain(RESERVED_ATTRIBUTE_PREFIX);
  });
});
