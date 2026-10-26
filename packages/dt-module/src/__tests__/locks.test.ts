/** The write-lock clause: one fixed shape, and only for a plain variable name. */

import { describe, expect, it } from 'vitest';

import { writeLockClause } from '../locks';

describe('writeLockClause', () => {
  it('sets and removes the lock property on the variable', () => {
    expect(writeLockClause('r')).toBe('SET r._lock = true REMOVE r._lock');
    expect(writeLockClause('_model1')).toBe('SET _model1._lock = true REMOVE _model1._lock');
  });

  it.each([[''], ['1r'], ['r.x'], ['r SET x'], ['r`']])('refuses %j', (variable) => {
    expect(() => writeLockClause(variable)).toThrow(/invalid variable/);
  });
});
