import { describe, it, expect } from 'vitest';
import * as core from '@dethernety/dt-core/operation-determination';
import {
  OPERATION_OPERATOR_KEY,
  OPERATION_PRODUCT_KEY,
  OPERATION_VERSION_KEY,
  RESERVED_ATTRIBUTE_PREFIX,
  OPERATOR_VALUES,
  OPERATION_FIELD_KEYS,
  OPERATION_CATEGORY_LABEL,
  LEAVE_EMPTY_UNLESS_KNOWN,
  classTypeFromPath,
  withOperationFields,
  withOperationContent,
  withOperationGuide,
  withoutReservedAttributes,
} from '../operation-fields';

/** A class template as modules serve it: a root Categorization of categories. */
function template() {
  return {
    schema: {
      type: 'object',
      properties: {
        tls_min_version: { type: 'string', enum: ['1.2', '1.3'] },
        mfa_enforced: { type: 'boolean' },
      },
      required: ['tls_min_version'],
    },
    uischema: {
      type: 'Categorization',
      elements: [
        {
          type: 'Category',
          label: 'Access',
          elements: [
            {
              type: 'HorizontalLayout',
              elements: [
                { type: 'Control', scope: '#/properties/tls_min_version' },
                { type: 'Control', scope: '#/properties/mfa_enforced' },
              ],
            },
          ],
        },
      ],
    },
  };
}

function guide() {
  return [
    { option_name: 'tls_min_version', option_description: 'd', security_impact: 's', how_to_obtain: [], typical_values: ['1.2'], value_type: 'enum' },
  ];
}

const props = (t: unknown) => (t as { schema: { properties: Record<string, any> } }).schema.properties;
const categories = (t: unknown) => (t as { uischema: { elements: any[] } }).uischema.elements;

describe('the constants', () => {
  it('equal the ones dt-core holds with the rules', () => {
    expect(OPERATION_OPERATOR_KEY).toBe(core.OPERATION_OPERATOR_KEY);
    expect(OPERATION_PRODUCT_KEY).toBe(core.OPERATION_PRODUCT_KEY);
    expect(OPERATION_VERSION_KEY).toBe(core.OPERATION_VERSION_KEY);
    expect(RESERVED_ATTRIBUTE_PREFIX).toBe(core.RESERVED_ATTRIBUTE_PREFIX);
    expect([...OPERATOR_VALUES]).toEqual([...core.OPERATOR_VALUES]);
    expect(OPERATION_FIELD_KEYS).toEqual(core.OPERATION_FIELD_KEYS);
    expect(OPERATION_CATEGORY_LABEL).toEqual(core.OPERATION_CATEGORY_LABEL);
  });

  it('every served key carries the reserved prefix', () => {
    for (const keys of Object.values(OPERATION_FIELD_KEYS)) {
      for (const key of keys) expect(key.startsWith(RESERVED_ATTRIBUTE_PREFIX)).toBe(true);
    }
  });
});

