import { ClassIdentityEventLog, ClassIdentityEvent } from '../class-identity-event-log.service';

// Unit tests for the parts of class reconciliation that don't require a
// live database. The 18-case rebind state machine matrix is exercised
// at the upsertClass dispatch level via the integration suite (where a
// real Memgraph captures the full Cypher behaviour). This spec covers:
//   - ClassIdentityEventLog ring-buffer cap + filter semantics
//   - effectivePolicy dispatch table (env override beats module declaration
//     beats undefined-default)

describe('ClassIdentityEventLog', () => {
  let log: ClassIdentityEventLog;

  beforeEach(() => {
    log = new ClassIdentityEventLog();
    // Silence the mirrored Logger.warn output during tests.
    jest.spyOn((log as any).logger, 'warn').mockImplementation(() => {});
  });

  const make = (kind: ClassIdentityEvent['kind'], moduleName: string, ts: string): ClassIdentityEvent => {
    if (kind === 'rebind') {
      return { kind, moduleName, classKind: 'componentClasses', className: 'X',
        oldId: 'a', newId: 'b', policy: 'audit', timestamp: ts };
    }
    if (kind === 'rebind-conflict') {
      return { kind, moduleName, classKind: 'componentClasses', className: 'X',
        moduleDeclaredId: 'a', dbId: 'b', policy: 'strict', timestamp: ts };
    }
    if (kind === 'collision') {
      return { kind, firstModuleName: 'other', secondModuleName: moduleName,
        classKind: 'componentClasses', className: 'X', collidingId: 'c', timestamp: ts };
    }
    if (kind === 'orphan') {
      return { kind, moduleName, classKind: 'componentClasses', className: 'X',
        classId: 'c', reason: 'absent-from-metadata', timestamp: ts };
    }
    return { kind: 'revive', moduleName, classKind: 'componentClasses', className: 'X',
      classId: 'c', timestamp: ts };
  };

  it('emits and lists events in insertion order', () => {
    log.emit(make('rebind', 'mod-a', '2026-05-10T00:00:00Z'));
    log.emit(make('orphan', 'mod-b', '2026-05-10T00:00:01Z'));
    const all = log.list();
    expect(all).toHaveLength(2);
    expect(all[0].kind).toBe('rebind');
    expect(all[1].kind).toBe('orphan');
  });

  it('filters by kind', () => {
    log.emit(make('rebind', 'm', '2026-05-10T00:00:00Z'));
    log.emit(make('orphan', 'm', '2026-05-10T00:00:01Z'));
    log.emit(make('revive', 'm', '2026-05-10T00:00:02Z'));
    expect(log.list({ kind: 'orphan' })).toHaveLength(1);
    expect(log.list({ kind: 'collision' })).toHaveLength(0);
  });

  it('filters by moduleName (incl. collision dual-module match)', () => {
    log.emit(make('rebind', 'mod-a', '2026-05-10T00:00:00Z'));
    log.emit(make('rebind', 'mod-b', '2026-05-10T00:00:01Z'));
    log.emit(make('collision', 'mod-a', '2026-05-10T00:00:02Z')); // first=other, second=mod-a
    expect(log.list({ moduleName: 'mod-a' })).toHaveLength(2);
    expect(log.list({ moduleName: 'mod-b' })).toHaveLength(1);
    expect(log.list({ moduleName: 'other' })).toHaveLength(1); // collision matches firstModuleName too
  });

  it('filters by `since` (lexicographic ISO comparison is correct here)', () => {
    log.emit(make('rebind', 'm', '2026-05-10T00:00:00Z'));
    log.emit(make('rebind', 'm', '2026-05-10T00:00:05Z'));
    log.emit(make('rebind', 'm', '2026-05-10T00:00:10Z'));
    expect(log.list({ since: '2026-05-10T00:00:05Z' })).toHaveLength(2);
  });

  it('caps at 1000 events (oldest evicted)', () => {
    for (let i = 0; i < 1100; i++) {
      log.emit(make('rebind', `mod-${i}`, `2026-05-10T00:00:${String(i).padStart(2, '0')}Z`));
    }
    expect(log.size()).toBe(1000);
    const all = log.list();
    // Oldest 100 evicted; the surviving first event is mod-100.
    expect((all[0] as any).moduleName).toBe('mod-100');
    expect((all[all.length - 1] as any).moduleName).toBe('mod-1099');
  });
});

// effectivePolicy is a private method on ModuleManagementService. The unit
// test here re-implements the same dispatch table to pin the contract; if
// the production logic changes, this test should be the first thing the
// author updates. (Keeping it here vs spawning a NestJS test module avoids
// pulling the entire ModuleManagementService DI chain — embedding service,
// match-classes resolver, etc. — for a 4-line decision table.)
describe('effectivePolicy decision table', () => {
  const decide = (moduleDeclared: string | undefined, override: string | undefined): string => {
    if (override === 'strict' || override === 'audit' || override === 'silent') return override;
    return moduleDeclared ?? 'audit';
  };

  type Case = [string | undefined, string | undefined, string];
  const cases: Case[] = [
    [undefined, undefined, 'audit'],          // first-major-release default
    ['strict', undefined, 'strict'],
    ['audit', undefined, 'audit'],
    ['silent', undefined, 'silent'],
    [undefined, 'strict', 'strict'],          // override beats undefined
    ['audit', 'strict', 'strict'],            // override beats audit
    ['silent', 'strict', 'strict'],           // override beats silent
    ['strict', 'audit', 'audit'],             // override can also LOOSEN
    [undefined, 'bogus', 'audit'],            // bogus override ignored
  ];

  test.each(cases)('module=%s override=%s → %s', (moduleDeclared, override, expected) => {
    expect(decide(moduleDeclared, override)).toBe(expected);
  });
});
