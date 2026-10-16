import { Neo4jError } from 'neo4j-driver';
import { ConfigService } from '@nestjs/config';
import { SetInstantiationAttributesService } from '../set-instantiation-attributes.service';
import { ModuleRegistryService } from '../../module-management-services/module-registry.service';
import { AuthorizationService } from '../../services/authorization.service';
import { MonitoringService } from '../../services/monitoring.service';
import { ALL_REFERENCE_PAIRS, REFERENCE_LABELS, linkKey, linkKeyCypher } from '../shared/reference-resolution';

/**
 * A save keeps a SYSTEM finding the policy still emits, and its links follow the policy as
 * of that save: a link of the writer's own types and targets that the policy no longer
 * emits is deleted, a justification the policy dropped is cleared, and a dispositioned
 * finding whose link set changed is flagged for review. These pin the statements the
 * writer sends for it; the behaviour on a real graph is mitre-verb-edges.e2e-spec.
 */

const toRecord = (row: Record<string, unknown>) => ({ get: (key: string) => row[key] });
const SEP = '\u001f';

function makeService() {
  const service = new SetInstantiationAttributesService(
    { session: jest.fn() } as any,
    { get: jest.fn().mockReturnValue({}) } as unknown as ConfigService,
    { getModuleByName: jest.fn() } as unknown as ModuleRegistryService,
    { extractAuthContext: jest.fn() } as unknown as AuthorizationService,
    { recordOperation: jest.fn() } as unknown as MonitoringService,
  );
  for (const level of ['log', 'debug', 'warn', 'error'] as const) jest.spyOn((service as any).logger, level).mockImplementation(() => {});
  return service as any;
}

interface Call { query: string; params: any }

/**
 * A transaction that finds every reference, answers the read of the current links with
 * `before` (finding name → its link keys and whether it is flaggable), and records every
 * statement. `fail` makes the statement whose text contains its key throw.
 */
function recordingTx(before: Record<string, { keys: string[]; flaggable?: boolean }> = {}, fail?: { on: string; error: Error }) {
  const calls: Call[] = [];
  const tx = {
    run: jest.fn(async (query: string, params: any) => {
      calls.push({ query, params });
      if (fail && query.includes(fail.on)) throw fail.error;
      if (query.includes('pairIndex')) {
        const records = ALL_REFERENCE_PAIRS.flatMap((_pair, i) =>
          (params[`p${i}`] as string[]).map(value => toRecord({ pairIndex: i, value, found: true })),
        );
        return { records };
      }
      if (query.includes('instantiatedName')) return { records: [toRecord({ instantiatedName: params.attributes.name })] };
      if (query.includes('findingName')) {
        return {
          records: Object.entries(before)
            .filter(([name]) => params.names.includes(name))
            .map(([name, b]) => toRecord({ findingId: `id-${name}`, findingName: name, linkKeys: b.keys, flaggable: b.flaggable ?? false })),
        };
      }
      if (query.includes('prunedCount')) return { records: [toRecord({ prunedCount: 0 })] };
      if (query.includes('linkStaleFlipped')) return { records: [toRecord({ linkStaleFlipped: params.ids.length })] };
      return { records: [toRecord({ relationshipsCreated: { toNumber: () => 1 } })] };
    }),
  };
  return { tx, calls };
}

const ATTACK_TECHNIQUE = ALL_REFERENCE_PAIRS.find(p => p.label === 'MitreAttackTechnique')!;
const ATTACK_MITIGATION = ALL_REFERENCE_PAIRS.find(p => p.label === 'MitreAttackMitigation')!;
const DEFEND = ALL_REFERENCE_PAIRS.find(p => p.label === 'MitreDefendTechnique')!;

const read = (calls: Call[]) => calls.filter(c => c.query.includes('findingName'));
const prune = (calls: Call[]) => calls.filter(c => c.query.includes('prunedCount'));
const flip = (calls: Call[]) => calls.filter(c => c.query.includes('linkStaleFlipped'));
const links = (calls: Call[]) => calls.filter(c => c.query.includes('MERGE (e)-[rel:'));