describe('withOperationFields', () => {
  it('gives a component the operator, the product and the version, in one category placed first', () => {
    const out = withOperationFields(template(), 'component');
    expect(Object.keys(props(out))).toEqual(['tls_min_version', 'mfa_enforced', OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY, OPERATION_VERSION_KEY]);
    const first = categories(out)[0];
    expect(first).toMatchObject({ type: 'Category', label: 'Operation & version' });
    const scopes = JSON.stringify(first);
    for (const key of [OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY, OPERATION_VERSION_KEY]) expect(scopes).toContain(`#/properties/${key}`);
  });

  it('gives a boundary the operator and the product, under its own label', () => {
    const out = withOperationFields(template(), 'securityBoundary');
    expect(Object.keys(props(out))).toEqual(['tls_min_version', 'mfa_enforced', OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY]);
    expect(categories(out)[0]).toMatchObject({ type: 'Category', label: 'Operation' });
  });

  it('leaves the other class types as they came', () => {
    for (const classType of ['dataFlow', 'data', 'control', 'issue', 'analysis', undefined]) {
      const input = template();
      expect(withOperationFields(input, classType)).toBe(input);
    }
  });

  it('offers the operator as a fixed choice with no default, and bounds the free text', () => {
    const p = props(withOperationFields(template(), 'component'));
    expect(p[OPERATION_OPERATOR_KEY]).toMatchObject({ type: 'string', oneOf: [{ const: 'CUSTOMER' }, { const: 'VENDOR' }] });
    for (const key of [OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY, OPERATION_VERSION_KEY]) expect(p[key]).not.toHaveProperty('default');
    expect(p[OPERATION_PRODUCT_KEY].maxLength).toBe(200);
    expect(p[OPERATION_VERSION_KEY].maxLength).toBe(64);
  });

  it('hides the version for a vendor-operated element', () => {
    const first = categories(withOperationFields(template(), 'component'))[0];
    const version = first.elements.find((e: any) => e.scope === `#/properties/${OPERATION_VERSION_KEY}`);
    expect(version.rule).toEqual({
      effect: 'HIDE',
      condition: { scope: `#/properties/${OPERATION_OPERATOR_KEY}`, schema: { const: 'VENDOR' } },
    });
  });

  it('changes nothing else: required, the existing properties and categories, the input object', () => {
    const input = template();
    const before = JSON.parse(JSON.stringify(input));
    const out = withOperationFields(input, 'component') as ReturnType<typeof template>;
    expect(input).toEqual(before);
    expect(out.schema.required).toEqual(['tls_min_version']);
    expect(out.schema.properties.tls_min_version).toEqual(before.schema.properties.tls_min_version);
    expect(out.uischema.elements.slice(1)).toEqual(before.uischema.elements);
  });

  it('is idempotent', () => {
    const once = withOperationFields(template(), 'component');
    const twice = withOperationFields(once, 'component');
    expect(twice).toEqual(once);
    expect(categories(twice).filter((c: any) => c.label === 'Operation & version')).toHaveLength(1);
  });

  it('replaces whatever a template itself declares under the reserved prefix with the platform’s own', () => {
    const input = template() as any;
    input.schema.properties[OPERATION_OPERATOR_KEY] = { type: 'string', oneOf: [{ const: 'CUSTOMER', title: 'A vendor' }] };
    input.schema.properties.dethernety_example = { type: 'string' };
    input.schema.required.push(OPERATION_OPERATOR_KEY);
    input.uischema.elements[0].elements[0].elements.push({ type: 'Control', scope: `#/properties/${OPERATION_OPERATOR_KEY}` });
    input.uischema.elements.push({
      type: 'Category',
      label: 'Own',
      elements: [{ type: 'Control', scope: '#/properties/dethernety_example', rule: { effect: 'HIDE', condition: {} } }],
    });
    const out = withOperationFields(input, 'component') as any;
    expect(out.schema.properties[OPERATION_OPERATOR_KEY]).toEqual(props(withOperationFields(template(), 'component'))[OPERATION_OPERATOR_KEY]);
    expect(out.schema.properties).not.toHaveProperty('dethernety_example');
    expect(out.schema.required).toEqual(['tls_min_version']);
    // The served control is gone from its layout, the category that held only a reserved control is gone,
    // and the platform's category is the only one with operation controls.
    expect(out.uischema.elements[1]).toEqual(template().uischema.elements[0]);
    expect(out.uischema.elements.map((c: any) => c.label)).toEqual(['Operation & version', 'Access']);
  });

  it('drops a served Control unless its scope is a plain chain of properties with no reserved key', () => {
    const scopes = [
      `#/properties/${OPERATION_OPERATOR_KEY}`,
      `#/allOf/0/properties/${OPERATION_OPERATOR_KEY}`,
      `/properties/${OPERATION_OPERATOR_KEY}`,
      `#/x/${OPERATION_OPERATOR_KEY}`,
      '#/properties/dethernety_example/properties/nested',
      `#/properties/mfa_enforced/properties/${OPERATION_OPERATOR_KEY}`,
      '#/properties/dethernetyanyOf/0/_operated_by',
      '#/properties/dethernetyallOf/12/_operated_by',
      '#/properties/dethernetyoneOf/3/_operated_by',
      '#/properties/dethernetythen/_operated_by',
      '#/properties/dethernetyelse/_operated_by',
      `#/properties/[${OPERATION_OPERATOR_KEY}]`,
      `#/properties/["${OPERATION_OPERATOR_KEY}"]`,
      `#/properties/['${OPERATION_OPERATOR_KEY}']`,
      '#/properties/["dethernety\\_operated_by"]',
      '#/properties/[dethernetythen/_operated_by]',
      '#/allOf/0/properties/mfa_enforced',
      '#/properties/a.b',
      '#/properties/a~1b',
      '#/properties/',
      '#/properties',
      '#/',
      '#',
      '',
    ];
    for (const scope of scopes) {
      const input = template() as any;
      input.uischema.elements[0].elements[0].elements.push({ type: 'Control', scope, label: 'Swapped' });
      const out = withOperationFields(input, 'component') as any;
      expect(out.uischema.elements[1]).toEqual(template().uischema.elements[0]);
    }
  });

  it('keeps a served Control whose key only resembles the prefix', () => {
    const input = template() as any;
    input.schema.properties.dethernetyish = { type: 'string' };
    input.uischema.elements[0].elements[0].elements.push({ type: 'Control', scope: '#/properties/dethernetyish' });
    const out = withOperationFields(input, 'component') as any;
    expect(out.schema.properties).toHaveProperty('dethernetyish');
    expect(JSON.stringify(out.uischema.elements[1])).toContain('#/properties/dethernetyish');
  });

  it('keeps an element with a plain scope, whatever its key looks like, as the same object', () => {
    const scopes = [
      '#/properties/dethernetyish',
      '#/properties/dethernety',
      '#/properties/authenthen',
      '#/properties/anyOf/properties/x',
      '#/properties/mfa_enforced/properties/nested-key/properties/k 2',
    ];
    for (const scope of scopes) {
      const control = { type: 'Control', scope };
      const input = template() as any;
      input.uischema.elements[0].elements[0].elements.push(control);
      const out = withOperationFields(input, 'component') as any;
      expect(out.uischema.elements[1].elements[0].elements).toContain(control);
    }
  });

  it('drops every element with a scope it may not carry, whatever its type', () => {
    for (const type of ['ListWithDetail', 'Custom', 'Group']) {
      const input = template() as any;
      input.uischema.elements[0].elements[0].elements.push({ type, scope: '#/properties/dethernetythen/_operated_by' });
      const out = withOperationFields(input, 'component') as any;
      expect(out.uischema.elements[1]).toEqual(template().uischema.elements[0]);
    }
  });

  it('drops an element whose scope is not a string', () => {
    const input = template() as any;
    input.uischema.elements[0].elements[0].elements.push({ type: 'Control', scope: 7 }, { type: 'Control', scope: null });
    const out = withOperationFields(input, 'component') as any;
    expect(out.uischema.elements[1]).toEqual(template().uischema.elements[0]);
  });

  it('reads options.detail by the same rule, and leaves a detail with nothing to drop as the same object', () => {
    const reserved = { type: 'Control', scope: `#/properties/${OPERATION_OPERATOR_KEY}`, label: 'Swapped' };
    const plain = { type: 'Control', scope: '#/properties/nested' };
    const served = (detail: unknown) => {
      const input = template() as any;
      input.uischema.elements[0].elements[0].elements.push({ type: 'Control', scope: '#/properties/mfa_enforced', options: { detail, showSortButtons: true } });
      return (withOperationFields(input, 'component') as any).uischema.elements[1].elements[0].elements.at(-1);
    };

    const onlyReserved = { type: 'VerticalLayout', elements: [reserved] };
    expect(served(onlyReserved).options).toEqual({ showSortButtons: true });

    const mixed = { type: 'VerticalLayout', elements: [reserved, plain] };
    expect(served(mixed).options).toEqual({ showSortButtons: true, detail: { type: 'VerticalLayout', elements: [plain] } });

    const clean = { type: 'VerticalLayout', elements: [plain] };
    expect(served(clean).options.detail).toBe(clean);
    expect(served('GENERATE').options.detail).toBe('GENERATE');
  });

  it('reads every option that holds an object, since a renderer builds some of their keys per schema type', () => {
    const reserved = { type: 'Control', scope: `#/properties/${OPERATION_OPERATOR_KEY}`, label: 'Swapped' };
    const clean = { format: 'radio' };
    const input = template() as any;
    input.uischema.elements[0].elements[0].elements.push({
      type: 'Control',
      scope: '#/properties/mfa_enforced',
      options: { 'object-detail': reserved, 'string-detail': { type: 'VerticalLayout', elements: [reserved] }, clean, multi: true, absent: null },
    });
    const control = (withOperationFields(input, 'component') as any).uischema.elements[1].elements[0].elements.at(-1);
    expect(control.options).toEqual({ clean, multi: true, absent: null });
    expect(control.options.clean).toBe(clean);
  });

  it('drops an element whose elements are not a list, whatever it holds', () => {
    const input = template() as any;
    input.uischema.elements[0].elements[0].elements.push({
      type: 'Group',
      label: 'G',
      elements: { a: { type: 'Control', scope: `#/properties/${OPERATION_OPERATOR_KEY}` } },
    });
    const out = withOperationFields(input, 'component') as any;
    expect(out.uischema.elements[1]).toEqual(template().uischema.elements[0]);
  });

  it('drops a root-scope element with its detail, and a category left empty goes with it', () => {
    const input = template() as any;
    input.uischema.elements.push({
      type: 'Category',
      label: 'Whole form',
      elements: [{ type: 'Control', scope: '#', options: { detail: { type: 'VerticalLayout', elements: [{ type: 'Control', scope: '#/properties/mfa_enforced' }] } } }],
    });
    const out = withOperationFields(input, 'component') as any;
    expect(out.uischema.elements.map((c: any) => c.label)).toEqual(['Operation & version', 'Access']);
  });

  it('holds the root of a template it extends to the same rule, and still serves the category', () => {
    const reserved = { type: 'Control', scope: `#/properties/${OPERATION_OPERATOR_KEY}` };
    const withRoot = (root: Record<string, unknown>) => {
      const input = template() as any;
      input.uischema = { ...input.uischema, ...root };
      return withOperationFields(input, 'component') as any;
    };

    const scoped = withRoot({ scope: `#/allOf/0/properties/${OPERATION_OPERATOR_KEY}` });
    expect(scoped.uischema).not.toHaveProperty('scope');
    expect(scoped.uischema.elements.map((c: any) => c.label)).toEqual(['Operation & version', 'Access']);

    const optioned = withRoot({ scope: '#/properties/mfa_enforced', options: { 'object-detail': reserved, multi: true } });
    expect(optioned.uischema.scope).toBe('#/properties/mfa_enforced');
    expect(optioned.uischema.options).toEqual({ multi: true });

    const emptied = withRoot({ scope: '#', elements: [{ type: 'Category', label: 'Gone', elements: [reserved] }] });
    expect(emptied.uischema).not.toHaveProperty('scope');
    expect(emptied.uischema.elements.map((c: any) => c.label)).toEqual(['Operation & version']);

    expect(withOperationFields(optioned, 'component')).toEqual(optioned);
  });

  it('moves a category served last to the front, ahead of every category of the class', () => {
    const input = template() as any;
    input.uischema.elements.push({ type: 'Category', label: 'Logging', elements: [{ type: 'Control', scope: '#/properties/mfa_enforced' }] });
    const once = withOperationFields(input, 'component') as any;
    expect(once.uischema.elements.map((c: any) => c.label)).toEqual(['Operation & version', 'Access', 'Logging']);
    const servedLast = { ...once, uischema: { ...once.uischema, elements: [...once.uischema.elements.slice(1), once.uischema.elements[0]] } };
    expect(withOperationFields(servedLast, 'component')).toEqual(once);
  });

  it('gives a template of another shape no fields, but holds its elements to the same rule', () => {
    const plain = { type: 'Control', scope: '#/properties/mfa_enforced' };
    const reserved = { type: 'Control', scope: `#/properties/${OPERATION_OPERATOR_KEY}` };
    const shaped = (uischema: unknown, schema: unknown = { type: 'object', properties: { mfa_enforced: { type: 'boolean' } } }) =>
      withOperationFields({ schema, uischema }, 'component') as any;

    const layout = shaped({ type: 'VerticalLayout', elements: [plain, reserved] });
    expect(layout.uischema).toEqual({ type: 'VerticalLayout', elements: [plain] });
    expect(layout.schema.properties).not.toHaveProperty(OPERATION_OPERATOR_KEY);

    expect(shaped({ type: 'Categorization', elements: [{ type: 'Category', label: 'A', elements: [reserved] }] }, {}).uischema).toEqual({ type: 'VerticalLayout', elements: [] });
    expect(shaped({ type: 'Control', scope: '#' }).uischema).toEqual({ type: 'VerticalLayout', elements: [] });
  });

  it('leaves a template of another shape as it came', () => {
    const noProps = { schema: { type: 'object' }, uischema: template().uischema };
    const vertical = { schema: template().schema, uischema: { type: 'VerticalLayout', elements: [] } };
    const noElements = { schema: template().schema, uischema: { type: 'Categorization' } };
    for (const input of [null, undefined, 'x', 42, [], {}, { schema: null }, noProps, vertical, noElements]) {
      expect(withOperationFields(input, 'component')).toBe(input);
    }
  });
});

