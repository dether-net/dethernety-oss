// Integration coverage for MatchMitreTechniquesResolverService.
//
// Strategy: instantiate the service directly against a real Memgraph
// testcontainer with stub Config/Auth/Monitoring + a DI-stub
// EmbeddingService whose embedBatch returns a controllable vector. Seed
// MITRE fixture nodes (ATT&CK techniques, D3FEND techniques, mitigations)
// directly via Cypher CREATE — embeddings included where needed.
//
// Covers invariants MI-1 through MI-8 plus: case-insensitive
// EXACT_ID, PREFIX_ID gate on short queries, NAME_MATCH happy path,
// DESCRIPTION_MATCH, no raw-vector leakage, deterministic multi-tactic
// resolution, NO_VECTORS empty + partial, topN clamping, kind switching,
// task-prefix presence, corpus cache hit, MAX_QUERIES + MAX_QUERY_LENGTH.

import { ConfigService } from '@nestjs/config';
import { startMemgraph, clearGraph, MemgraphHandle } from './memgraph-container';
import { MatchMitreTechniquesResolverService } from '../../src/gql/resolver-services/match-mitre-techniques-resolver.service';

jest.setTimeout(120_000);

const RUNTIME_MODEL = 'embeddinggemma';
const DIMENSIONS = 768;
const THRESHOLD = 0.75;

// Match vector: only T2000 carries this vector → cos similarity 1.0 on it,
// 0.0 against any orthogonal vector → it is the unique vector-tier hit.
const V_MATCH = makeUnitVector(0);
const V_OTHER = makeUnitVector(1);

function makeUnitVector(i: number): number[] {
  const v = new Array(DIMENSIONS).fill(0);
  v[i] = 1;
  return v;
}

function makeStubConfigService(): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'database.name') return 'memgraph';
      return undefined;
    },
  } as unknown as ConfigService;
}

function makeStubAuthService(): any {
  return {
    extractAuthContext: (ctx: any) => ({ user: ctx?.user, token: ctx?.token }),
    checkAuthorization: async () => ({ allowed: true }),
  };
}

function makeStubMonitoringService(): any {
  return { recordOperation: () => {} };
}

class StubEmbeddingService {
  private enabled = true;
  private model = RUNTIME_MODEL;
  private fixedVector: number[] = V_MATCH;
  public lastEmbedInput: string[] | null = null;
  public embedBatchCallCount = 0;

