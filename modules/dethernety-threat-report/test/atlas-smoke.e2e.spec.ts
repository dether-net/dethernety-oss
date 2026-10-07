// gradedCoverage and the report's coverage view on a model whose findings carry MITRE ATLAS links.
//
// ATLAS links reuse the ATT&CK edge types, and coverage reads ATT&CK only. This spec runs the
// coverage module's real queries on the shared ATLAS smoke fixture twice, as seeded and with every
// MitreAtlas* node removed, and requires the same result both times: the ATLAS-only exposure is an
// unmapped ("soft") exposure, the mixed exposure counts only its ATT&CK technique, and no ATLAS id,
// tactic or countermeasure appears anywhere in the coverage facts or the matrix built from them.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import DethernetyCoverageToolsModule from '../../dethernety-coverage-tools/src/DethernetyCoverageToolsModule';
// @ts-expect-error -- plain JS frontend module without type declarations
import { buildCoverageView } from '../frontend/lib/coverageMatrix.js';

const SEED = new URL('../../dethernety-coverage-tools/__tests__/fixtures/atlas-smoke/seed.cypher', import.meta.url);
const MODEL_ID = 'model-atlas-smoke';
const logger = { log() {}, warn() {}, error() {}, debug() {}, verbose() {} };

const statements = readFileSync(SEED, 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean);

describe('coverage on the ATLAS smoke fixture (Memgraph)', () => {
  let mg: MemgraphHandle;

  const run = async (cypher: string) => {
    const session = mg.driver.session();
    try {
      await session.run(cypher);
    } finally {
      await session.close();
    }
  };

  const seed = async (withAtlas: boolean) => {
    await clearGraph(mg.driver);
    for (const statement of statements) await run(statement);
    if (!withAtlas) {
      await run(`MATCH (n) WHERE any(l IN labels(n) WHERE l STARTS WITH 'MitreAtlas') DETACH DELETE n`);
    }
  };

  const coverage = async () => {
    const module = new DethernetyCoverageToolsModule(mg.driver, logger as any);
    const result = await (module as any).computeGradedCoverage(MODEL_ID);
    delete result.generatedAt;
    return result;
  };

  beforeAll(async () => {
    mg = await startMemgraph();
  });

  afterAll(async () => {
    await mg?.stop();
  });

  it('skips ATLAS links: the result equals the result without any ATLAS node', async () => {
    await seed(true);
    const withAtlas = await coverage();
    await seed(false);
    const withoutAtlas = await coverage();

    expect(withAtlas).toEqual(withoutAtlas);

    const byId = Object.fromEntries(withAtlas.exposures.map((e: any) => [e.exposureId, e]));
    expect(byId['exp-atlas-only']).toMatchObject({ soft: true, techniques: [] });
    expect(byId['exp-mixed'].soft).toBe(false);
    expect(byId['exp-mixed'].techniques.map((t: any) => t.techniqueId)).toEqual(['T9101']);
    expect(byId['exp-mixed'].techniques[0].tactics).toEqual([{ id: 'TA0001', name: 'Initial Access', order: 2 }]);

    const text = JSON.stringify(withAtlas);
    for (const atlasValue of ['AML.', 'AI Model Access', 'cm-atlas', 'Prompt Filtering']) {
      expect(text).not.toContain(atlasValue);
    }
  });

  it('the report matrix shows the ATLAS-only exposure as unmapped and no ATLAS column', async () => {
    await seed(true);
    const ledger = [
      {
        id: 'c-api',
        name: 'Model Serving API',
        findings: [
          { id: 'exp-atlas-only', dispositionKind: null },
          { id: 'exp-mixed', dispositionKind: null },
        ],
      },
    ];
    const view = buildCoverageView(await coverage(), ledger);
    await seed(false);
    const viewWithout = buildCoverageView(await coverage(), ledger);

    expect(view).toEqual(viewWithout);
    expect(view.available).toBe(true);
    expect(view.offGrid.softCount).toBe(1);
    const text = JSON.stringify(view);
    expect(text).not.toContain('AML.');
    expect(text).not.toContain('AI Model Access');
  });
});
