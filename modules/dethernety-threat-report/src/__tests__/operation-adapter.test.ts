import { describe, expect, it } from 'vitest';
import { hostingOf, OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY, operatorOf, readOperator } from '@dethernety/dt-core/operation-determination';

import {
  bagsByElement,
  declaredOperator,
  declaredProduct,
  OPERATION_ROWS_QUERY,
  operationSignatures,
  resolveOperation,
  type OperationRow,
} from '../operation-adapter';

const OP = 'dethernety_operated_by';
const PRODUCT = 'dethernety_product';
const rules = { operatorOf, hostingOf };

const row = (id: string, bag: Record<string, unknown>): OperationRow => ({ id, pairs: Object.entries(bag) });

describe('the keys', () => {
  it('are dt-core\'s', () => {
    expect([OP, PRODUCT]).toEqual([OPERATION_OPERATOR_KEY, OPERATION_PRODUCT_KEY]);
  });
});

describe('declaredOperator', () => {
  // The digest cannot import dt-core (CJS against ESM, and a poll must not fail on an import), so it reads the values
  // itself. This holds that reading to dt-core's.
  const cases: Array<Record<string, unknown>[]> = [
    [],
    [{}],
    [{ [OP]: 'VENDOR' }],
    [{ [OP]: 'CUSTOMER' }],
    [{ [OP]: 'vendor' }],
    [{ [OP]: 7 }],
    [{ [OP]: '' }],
    [{ [OP]: null }],
    [{ [OP]: ['VENDOR'] }],
    [{ [`${OP}[0]`]: 'VENDOR' }],
    [{ [`${OP}.x`]: 'VENDOR' }],
    [{ [`${OP}[0]`]: '' }],
    [{ [OP]: 'VENDOR' }, { [OP]: 'VENDOR' }],
    [{ [OP]: 'VENDOR' }, { [OP]: 'CUSTOMER' }],
    [{ [OP]: 'VENDOR' }, {}],
    [{ [OP]: 'VENDOR' }, { [`${OP}[0]`]: 'VENDOR' }],
  ];

  it('reads every case as dt-core does', () => {
    for (const bags of cases) {
      const core = readOperator(bags);
      const expected = core === null ? null : core.source === 'invalid' ? 'invalid' : core.party;
      expect(declaredOperator(bags), JSON.stringify(bags)).toBe(expected);
    }
  });
});

describe('declaredProduct', () => {
  it('trims, composes and cuts, and names none for anything but a non-empty string', () => {
    expect(declaredProduct([{ [PRODUCT]: '  Mail ' }])).toBe('Mail');
    expect(declaredProduct([{ [PRODUCT]: 'Café' }])).toBe('Café');
    expect(declaredProduct([{ [PRODUCT]: 'x'.repeat(300) }])).toHaveLength(200);
    for (const value of [undefined, null, '', '  ', 7, ['Mail']]) expect(declaredProduct([{ [PRODUCT]: value }])).toBeUndefined();
    expect(declaredProduct([{}, { [PRODUCT]: 'Second' }])).toBe('Second');
  });
});

describe('bagsByElement', () => {
  it('does not depend on the order the database answers in', () => {
    const a = row('c', { [OP]: 'VENDOR' });
    const b = row('c', { [OP]: 'CUSTOMER', [PRODUCT]: 'x' });
    expect(JSON.stringify(bagsByElement([a, b]).get('c'))).toBe(JSON.stringify(bagsByElement([b, a]).get('c')));
  });

});

describe('operationSignatures', () => {
  it('is empty when nothing declares, a blank value included', () => {
    expect(operationSignatures([])).toEqual([]);
    expect(operationSignatures([row('c', { [OP]: '', [PRODUCT]: '   ' })])).toEqual([]);
  });

  it('hashes values as read: stored another way that reads the same, it does not move', () => {
    expect(operationSignatures([row('c', { [OP]: 'x' })])).toEqual(operationSignatures([row('c', { [`${OP}[0]`]: 'y' })]));
    expect(operationSignatures([row('c', { [PRODUCT]: ' Mail ' })])).toEqual(operationSignatures([row('c', { [PRODUCT]: 'Mail' })]));
  });

  it('moves when a declaration changes, and is sorted', () => {
    expect(operationSignatures([row('c', { [OP]: 'VENDOR' })])).not.toEqual(operationSignatures([row('c', { [OP]: 'CUSTOMER' })]));
    expect(operationSignatures([row('b', { [OP]: 'VENDOR' }), row('a', { [OP]: 'VENDOR' })])[0]).toContain('"a"');
  });

  it('a separator in a value cannot make two declarations read the same', () => {
    expect(operationSignatures([row('a', { [OP]: 'VENDOR', [PRODUCT]: 'VENDOR|x' })])).not.toEqual(
      operationSignatures([row('a|VENDOR', { [OP]: 'VENDOR', [PRODUCT]: 'x' })]),
    );
  });
});