describe('withOperationGuide', () => {
  it('appends one entry per field of the class type', () => {
    expect((withOperationGuide(guide(), 'component') as any[]).map((e) => e.option_name)).toEqual([
      'tls_min_version',
      OPERATION_OPERATOR_KEY,
      OPERATION_PRODUCT_KEY,
      OPERATION_VERSION_KEY,
    ]);
    expect((withOperationGuide(guide(), 'securityBoundary') as any[]).map((e) => e.option_name)).toEqual([
      'tls_min_version',
      OPERATION_OPERATOR_KEY,
      OPERATION_PRODUCT_KEY,
    ]);
  });

  it('writes entries in the guide shape, with distinct step types within an entry', () => {
    for (const entry of (withOperationGuide([], 'component') as any[])) {
      expect(Object.keys(entry).sort()).toEqual(
        ['how_to_obtain', 'option_description', 'option_name', 'security_impact', 'typical_values', 'value_type'],
      );
      const types = entry.how_to_obtain.map((s: any) => s.type);
      expect(new Set(types).size).toBe(types.length);
    }
  });

  it('tells the reader of every entry to leave the field empty unless it is known', () => {
    for (const classType of ['component', 'securityBoundary']) {
      const twice = withOperationGuide(withOperationGuide([], classType), classType) as any[];
      const added = twice.filter((e) => e.option_name.startsWith(RESERVED_ATTRIBUTE_PREFIX));
      expect(added.length).toBeGreaterThan(0);
      for (const entry of added) {
        expect(entry.option_description.split(LEAVE_EMPTY_UNLESS_KNOWN)).toHaveLength(2);
        expect(entry.option_description).toMatch(/Leave this field empty unless you know the answer: never enter "unknown" or a guess\.$/);
      }
    }
  });

  it('is idempotent, and leaves the input as it came', () => {
    const input = guide();
    const once = withOperationGuide(input, 'component');
    expect(input).toEqual(guide());
    expect(withOperationGuide(once, 'component')).toEqual(once);
  });

  it('replaces entries a guide itself has for reserved keys with the platform’s own', () => {
    const input = [...guide(), { option_name: OPERATION_OPERATOR_KEY, option_description: 'served' }, { option_name: 'dethernety_example' }];
    const out = withOperationGuide(input, 'component') as any[];
    expect(out.map((e) => e.option_name)).toEqual(['tls_min_version', OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY, OPERATION_VERSION_KEY]);
    expect(out[1].option_description).not.toBe('served');
  });
});

