import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j from 'neo4j-driver';
import {
  buildRankQuery,
  cosineExpr,
  selfTestCypher,
  selfTestPasses,
  type Dialect,
  type RankRequest,
} from '@dethernety/dt-module/embedding';
import { DatabaseService } from '../../database/database.service';
import { safeErrorMessage } from '../../common/utils/safe-error-message';

export interface RankRow {
  id: string;
  score: number;
  [column: string]: unknown;
}

/**
 * Exact vector search on the configured engine: every candidate node is scored with the database's
 * own cosine function, no vector index. The dialect comes from the engine probe; a self-test proves
 * the cosine function exists and maps as expected (orthogonal 0, opposite -1) before any search runs.
 */
@Injectable()
export class VectorSearchService {
  private readonly logger = new Logger(VectorSearchService.name);
  /** A failed self-test is retried after this long: a database that comes up later is picked up. */
  static readonly SELF_TEST_RETRY_MS = 60_000;
  private selfTest: { ok: boolean; at: number } | null = null;
  private selfTestRun: Promise<boolean> | null = null;

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly databaseService: DatabaseService,
  ) {}

  async dialect(): Promise<Dialect> {
    return (await this.databaseService.getEngineInfo()).engine;
  }

  /** The cosine of `stored` and `query` in this engine's dialect, for queries built around it. */
  async cosine(stored: string, query: string): Promise<string> {
    return cosineExpr(await this.dialect(), stored, query);
  }

  /** Whether exact search can run here. Memoized; a failure is retried after SELF_TEST_RETRY_MS. */
  async healthy(): Promise<boolean> {
    if (this.selfTest && (this.selfTest.ok || Date.now() - this.selfTest.at < VectorSearchService.SELF_TEST_RETRY_MS)) {
      return this.selfTest.ok;
    }
    if (!this.selfTestRun) {
      this.selfTestRun = this.runSelfTest().finally(() => {
        this.selfTestRun = null;
      });
    }
    return this.selfTestRun;
  }

  private async runSelfTest(): Promise<boolean> {
    let ok = false;
    try {
      const dialect = await this.dialect();
      const records = await this.read(selfTestCypher(dialect), {});
      ok = selfTestPasses(records[0]?.get('orthogonal'), records[0]?.get('opposite'));
      if (!ok) this.logger.error('Vector search self-test returned unexpected scores; the vector tier stays off', { dialect });
    } catch (error) {
      this.logger.error('Vector search self-test failed; the vector tier stays off', { error: safeErrorMessage(error) });
    }
    this.selfTest = { ok, at: Date.now() };
    return ok;
  }

  /** The top k nodes for one exact search, best first (ties by id). */
  async rank(request: RankRequest): Promise<RankRow[]> {
    const { cypher, params } = buildRankQuery(await this.dialect(), request, (n) => neo4j.int(n));
    const records = await this.read(cypher, params);
    return records.map((r: any) => {
      const row: RankRow = { id: r.get('id'), score: Number(r.get('score')) };
      for (const key of r.keys) if (key !== 'id' && key !== 'score') row[key] = r.get(key);
      return row;
    });
  }

  /** Run a read query and return its records. */
  async read(cypher: string, params: Record<string, unknown>): Promise<any[]> {
    const session = this.neo4jDriver.session({ database: this.configService.get('database.name') });
    try {
      const result = await session.executeRead((tx: any) => tx.run(cypher, params));
      return result.records;
    } finally {
      await session.close();
    }
  }
}
