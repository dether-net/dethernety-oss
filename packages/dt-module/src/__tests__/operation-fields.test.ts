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
  it('gives a component the operator, the product and the version, in one category placed last', () => {
    const out = withOperationFields(template(), 'component');
    expect(Object.keys(props(out))).toEqual(['tls_min_version', 'mfa_enforced', OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY, OPERATION_VERSION_KEY]);
    const last = categories(out)[categories(out).length - 1];
    expect(last).toMatchObject({ type: 'Category', label: 'Operation & version' });
    const scopes = JSON.stringify(last);
    for (const key of [OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY, OPERATION_VERSION_KEY]) expect(scopes).toContain(`#/properties/${key}`);
  });

  it('gives a boundary the operator and the product, under its own label', () => {
    const out = withOperationFields(template(), 'securityBoundary');
    expect(Object.keys(props(out))).toEqual(['tls_min_version', 'mfa_enforced', OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY]);
    expect(categories(out)[categories(out).length - 1]).toMatchObject({ type: 'Category', label: 'Operation' });
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
    const last = categories(withOperationFields(template(), 'component')).at(-1);
    const version = last.elements.find((e: any) => e.scope === `#/properties/${OPERATION_VERSION_KEY}`);
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
    expect(out.uischema.elements.slice(0, -1)).toEqual(before.uischema.elements);
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
    expect(out.uischema.elements[0]).toEqual(template().uischema.elements[0]);
    expect(out.uischema.elements.map((c: any) => c.label)).toEqual(['Access', 'Operation & version']);
  });

  it('drops a served Control that reaches a reserved key through any scope form', () => {
    const scopes = [
      `#/properties/${OPERATION_OPERATOR_KEY}`,
      `#/allOf/0/properties/${OPERATION_OPERATOR_KEY}`,
      `/properties/${OPERATION_OPERATOR_KEY}`,
      `#/x/${OPERATION_OPERATOR_KEY}`,
      '#/properties/dethernety_example/properties/nested',
    ];
    for (const scope of scopes) {
      const input = template() as any;
      input.uischema.elements[0].elements[0].elements.push({ type: 'Control', scope, label: 'Swapped' });
      const out = withOperationFields(input, 'component') as any;
      expect(out.uischema.elements[0]).toEqual(template().uischema.elements[0]);
    }
  });

  it('keeps a served Control whose key only resembles the prefix', () => {
    const input = template() as any;
    input.schema.properties.dethernetyish = { type: 'string' };
    input.uischema.elements[0].elements[0].elements.push({ type: 'Control', scope: '#/properties/dethernetyish' });
    const out = withOperationFields(input, 'component') as any;
    expect(out.schema.properties).toHaveProperty('dethernetyish');
    expect(JSON.stringify(out.uischema.elements[0])).toContain('#/properties/dethernetyish');
  });

  it('leaves a template of another shape as it came, and never throws', () => {
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