describe('withOperationContent', () => {
  it('returns template text the rule leaves as it was with its exact bytes', () => {
    const text = '{ "schema": {"type": "object"},  "uischema": {"type": "VerticalLayout", "elements": [] } }';
    expect(withOperationContent('template', text, 'component')).toBe(text);
  });

  it('extends served template and guide text of an operated class', () => {
    expect(JSON.parse(withOperationContent('template', JSON.stringify(template()), 'component'))).toEqual(
      withOperationFields(template(), 'component'),
    );
    expect(JSON.parse(withOperationContent('guide', JSON.stringify(guide()), 'securityBoundary'))).toEqual(
      withOperationGuide(guide(), 'securityBoundary'),
    );
  });

  it('keeps the exact bytes of text it does not change or cannot parse', () => {
    const text = `${JSON.stringify(guide(), null, 2)}\n`;
    expect(withOperationContent('guide', text, 'control')).toBe(text);
    expect(withOperationContent('guide', text, undefined)).toBe(text);
    expect(withOperationContent('template', '{ not json', 'component')).toBe('{ not json');
    const map = JSON.stringify({ tls_min_version: 'Use TLS 1.2.' });
    expect(withOperationContent('guide', map, 'component')).toBe(map);
  });

  it('leaves another class type or a guide that is not a list as it came', () => {
    const map = { tls_min_version: 'Use TLS 1.2.' };
    expect(withOperationGuide(map, 'component')).toBe(map);
    const input = guide();
    expect(withOperationGuide(input, 'control')).toBe(input);
    expect(withOperationGuide(null, 'component')).toBeNull();
  });
});