describe('linkKey and its Cypher twin', () => {
  it('builds the Cypher key from the constant pairs only, with no property read by a computed name', () => {
    const cypher = linkKeyCypher('r', 't');
    for (const pair of ALL_REFERENCE_PAIRS) {
      expect(cypher).toContain(`WHEN t:${pair.label} THEN '${pair.label}|${pair.property}|' + toString(t.${pair.property})`);
    }
    expect(cypher.startsWith("type(r) + '|' + CASE ")).toBe(true);
    expect(cypher).not.toMatch(/t\[/);
    expect(linkKey('RESPONDS_WITH', DEFEND, 'D3-MFA')).toBe('RESPONDS_WITH|MitreDefendTechnique|d3fendId|D3-MFA');
    expect(REFERENCE_LABELS).toEqual(ALL_REFERENCE_PAIRS.map(p => p.label));
  });
});

describe('a save reconciles the links of the findings it writes', () => {
  it('countermeasures: reads before the upsert, prunes after the links, over the nine owned types', async () => {
    const service = makeService();
    const { tx, calls } = recordingTx();

    await service.upsertCountermeasuresInTx(tx, {
      componentId: 'ctl-1',
      classId: 'cc-1',
      countermeasures: [{ name: 'MFA', respondsWith: ['M1032', 'D3-MFA'], mitigates: ['T1078'] }],
    });

    const order = calls.map(c => c.query);
    const readAt = order.findIndex(q => q.includes('findingName'));
    const upsertAt = order.findIndex(q => q.includes('instantiatedName'));
    const lastLinkAt = order.map(q => q.includes('MERGE (e)-[rel:')).lastIndexOf(true);
    const pruneAt = order.findIndex(q => q.includes('prunedCount'));
    expect(readAt).toBeGreaterThan(-1);
    expect(readAt).toBeLessThan(upsertAt);
    expect(pruneAt).toBeGreaterThan(lastLinkAt);

    const [p] = prune(calls);
    // The types sit in the pattern, so the statement walks only the finding's own link edges.
    const owned =
      'RESPONDS_WITH|COUNTERMEASURE_MITIGATES|COUNTERMEASURE_PROTECTS_AGAINST|COUNTERMEASURE_DETECTS|COUNTERMEASURE_ISOLATES|' +
      'COUNTERMEASURE_DECEIVES|COUNTERMEASURE_EVICTS|COUNTERMEASURE_RESTORES|COUNTERMEASURE_RESPONDS_TO';
    expect(p.query).toContain(`MATCH (e)-[r:${owned}]->(t)`);
    expect(read(calls)[0].query).toContain(`OPTIONAL MATCH (e)-[r:${owned}]->(t)`);
    expect(p.params.targetLabels).toEqual(REFERENCE_LABELS);
    expect(p.params.names).toEqual(['MFA']);
    expect(p.params.separator).toBe(SEP);
    expect([...p.params.keep].sort()).toEqual(
      [
        `MFA${SEP}${linkKey('RESPONDS_WITH', ATTACK_MITIGATION, 'M1032')}`,
        `MFA${SEP}${linkKey('RESPONDS_WITH', DEFEND, 'D3-MFA')}`,
        `MFA${SEP}${linkKey('COUNTERMEASURE_MITIGATES', ATTACK_TECHNIQUE, 'T1078')}`,
      ].sort(),
    );
    // Scoped exactly like the link write: the element's own finding, bound to the class, SYSTEM or legacy null.
    for (const q of [...read(calls), p].map(c => c.query)) {
      expect(q).toMatch(/^\s*MATCH \(c \{id: \$elementId\}\)\s*WITH c\b/);
      expect(q).toContain('MATCH (c)-[:HAS_COUNTERMEASURE]->(e)-[:IS_EXPOSURE_OF|IS_COUNTERMEASURE_OF]->(klass)');
      expect(q).toContain('klass.id = $classId');
      expect(q).toContain("(e.createdBy = 'SYSTEM' OR e.createdBy IS NULL)");
      expect(q).toContain('WHERE any(l IN labels(t) WHERE l IN $targetLabels)');
      expect(q).not.toMatch(/\(e\)-\[r\]->/);
    }
    const pruneQuery = p.query.replace(/\s+/g, ' ');
    // Grouped per finding node and link, so a kept link stays once and its parallel copies go with the dropped links.
    expect(pruneQuery).toContain('WITH e, e.name + $separator + linkKey AS findingLinkKey, collect(r) AS rels');
    expect(pruneQuery).toContain('WITH CASE WHEN findingLinkKey IN $keep THEN tail(rels) ELSE rels END AS doomed UNWIND doomed AS r DELETE r');
    // A reference-labelled target without its key is never pruned, whatever the keep list holds.
    expect(pruneQuery).toContain('WHERE linkKey IS NOT NULL');
    expect(p.params.classId).toBe('cc-1');
  });

  it('exposures: the same over EXPLOITED_BY only', async () => {
    const service = makeService();
    const { tx, calls } = recordingTx();

    await service.upsertExposuresInTx(tx, {
      componentId: 'comp-1',
      classId: 'cls-1',
      exposures: [{ name: 'Weak auth', exploitedBy: ['T1110'] }],
    });

    const [p] = prune(calls);
    expect(p.query).toContain('MATCH (e)-[r:EXPLOITED_BY]->(t)');
    expect(p.params.keep).toEqual([`Weak auth${SEP}${linkKey('EXPLOITED_BY', ATTACK_TECHNIQUE, 'T1110')}`]);
    expect(p.query).toContain('MATCH (c)-[:HAS_EXPOSURE]->(e)-[:IS_EXPOSURE_OF|IS_COUNTERMEASURE_OF]->(klass)');
  });

  it('a finding whose references all stopped resolving keeps nothing: the prune runs with an empty keep list', async () => {
    const service = makeService();
    const { tx, calls } = recordingTx();
    tx.run.mockImplementationOnce(async (query: string, params: any) => {
      calls.push({ query, params });
      return { records: [] };
    });

    await service.upsertCountermeasuresInTx(tx, {
      componentId: 'ctl-1',
      classId: 'cc-1',
      countermeasures: [{ name: 'MFA', respondsWith: [], mitigates: [] }],
    });

    const [p] = prune(calls);
    expect(p.params.names).toEqual(['MFA']);
    expect(p.params.keep).toEqual([]);
  });

  it('sends no link statement at all for an upsert with no findings', async () => {
    const service = makeService();
    const { tx, calls } = recordingTx();
    const result = await service.upsertExposuresInTx(tx, { componentId: 'comp-1', classId: 'cls-1', exposures: [] });
    expect(read(calls)).toHaveLength(0);
    expect(prune(calls)).toHaveLength(0);
    expect(result).toEqual({ instantiated: [], unresolved: [], staleFlipped: 0 });
  });
});

describe('a justification the policy dropped is cleared', () => {
  it('sets every allowlisted edge key, null when the ref does not carry it', async () => {
    const service = makeService();
    const { tx, calls } = recordingTx();

    await service.upsertCountermeasuresInTx(tx, {
      componentId: 'ctl-1',
      classId: 'cc-1',
      countermeasures: [
        {
          name: 'MFA',
          mitigates: ['T1078', { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1110', attributes: { justification: 'stops guessing' } }],
        },
      ],
    });

    const [bare, justified] = links(calls);
    expect(bare.query).toContain('SET rel.justification = $edge.justification');
    expect(bare.query).not.toContain('+=');
    expect(bare.params.edge).toEqual({ justification: null });
    expect(justified.params.edge).toEqual({ justification: 'stops guessing' });
  });

  it('a target named twice is linked once, and the justified mention wins whatever the order', async () => {
    for (const order of ['bare-first', 'justified-first'] as const) {
      const service = makeService();
      const { tx, calls } = recordingTx();
      const bare = 'T1078';
      const justified = { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1078', attributes: { justification: 'why' } };

      await service.upsertCountermeasuresInTx(tx, {
        componentId: 'ctl-1',
        classId: 'cc-1',
        countermeasures: [{ name: 'MFA', mitigates: order === 'bare-first' ? [bare, justified] : [justified, bare] }],
      });

      expect(links(calls)).toHaveLength(1);
      expect(links(calls)[0].params.edge).toEqual({ justification: 'why' });
      expect(prune(calls)[0].params.keep).toEqual([`MFA${SEP}${linkKey('COUNTERMEASURE_MITIGATES', ATTACK_TECHNIQUE, 'T1078')}`]);
    }
  });

  it('an empty justification does not count as one: the first, bare mention stays', async () => {
    const service = makeService();
    const { tx, calls } = recordingTx();
    const empty = { label: 'MitreAttackTechnique', property: 'attack_id', value: 'T1078', attributes: { justification: '' } };
    await service.upsertCountermeasuresInTx(tx, { componentId: 'ctl-1', classId: 'cc-1', countermeasures: [{ name: 'MFA', mitigates: ['T1078', empty] }] });
    expect(links(calls)).toHaveLength(1);
    expect(links(calls)[0].params.edge).toEqual({ justification: null });
  });

  it('the same target under two link types is two links', async () => {
    const service = makeService();
    const { tx, calls } = recordingTx();
    await service.upsertCountermeasuresInTx(tx, {
      componentId: 'ctl-1',
      classId: 'cc-1',
      countermeasures: [{ name: 'MFA', mitigates: ['T1078'], detects: ['T1078'] }],
    });
    expect(links(calls).map(c => c.query.match(/MERGE \(e\)-\[rel:(\w+)\]/)![1])).toEqual(['COUNTERMEASURE_MITIGATES', 'COUNTERMEASURE_DETECTS']);
  });
});

describe('a dispositioned finding whose links changed is flagged for review', () => {
  const MFA_T1078 = linkKey('COUNTERMEASURE_MITIGATES', ATTACK_TECHNIQUE, 'T1078');
  const MFA_T1110 = linkKey('COUNTERMEASURE_DETECTS', ATTACK_TECHNIQUE, 'T1110');

  async function save(before: Record<string, { keys: string[]; flaggable?: boolean }>, cm: Record<string, unknown>) {
    const service = makeService();
    const { tx, calls } = recordingTx(before);
    const result = await service.upsertCountermeasuresInTx(tx, { componentId: 'ctl-1', classId: 'cc-1', countermeasures: [cm] });
    return { result, calls };
  }

  it('a dropped link flags it', async () => {
    const { result, calls } = await save({ MFA: { keys: [MFA_T1078, MFA_T1110], flaggable: true } }, { name: 'MFA', mitigates: ['T1078'] });
    expect(flip(calls)).toHaveLength(1);
    expect(flip(calls)[0].params.ids).toEqual(['id-MFA']);
    expect(flip(calls)[0].query).toContain('e.id IN $ids');
    expect(flip(calls)[0].query).toContain('e.dispositionKind IS NOT NULL AND coalesce(e.dispositionStale, false) = false');
    expect(flip(calls)[0].query).toContain('SET e.dispositionStale = true');
    expect(flip(calls)[0].query).toContain("(e.createdBy = 'SYSTEM' OR e.createdBy IS NULL)");
    expect(result.staleFlipped).toBe(1);
  });

  it('an added link flags it', async () => {
    const { result, calls } = await save({ MFA: { keys: [MFA_T1078], flaggable: true } }, { name: 'MFA', mitigates: ['T1078'], detects: ['T1110'] });
    expect(flip(calls)[0].params.ids).toEqual(['id-MFA']);
    expect(result.staleFlipped).toBe(1);
  });

  it('a swapped link of the same count flags it', async () => {
    const { calls } = await save({ MFA: { keys: [MFA_T1078], flaggable: true } }, { name: 'MFA', detects: ['T1110'] });
    expect(flip(calls)[0].params.ids).toEqual(['id-MFA']);
  });

  it('unchanged links flag nothing, and send no flip statement', async () => {
    const { result, calls } = await save({ MFA: { keys: [MFA_T1078], flaggable: true } }, { name: 'MFA', mitigates: ['T1078'] });
    expect(flip(calls)).toHaveLength(0);
    expect(result.staleFlipped).toBe(0);
  });

  it('a finding with no disposition, or one already flagged, is not flagged', async () => {
    const { calls } = await save({ MFA: { keys: [MFA_T1078, MFA_T1110], flaggable: false } }, { name: 'MFA', mitigates: ['T1078'] });
    expect(flip(calls)).toHaveLength(0);
  });

  it('two same-named findings (the upsert race) are compared one by one, and only the changed one is flagged', async () => {
    const service = makeService();
    const { tx, calls } = recordingTx();
    const base = tx.run.getMockImplementation()!;
    tx.run.mockImplementation(async (query: string, params: any) => {
      if (!query.includes('findingName')) return base(query, params);
      calls.push({ query, params });
      return {
        records: [
          toRecord({ findingId: 'cm-a', findingName: 'MFA', linkKeys: [], flaggable: true }),
          toRecord({ findingId: 'cm-b', findingName: 'MFA', linkKeys: [MFA_T1078], flaggable: true }),
        ],
      };
    });

    await service.upsertCountermeasuresInTx(tx, { componentId: 'ctl-1', classId: 'cc-1', countermeasures: [{ name: 'MFA', mitigates: ['T1078'] }] });

    expect(flip(calls)[0].params.ids).toEqual(['cm-a']);
  });

  it('a finding created by this save is not flagged', async () => {
    const { calls } = await save({}, { name: 'MFA', mitigates: ['T1078'] });
    expect(flip(calls)).toHaveLength(0);
  });

  it('setAttributes adds the link flips to the staleFlippedCount it returns', async () => {
    const service = makeService();
    service.neo4jDriver.session = jest.fn(() => ({
      executeWrite: jest.fn(async () => ({ moduleName: 'mod-1', componentType: 'Control', valueChanged: true, changedKeys: ['k'], staleFlippedCount: 2 })),
      close: jest.fn(async () => {}),
    }));
    service.moduleRegistry.getModuleByName = jest.fn(() => ({}));
    jest.spyOn(service, 'processControlCountermeasures').mockResolvedValue({ unresolved: [], staleFlipped: 3 });

    const result = await service.setAttributes({ componentId: 'ctl-1', classId: 'cc-1', attributes: { k: 'v' } });
    expect(result).toMatchObject({ success: true, staleFlippedCount: 5 });
  });

  it('an empty-attributes save on a Control re-evaluates its countermeasures, so the save alone reconciles their links', async () => {
    const service = makeService();
    const run = jest.fn(async () => ({ records: [toRecord({ moduleName: 'mod-1', type: 'Control', valueChanged: false, changedKeys: [] })] }));
    service.neo4jDriver.session = jest.fn(() => ({
      executeWrite: jest.fn(async (work: (t: unknown) => Promise<unknown>) => work({ run })),
      close: jest.fn(async () => {}),
    }));
    service.moduleRegistry.getModuleByName = jest.fn(() => ({}));
    const evaluate = jest.spyOn(service, 'processControlCountermeasures').mockResolvedValue({ unresolved: [], staleFlipped: 1 });

    const result = await service.setAttributes({ componentId: 'ctl-1', classId: 'cc-1', attributes: {} });

    expect(evaluate).toHaveBeenCalledWith(expect.anything(), 'ctl-1', 'cc-1', expect.anything(), expect.any(String), undefined);
    expect(result).toMatchObject({ success: true, staleFlippedCount: 1 });
  });

  it('upsertCountermeasures carries the link flips out of its transaction', async () => {
    const service = makeService();
    const { tx } = recordingTx({ MFA: { keys: [MFA_T1078, MFA_T1110], flaggable: true } });
    const session = { executeWrite: jest.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx)) };
    const result = await service.upsertCountermeasures(session, { componentId: 'ctl-1', classId: 'cc-1', countermeasures: [{ name: 'MFA', mitigates: ['T1078'] }] });
    expect(result).toMatchObject({ success: true, staleFlippedCount: 1 });
  });
});

describe('a failure in the reconcile fails the write', () => {
  it('a transient conflict reaches the transaction retry and is counted', async () => {
    const service = makeService();
    const conflict = new Neo4jError('Cannot resolve conflicting transactions.', 'Memgraph.TransientError.MemgraphError.MemgraphError', '50N42', 'error: general processing exception');
    for (const on of ['findingName', 'prunedCount', 'linkStaleFlipped']) {
      const { tx } = recordingTx({ X: { keys: [], flaggable: true } }, { on, error: conflict });
      const before = service.statistics.retriableConflicts;
      await expect(
        service.upsertExposuresInTx(tx, { componentId: 'comp-1', classId: 'cls-1', exposures: [{ name: 'X', exploitedBy: ['T1078'] }] }),
      ).rejects.toBe(conflict);
      expect(service.statistics.retriableConflicts).toBe(before + 1);
    }
  });

  it('any other error propagates, is not counted as a conflict, and the session-bound upsert reports a failed write', async () => {
    for (const on of ['findingName', 'prunedCount', 'linkStaleFlipped']) {
      const service = makeService();
      const boom = new Error('disk full');
      const { tx } = recordingTx({ X: { keys: [], flaggable: true } }, { on, error: boom });
      const session = { executeWrite: jest.fn(async (work: (t: unknown) => Promise<unknown>) => work(tx)) };
      const result = await service.upsertExposures(session, { componentId: 'comp-1', classId: 'cls-1', exposures: [{ name: 'X', exploitedBy: ['T1078'] }] });
      expect(result.success).toBe(false);
      expect(service.statistics.retriableConflicts).toBe(0);
    }
  });
});

describe('deleteObsoleteFindingsInTx (the binding path\'s cleanup)', () => {
  it('returns how many findings it deleted', async () => {
    const service = makeService();
    const tx = { run: jest.fn(async () => ({ records: [toRecord({ deletedCount: { toNumber: () => 2 } })] })) };
    await expect(
      service.deleteObsoleteFindingsInTx(tx, { elementId: 'ctl-1', relation: 'HAS_COUNTERMEASURE', validNames: ['MFA'], classId: 'cc-1' }),
    ).resolves.toBe(2);
  });

  it('throws when the delete fails, so the binding transaction rolls back', async () => {
    const service = makeService();
    const tx = { run: jest.fn(async () => { throw new Error('boom'); }) };
    await expect(
      service.deleteObsoleteFindingsInTx(tx, { elementId: 'ctl-1', relation: 'HAS_COUNTERMEASURE', validNames: ['MFA'], classId: 'cc-1' }),
    ).rejects.toThrow('Failed to delete obsolete findings');
  });
});