describe('the query', () => {
  it('keeps the version in the database: only the operator and the product leave it', () => {
    expect(OPERATION_ROWS_QUERY).not.toContain('version');
    expect(OPERATION_ROWS_QUERY).toContain(`k = '${OP}'`);
    expect(OPERATION_ROWS_QUERY).toContain(`k = '${PRODUCT}'`);
  });
});

describe('resolveOperation', () => {
  const graph = {
    boundaries: [
      { id: 'root', name: 'Root', parentBoundaryId: null },
      { id: 'cloud', name: 'Cloud', parentBoundaryId: 'root' },
      { id: 'bare', name: 'Bare', parentBoundaryId: 'root' },
      { id: 'vz', name: 'Vendor zone', parentBoundaryId: 'root' },
    ],
    components: [
      { id: 'c-root', boundaryId: 'root' },
      { id: 'c-cloud', boundaryId: 'cloud' },
      { id: 'c-cloud2', boundaryId: 'cloud' },
      { id: 'c-bare', boundaryId: 'bare' },
      { id: 'c-vz', boundaryId: 'vz' },
    ],
  };
  const zones = {
    root: { zone: 'INTERNAL', source: 'default' },
    cloud: { zone: 'INTERNAL', source: 'declared' },
    bare: { zone: 'INTERNAL', source: 'default' },
    vz: { zone: 'VENDOR', source: 'declared' },
  } as never;

  const resolve = (rows: OperationRow[]) => resolveOperation(rows, graph, zones, rules);

  it('resolves each source for a component', () => {
    const { state, elements } = resolve([row('c-root', { [OP]: 'VENDOR', [PRODUCT]: 'Mail' }), row('c-bare', { [OP]: 'x' })]);
    expect(state).toBe('resolved');
    expect(elements['c-root']).toEqual({ operator: { party: 'VENDOR', source: 'declared' }, product: 'Mail' });
    expect(elements['c-bare'].operator).toEqual({ party: 'CUSTOMER', source: 'invalid' });
    expect(elements['c-vz'].operator).toEqual({ party: 'VENDOR', source: 'zone' });
    expect(elements['c-cloud'].operator).toEqual({ party: 'CUSTOMER', source: 'default' });
  });

  it('names the hosting boundary only where it declares, and never the root or an undeclared parent', () => {
    const { elements } = resolve([row('cloud', { [OP]: 'VENDOR' }), row('root', { [OP]: 'VENDOR' })]);
    expect(elements['c-cloud'].hosting).toEqual({ boundaryId: 'cloud', name: 'Cloud', party: 'VENDOR', source: 'declared' });
    expect(elements['c-root']).not.toHaveProperty('hosting');
    expect(elements['c-bare']).not.toHaveProperty('hosting');
    expect(resolve([row('cloud', { [OP]: 'x' })]).elements['c-cloud'].hosting?.source).toBe('invalid');
  });

  it('a boundary has no hosting, and counts what it hosts only when declared a vendor and not the root', () => {
    const { elements } = resolve([row('cloud', { [OP]: 'VENDOR' }), row('root', { [OP]: 'VENDOR' })]);
    expect(elements.cloud).toEqual({ operator: { party: 'VENDOR', source: 'declared' }, drawnComponents: 2 });
    expect(elements.root).not.toHaveProperty('drawnComponents');
    expect(elements.vz).toEqual({ operator: { party: 'VENDOR', source: 'zone' } });
    expect(resolve([row('cloud', { [OP]: 'CUSTOMER' })]).elements.cloud).not.toHaveProperty('drawnComponents');
  });

  it('reads every class edge: two that disagree are invalid', () => {
    expect(resolve([row('c-root', { [OP]: 'VENDOR' }), row('c-root', { [OP]: 'CUSTOMER' })]).elements['c-root'].operator.source).toBe('invalid');
  });

  it('an id like __proto__ is an entry, not the prototype', () => {
    const { elements } = resolveOperation([], { boundaries: [], components: [{ id: '__proto__', boundaryId: null }] }, {}, rules);
    expect(Object.keys(elements)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(elements)).toBeNull();
    const stored = Object.getOwnPropertyDescriptor(JSON.parse(JSON.stringify(elements)), '__proto__');
    expect(stored?.value.operator.source).toBe('default');
  });
});