describe('withoutReservedAttributes', () => {
  it('removes every reserved key, flattened list forms included, and keeps the rest', () => {
    const out = withoutReservedAttributes({
      [OPERATION_OPERATOR_KEY]: 'VENDOR',
      [OPERATION_PRODUCT_KEY]: 'p',
      [OPERATION_VERSION_KEY]: '1.0',
      [`${OPERATION_OPERATOR_KEY}[0]`]: 'VENDOR',
      dethernety_example: 'reserved',
      tls_min_version: '1.2',
      dt_endpoints_configured: true,
    });
    expect(out).toEqual({ tls_min_version: '1.2', dt_endpoints_configured: true });
  });

  it('returns the input when there is nothing to remove', () => {
    const input = { a: 1 };
    expect(withoutReservedAttributes(input)).toBe(input);
  });
});

describe('classTypeFromPath', () => {
  it('reads the type directory from either separator', () => {
    expect(classTypeFromPath('general/component/web-server')).toBe('component');
    expect(classTypeFromPath('general\\securityBoundary\\subnet')).toBe('securityBoundary');
    expect(classTypeFromPath('general/control/mfa/')).toBe('control');
  });

  it('reads nothing from a path without one', () => {
    expect(classTypeFromPath('web-server')).toBeUndefined();
    expect(classTypeFromPath(undefined)).toBeUndefined();
    expect(classTypeFromPath(null)).toBeUndefined();
  });
});
