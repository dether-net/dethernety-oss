/**
 * A relationship operation is built from a validated non-empty id, or it is not built.
 *
 * The value of this guard is entirely in what it rejects, so every test here is paired: the rejecting
 * case AND the case that must still pass through untouched. A guard asserted in one direction only is
 * satisfied by one that rejects everything, which would break every write in the tree.
 */

import { describe, it, expect } from 'vitest';
import { isConnectId, connectIds, assertConnectId, UnresolvedIdError } from '../connect-id.js';

describe('isConnectId', () => {
  it.each([['an id', 'ctl-1'], ['an id with inner space', 'a b'], ['a numeric-looking id', '0']])(
    'accepts %s',
    (_label, value) => {
      expect(isConnectId(value)).toBe(true);
    },
  );

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['the empty string', ''],
    // Whitespace matches nothing, which after an unconditional disconnect is the same silent orphaning
    // an empty string produces — so it is rejected for the same reason, not as tidiness.
    ['whitespace only', '   '],
    ['a number', 0],
    ['an object', {}],
  ])('rejects %s', (_label, value) => {
    expect(isConnectId(value)).toBe(false);
  });
});

describe('connectIds — an array drops what it cannot name and writes the rest', () => {
  it('drops the unusable entries and keeps the order of the rest', () => {
    expect(connectIds(['a', undefined, 'b', '', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('returns the ids unchanged — validation rejects, it never rewrites', () => {
    expect(connectIds([' spaced-id '])).toEqual([' spaced-id ']);
  });

  it('reads an absent list as an empty one', () => {
    expect(connectIds(undefined)).toEqual([]);
  });

  it('leaves a wholly valid list alone', () => {
    expect(connectIds(['a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('assertConnectId — a scalar refuses instead of writing something it cannot mean', () => {
  it('returns the id unchanged', () => {
    expect(assertConnectId('b1', 'parentBoundary')).toBe('b1');
  });

  it.each([undefined, null, '', '  '])('refuses %s', (value) => {
    expect(() => assertConnectId(value, 'parentBoundary')).toThrow(UnresolvedIdError);
  });

  it('names the field it refused, so the failure says which relationship', () => {
    // The caller reverts on any throw, so the message is the only place the cause survives.
    expect(() => assertConnectId('', 'source')).toThrow(/"source"/);
  });
});