  setEnabled(v: boolean) {
    this.enabled = v;
  }
  setModel(m: string) {
    this.model = m;
  }
  setFixedVector(v: number[]) {
    this.fixedVector = v;
  }
  reset() {
    this.enabled = true;
    this.model = RUNTIME_MODEL;
    this.fixedVector = V_MATCH;
    this.lastEmbedInput = null;
    this.embedBatchCallCount = 0;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
  getModel(): string {
    return this.model;
  }
  getDimensions(): number {
    return DIMENSIONS;
  }
  getThreshold(): number {
    return THRESHOLD;
  }
  disableForSession(): void {
    this.enabled = false;
  }
  async embedBatch(texts: string[]): Promise<number[][] | null> {
    this.embedBatchCallCount += 1;
    this.lastEmbedInput = texts;
    if (!this.enabled) return null;
    return texts.map(() => this.fixedVector);
  }
}

async function runWrite(driver: any, cypher: string, params: any = {}): Promise<any> {
  const session = driver.session();
  try {
    return await session.run(cypher, params);
  } finally {
    await session.close();
  }
}

interface TechniqueSeed {
  attackId: string;
  name: string;
  description: string;
  tactics?: string[]; // ATT&CK tactic shortnames; node-side merge keys
  embedding?: number[];
  embeddingModel?: string;
}

interface DefendTechniqueSeed {
  d3fendId: string;
  name: string;
  description: string;
  tacticUri?: string;
  tacticName?: string;
  embedding?: number[];
  embeddingModel?: string;
}

interface MitigationSeed {
  attackId: string;
  name: string;
  description: string;
  embedding?: number[];
  embeddingModel?: string;
}

async function seedAttackTactic(
  driver: any,
  attackId: string,
  name: string,
): Promise<void> {
  await runWrite(
    driver,
    `CREATE (:MitreAttackTactic { id: $id, attack_id: $attackId, name: $name })`,
    { id: `tac-${attackId}`, attackId, name },
  );
}

async function seedTechnique(driver: any, t: TechniqueSeed): Promise<void> {
  const props: any = {
    id: `tech-${t.attackId}`,
    attackId: t.attackId,
    name: t.name,
    description: t.description,
  };
  if (t.embedding) props.embedding = t.embedding;
  if (t.embeddingModel) props.embeddingModel = t.embeddingModel;

  let setClause = 'SET n.id = $id, n.name = $name, n.description = $description';
  if (t.embedding) setClause += ', n.embedding = $embedding';
  if (t.embeddingModel) setClause += ', n.embeddingModel = $embeddingModel';

  await runWrite(
    driver,
    `CREATE (n:MitreAttackTechnique { attack_id: $attackId }) ${setClause}`,
    props,
  );

  for (const tacShortname of t.tactics ?? []) {
    await runWrite(
      driver,
      `MATCH (tac:MitreAttackTactic { attack_id: $tacId })
       MATCH (tech:MitreAttackTechnique { attack_id: $techId })
       MERGE (tac)-[:TACTIC_INCLUDES_TECHNIQUE]->(tech)`,
      { tacId: tacShortname, techId: t.attackId },
    );
  }
}

async function seedDefendTactic(
  driver: any,
  uri: string,
  name: string,
): Promise<void> {
  await runWrite(
    driver,
    `CREATE (:MitreDefendTactic { id: $id, uri: $uri, name: $name })`,
    { id: `dtac-${name}`, uri, name },
  );
}

async function seedDefendTechnique(
  driver: any,
  t: DefendTechniqueSeed,
): Promise<void> {
  const props: any = {
    id: `dtech-${t.d3fendId}`,
    d3fendId: t.d3fendId,
    name: t.name,
    description: t.description,
  };
  if (t.embedding) props.embedding = t.embedding;
  if (t.embeddingModel) props.embeddingModel = t.embeddingModel;

  let setClause = 'SET n.id = $id, n.name = $name, n.description = $description';
  if (t.embedding) setClause += ', n.embedding = $embedding';
  if (t.embeddingModel) setClause += ', n.embeddingModel = $embeddingModel';

  await runWrite(
    driver,
    `CREATE (n:MitreDefendTechnique { d3fendId: $d3fendId }) ${setClause}`,
    props,
  );

  if (t.tacticUri) {
    await runWrite(
      driver,
      `MATCH (tac:MitreDefendTactic { uri: $tacUri })
       MATCH (tech:MitreDefendTechnique { d3fendId: $d3fendId })
       MERGE (tech)-[:ENABLES]->(tac)`,
      { tacUri: t.tacticUri, d3fendId: t.d3fendId },
    );
  }
}

async function seedMitigation(driver: any, m: MitigationSeed): Promise<void> {
  const props: any = {
    id: `mit-${m.attackId}`,
    attackId: m.attackId,
    name: m.name,
    description: m.description,
  };
  if (m.embedding) props.embedding = m.embedding;
  if (m.embeddingModel) props.embeddingModel = m.embeddingModel;

  let setClause = 'SET n.id = $id, n.name = $name, n.description = $description';
  if (m.embedding) setClause += ', n.embedding = $embedding';
  if (m.embeddingModel) setClause += ', n.embeddingModel = $embeddingModel';

  await runWrite(
    driver,
    `CREATE (n:MitreAttackMitigation { attack_id: $attackId }) ${setClause}`,
    props,
  );
}

async function seedBaseFixture(
  driver: any,
  opts: { withEmbeddings?: boolean; embeddingModel?: string } = {},
): Promise<void> {
  const embedModel = opts.embeddingModel ?? RUNTIME_MODEL;
  const e = (vec?: number[]) =>
    opts.withEmbeddings
      ? { embedding: vec ?? V_OTHER, embeddingModel: embedModel }
      : {};

  // Tactics — used by the deterministic-tactic test.
  await seedAttackTactic(driver, 'TA0001', 'Initial Access');
  await seedAttackTactic(driver, 'TA0005', 'Defense Evasion');
  await seedAttackTactic(driver, 'TA0006', 'Credential Access');

  // Techniques.
  await seedTechnique(driver, {
    attackId: 'T1003',
    name: 'OS Credential Dumping',
    description:
      'Adversaries may attempt to dump credentials to obtain account login and credential material.',
    tactics: ['TA0006'],
    ...e(),
  });
  await seedTechnique(driver, {
    attackId: 'T1003.001',
    name: 'LSASS Memory',
    description:
      'Adversaries may attempt to access credential material stored in process memory of LSASS.',
    tactics: ['TA0006'],
    ...e(),
  });
  await seedTechnique(driver, {
    attackId: 'T1003.002',
    name: 'Security Account Manager',
    description: 'Adversaries may attempt to extract credential material from the SAM database.',
    tactics: ['TA0006'],
    ...e(),
  });
  await seedTechnique(driver, {
    attackId: 'T1078',
    name: 'Valid Accounts',
    description:
      'Adversaries may obtain and abuse credentials of existing accounts to bypass defenses.',
    tactics: ['TA0001', 'TA0005'], // multi-tactic; tactic[0] alphabetically = Defense Evasion
    ...e(),
  });
  // T2000 carries the V_MATCH vector for the vector-tier happy path.
  await seedTechnique(driver, {
    attackId: 'T2000',
    name: 'Process Injection',
    description: 'Generic exploitation technique unrelated to credentials.',
    ...(opts.withEmbeddings
      ? { embedding: V_MATCH, embeddingModel: embedModel }
      : {}),
  });
  await seedTechnique(driver, {
    attackId: 'T9999',
    name: 'Bare Marker Technique',
    description: 'A bare marker for tests; unrelated to anything else.',
    ...e(),
  });

  // D3FEND tactics + techniques.
  await seedDefendTactic(
    driver,
    'http://d3fend.mitre.org/ontologies/d3fend.owl#Detect',
    'Detect',
  );
  await seedDefendTactic(
    driver,
    'http://d3fend.mitre.org/ontologies/d3fend.owl#Harden',
    'Harden',
  );
  await seedDefendTechnique(driver, {
    d3fendId: 'D3-PMAD',
    name: 'Protocol Metadata Anomaly Detection',
    description: 'Identifying anomalies in protocol metadata.',
    tacticUri: 'http://d3fend.mitre.org/ontologies/d3fend.owl#Detect',
    ...e(),
  });
  await seedDefendTechnique(driver, {
    d3fendId: 'D3-WSAA',
    name: 'Web Session Activity Analysis',
    description: 'Analyzing web session activity for anomalous behavior.',
    tacticUri: 'http://d3fend.mitre.org/ontologies/d3fend.owl#Detect',
    ...e(),
  });
  await seedDefendTechnique(driver, {
    d3fendId: 'D3-EAL',
    name: 'Email Allowlisting',
    description: 'Allowlisting trusted email senders.',
    tacticUri: 'http://d3fend.mitre.org/ontologies/d3fend.owl#Harden',
    ...e(),
  });

  // Mitigations.
  await seedMitigation(driver, {
    attackId: 'M1041',
    name: 'Encrypt Sensitive Information',
    description: 'Protect sensitive data at rest and in transit.',
    ...e(),
  });
  await seedMitigation(driver, {
    attackId: 'M1003',
    name: 'Credential Hardening Mitigation',
    description: 'Harden credential storage and protect against dumping.',
    ...e(),
  });
  await seedMitigation(driver, {
    attackId: 'M1042',
    name: 'Disable or Remove Feature or Program',
    description: 'Reduce attack surface by removing unused features.',
    ...e(),
  });
}

describe('MatchMitreTechniquesResolverService (e2e)', () => {
  let mg: MemgraphHandle;
  let stubEmbedding: StubEmbeddingService;
  let svc: MatchMitreTechniquesResolverService;

  beforeAll(async () => {
    mg = await startMemgraph();
  }, 90_000);

  afterAll(async () => {
    if (mg) await mg.stop();
  });

  beforeEach(async () => {
    await clearGraph(mg.driver);
    stubEmbedding = new StubEmbeddingService();
    svc = new MatchMitreTechniquesResolverService(
      mg.driver,
      makeStubConfigService(),
      makeStubAuthService(),
      makeStubMonitoringService(),
      stubEmbedding as any,
    );
  });

  async function runQuery(input: {
    queries: { query: string }[];
    kind: 'ATTACK_TECHNIQUE' | 'DEFEND_TECHNIQUE' | 'ATTACK_MITIGATION';
    topN?: number;
  }) {
    const resolvers = svc.getResolvers();
    return await resolvers.Query.matchMitreTechniques(
      null,
      { input },
      { user: { sub: 'auth0|test' } },
    );
  }

  // ===== Deterministic tiers =====

  it('MI-1: EXACT_ID returns the technique and only that tier', async () => {
    await seedBaseFixture(mg.driver);
    const out = await runQuery({
      queries: [{ query: 'T1003' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].query).toBe('T1003');
    expect(out.matches[0].candidates).toHaveLength(1);
    expect(out.matches[0].candidates[0].mitreId).toBe('T1003');
    expect(out.matches[0].candidates[0].matchType).toBe('EXACT_ID');
    expect(out.matches[0].candidates[0].similarityScore).toBeNull();
    // Sub-techniques of T1003 must NOT leak into the EXACT_ID tier.
    expect(out.matches[0].candidates.every((c: any) => c.mitreId === 'T1003')).toBe(true);
    expect(out.unmatched).toHaveLength(0);
  });

  it('MI-1b: EXACT_ID is case-insensitive', async () => {
    await seedBaseFixture(mg.driver);
    const out = await runQuery({
      queries: [{ query: 't1003' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    expect(out.matches[0].candidates[0].mitreId).toBe('T1003');
    expect(out.matches[0].candidates[0].matchType).toBe('EXACT_ID');
  });

  it('MI-2a: PREFIX_ID covers the T100x family (T100 is prefix, not exact)', async () => {
    await seedBaseFixture(mg.driver);
    const out = await runQuery({
      queries: [{ query: 'T100' }],
      kind: 'ATTACK_TECHNIQUE',
      topN: 10,
    });
    expect(out.matches).toHaveLength(1);
    const ids = out.matches[0].candidates.map((c: any) => c.mitreId).sort();
    // T100 is a prefix of T1003, T1003.001, T1003.002 and (lexicographically)
    // also of T1078 (since T100 < T1078 alphabetically); but startsWith is
    // character-level, so only T1003-family + T1003.001/.002 qualify.
    expect(ids).toEqual(['T1003', 'T1003.001', 'T1003.002']);
    expect(out.matches[0].candidates.every((c: any) => c.matchType === 'PREFIX_ID')).toBe(
      true,
    );
  });

  it('MI-2b: short query (length 2) still triggers PREFIX_ID but skips NAME/DESCRIPTION', async () => {
    await seedBaseFixture(mg.driver);
    const out = await runQuery({
      queries: [{ query: 'T1' }],
      kind: 'ATTACK_TECHNIQUE',
      topN: 10,
    });
    expect(out.matches).toHaveLength(1);
    // All five T1xxx ids should be picked up by PREFIX_ID.
    expect(out.matches[0].candidates.every((c: any) => c.matchType === 'PREFIX_ID')).toBe(
      true,
    );
    const ids = out.matches[0].candidates.map((c: any) => c.mitreId).sort();
    expect(ids).toEqual(['T1003', 'T1003.001', 'T1003.002', 'T1078']);
  });

  it('short query that does not match any id falls through to unmatched (NAME/DESCRIPTION skipped)', async () => {
    await seedBaseFixture(mg.driver);
    const out = await runQuery({
      queries: [{ query: 'xy' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    expect(out.matches).toHaveLength(0);
    expect(out.unmatched).toEqual(['xy']);
  });

  it('NAME_MATCH: substring match against the name field', async () => {
    await seedBaseFixture(mg.driver);
    const out = await runQuery({
      queries: [{ query: 'Credential' }],
      kind: 'ATTACK_TECHNIQUE',
      topN: 10,
    });
    expect(out.matches).toHaveLength(1);
    // T1003 (OS Credential Dumping) is the only fixture with "Credential" in the name.
    const ids = out.matches[0].candidates.map((c: any) => c.mitreId).sort();
    expect(ids).toEqual(['T1003']);
    expect(out.matches[0].candidates[0].matchType).toBe('NAME_MATCH');
  });

  it('DESCRIPTION_MATCH: substring match against description only', async () => {
    await seedBaseFixture(mg.driver);
    // "obtain account login" appears in T1003's description verbatim; no name
    // contains this substring, so no earlier tier (EXACT / PREFIX / NAME)
    // can fire — the resolver must fall through to DESCRIPTION_MATCH.
    const out = await runQuery({
      queries: [{ query: 'obtain account login' }],
      kind: 'ATTACK_TECHNIQUE',
      topN: 10,
    });
    expect(out.matches).toHaveLength(1);
    expect(
      out.matches[0].candidates.every((c: any) => c.matchType === 'DESCRIPTION_MATCH'),
    ).toBe(true);
    const ids = out.matches[0].candidates.map((c: any) => c.mitreId);
    expect(ids).toContain('T1003');
  });

  // ===== Vector tier =====

  it('MI-3: VECTOR_SIMILARITY returns matches above threshold when corpus is healthy', async () => {
    await seedBaseFixture(mg.driver, { withEmbeddings: true });
    stubEmbedding.setFixedVector(V_MATCH);

    // Query has no id/name/description hits → falls through to vector tier.
    const out = await runQuery({
      queries: [{ query: 'completely unrelated semantic query xyzzy' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    expect(out.vectorAvailable).toBe(true);
    expect(out.vectorDisabledReason).toBeNull();
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].candidates).toHaveLength(1);
    expect(out.matches[0].candidates[0].mitreId).toBe('T2000');
    expect(out.matches[0].candidates[0].matchType).toBe('VECTOR_SIMILARITY');
    expect(out.matches[0].candidates[0].similarityScore).toBeGreaterThan(THRESHOLD);
  });

  it('vector index is created with the dimension+metric config (no rejected HNSW keys)', async () => {
    await seedBaseFixture(mg.driver, { withEmbeddings: true });
    stubEmbedding.setFixedVector(V_MATCH);

    // Reaching the vector tier runs ensureMitreVectorIndexes → CREATE VECTOR
    // INDEX. A vectorAvailable:true result already proves the DDL succeeded;
    // this additionally pins the index's stored config.
    const out = await runQuery({
      queries: [{ query: 'completely unrelated semantic query xyzzy' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    expect(out.vectorAvailable).toBe(true);

    // Memgraph 3.8 silently ignores non-schema HNSW keys (m / ef_construction),
    // so the DDL deliberately sends only dimension/capacity/metric — assert the
    // config we DO send is honoured on the created index.
    const info = await runWrite(
      mg.driver,
      `CALL vector_search.show_index_info()
       YIELD index_name, dimension, metric
       RETURN index_name AS name, dimension AS dimension, metric AS metric`,
    );
    const row = (info.records as any[]).find(
      r => r.get('name') === 'mitre_attack_technique_embeddings',
    );
    expect(row).toBeDefined();
    const dim = row.get('dimension');
    expect(typeof dim?.toNumber === 'function' ? dim.toNumber() : Number(dim)).toBe(
      DIMENSIONS,
    );
    expect(row.get('metric')).toBe('cos');
  });

  it('MI-4: EMBEDDING_DISABLED — vectorAvailable: false, vector tier skipped', async () => {
    await seedBaseFixture(mg.driver, { withEmbeddings: true });
    stubEmbedding.setEnabled(false);

    const out = await runQuery({
      queries: [{ query: 'completely unrelated semantic query xyzzy' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    expect(out.vectorAvailable).toBe(false);
    expect(out.vectorDisabledReason).toBe('EMBEDDING_DISABLED');
    expect(out.matches).toHaveLength(0);
    expect(out.unmatched).toEqual(['completely unrelated semantic query xyzzy']);
  });

  it('MI-5: MODEL_MISMATCH — fixture embeddingModel differs from runtime model', async () => {
    await seedBaseFixture(mg.driver, {
      withEmbeddings: true,
      embeddingModel: 'other-model-v2',
    });

    const out = await runQuery({
      queries: [{ query: 'completely unrelated semantic query xyzzy' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    expect(out.vectorAvailable).toBe(false);
    expect(out.vectorDisabledReason).toBe('MODEL_MISMATCH');
    expect(out.matches).toHaveLength(0);
  });

  it('MI-8: NO_VECTORS partial — half the nodes have embeddingModel, half do not', async () => {
    // Seed without embeddings, then add embeddings only to T1003 + T2000.
    await seedBaseFixture(mg.driver);
    await runWrite(
      mg.driver,
      `MATCH (n:MitreAttackTechnique { attack_id: 'T1003' })
       SET n.embedding = $embedding, n.embeddingModel = $model`,
      { embedding: V_OTHER, model: RUNTIME_MODEL },
    );
    await runWrite(
      mg.driver,
      `MATCH (n:MitreAttackTechnique { attack_id: 'T2000' })
       SET n.embedding = $embedding, n.embeddingModel = $model`,
      { embedding: V_MATCH, model: RUNTIME_MODEL },
    );

    const out = await runQuery({
      queries: [{ query: 'completely unrelated semantic query xyzzy' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    expect(out.vectorAvailable).toBe(false);
    expect(out.vectorDisabledReason).toBe('NO_VECTORS');
  });

  it('NO_VECTORS empty — corpus has no embeddings at all', async () => {
    await seedBaseFixture(mg.driver);
    const out = await runQuery({
      queries: [{ query: 'completely unrelated semantic query xyzzy' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    expect(out.vectorAvailable).toBe(false);
    expect(out.vectorDisabledReason).toBe('NO_VECTORS');
  });

  it('MI-6: vector tier response carries no raw embedding field on MitreCandidate', async () => {
    await seedBaseFixture(mg.driver, { withEmbeddings: true });
    stubEmbedding.setFixedVector(V_MATCH);

    const out = await runQuery({
      queries: [{ query: 'completely unrelated semantic query xyzzy' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    expect(out.matches[0].candidates[0].matchType).toBe('VECTOR_SIMILARITY');
    expect((out.matches[0].candidates[0] as any).embedding).toBeUndefined();
    expect(Object.keys(out.matches[0].candidates[0]).sort()).toEqual(
      [
        'description',
        'kind',
        'matchType',
        'mitreId',
        'name',
        'similarityScore',
        'tactic',
      ].sort(),
    );
  });

  it('MI-7: multi-tactic technique returns the same tactic deterministically across runs', async () => {
    await seedBaseFixture(mg.driver);

    const tactics: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      // Create a fresh service per call so we get a fresh corpus cache —
      // otherwise the second/third calls hit the cached `tactic` from the
      // first read.
      const fresh = new MatchMitreTechniquesResolverService(
        mg.driver,
        makeStubConfigService(),
        makeStubAuthService(),
        makeStubMonitoringService(),
        new StubEmbeddingService() as any,
      );
      const r = await fresh.getResolvers().Query.matchMitreTechniques(
        null,
        { input: { queries: [{ query: 'T1078' }], kind: 'ATTACK_TECHNIQUE' } },
        { user: { sub: 'auth0|test' } },
      );
      tactics.push(r.matches[0].candidates[0].tactic);
    }
    // All three reads must agree.
    expect(new Set(tactics).size).toBe(1);
    // ORDER BY tac.name ASC → "Defense Evasion" < "Initial Access".
    expect(tactics[0]).toBe('Defense Evasion');
  });

  it('vector tier embeds raw query text without a task prefix', async () => {
    await seedBaseFixture(mg.driver, { withEmbeddings: true });
    stubEmbedding.setFixedVector(V_MATCH);

    await runQuery({
      queries: [{ query: 'completely unrelated semantic query xyzzy' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    expect(stubEmbedding.lastEmbedInput).not.toBeNull();
    expect(stubEmbedding.lastEmbedInput![0]).toBe(
      'completely unrelated semantic query xyzzy',
    );
  });

  // ===== Cascade + topN + kind switching =====

  it('topN clamps oversized request to MAX_TOP_N (50)', async () => {
    // Seed 55 PREFIX_ID-matching techniques (T1xxxx) with unique ids.
    for (let i = 0; i < 55; i++) {
      const suffix = String(10000 + i).padStart(5, '0');
      const attackId = `T1${suffix}`;
      await runWrite(
        mg.driver,
        `CREATE (n:MitreAttackTechnique { attack_id: $aid })
         SET n.id = $id, n.name = $name, n.description = $desc`,
        {
          aid: attackId,
          id: `tech-${attackId}`,
          name: `Test Tech ${attackId}`,
          desc: `Test description ${attackId}`,
        },
      );
    }
    const out = await runQuery({
      queries: [{ query: 'T1' }],
      kind: 'ATTACK_TECHNIQUE',
      topN: 100,
    });
    expect(out.matches[0].candidates.length).toBeLessThanOrEqual(50);
    expect(out.matches[0].candidates.length).toBe(50);
  });

  it('kind switch: DEFEND_TECHNIQUE returns D3FEND nodes only', async () => {
    await seedBaseFixture(mg.driver);
    const out = await runQuery({
      queries: [{ query: 'D3-PMAD' }],
      kind: 'DEFEND_TECHNIQUE',
    });
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].candidates[0].mitreId).toBe('D3-PMAD');
    expect(out.matches[0].candidates[0].kind).toBe('DEFEND_TECHNIQUE');
    expect(out.matches[0].candidates[0].tactic).toBe('Detect');
  });

  it('kind switch: ATTACK_MITIGATION returns mitigation nodes only', async () => {
    await seedBaseFixture(mg.driver);
    const out = await runQuery({
      queries: [{ query: 'M1041' }],
      kind: 'ATTACK_MITIGATION',
    });
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0].candidates[0].mitreId).toBe('M1041');
    expect(out.matches[0].candidates[0].kind).toBe('ATTACK_MITIGATION');
    expect(out.matches[0].candidates[0].tactic).toBeNull();
  });

  it('kind switch: querying an ATT&CK id under DEFEND_TECHNIQUE returns no candidates', async () => {
    await seedBaseFixture(mg.driver);
    const out = await runQuery({
      queries: [{ query: 'T1003' }],
      kind: 'DEFEND_TECHNIQUE',
    });
    expect(out.matches).toHaveLength(0);
    expect(out.unmatched).toEqual(['T1003']);
  });

  // ===== Corpus cache =====

  it('corpus cache: two back-to-back queries hit the cache on the second call', async () => {
    await seedBaseFixture(mg.driver);
    await runQuery({
      queries: [{ query: 'T1003' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    const snap1 = svc.__testOnlyCacheSnapshot();
    expect(snap1).toHaveLength(1);
    expect(snap1[0].kind).toBe('ATTACK_TECHNIQUE');
    const cachedAt1 = snap1[0].cachedAt;

    // Second call within TTL — must reuse the cache entry, NOT refresh it.
    await runQuery({
      queries: [{ query: 'T1078' }],
      kind: 'ATTACK_TECHNIQUE',
    });
    const snap2 = svc.__testOnlyCacheSnapshot();
    expect(snap2).toHaveLength(1);
    expect(snap2[0].cachedAt).toBe(cachedAt1);
  });

  // ===== Validation =====

  it('MAX_QUERIES limit: 26 queries throws', async () => {
    await seedBaseFixture(mg.driver);
    const queries = Array.from({ length: 26 }, (_, i) => ({ query: `T100${i}` }));
    await expect(
      runQuery({ queries, kind: 'ATTACK_TECHNIQUE' }),
    ).rejects.toThrow(/MAX_QUERIES/);
  });

  it('MAX_QUERY_LENGTH limit: 501-char query throws', async () => {
    await seedBaseFixture(mg.driver);
    const longQuery = 'a'.repeat(501);
    await expect(
      runQuery({ queries: [{ query: longQuery }], kind: 'ATTACK_TECHNIQUE' }),
    ).rejects.toThrow(/MAX_QUERY_LENGTH/);
  });

  it('empty queries array throws', async () => {
    await seedBaseFixture(mg.driver);
    await expect(
      runQuery({ queries: [], kind: 'ATTACK_TECHNIQUE' }),
    ).rejects.toThrow(/non-empty/);
  });
});
