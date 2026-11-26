import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import * as path from 'path';
import { createKgClient, DtFileOpaModule, KgClient, ModuleResolverContext, ResolverMap } from '@dethernety/dt-module';
import { Deadline, DeadlineExceeded, MODEL_ID_MAX, ReadOverCap } from './bounds';
import { KindClass, readKindClasses } from './classes';
import { MODULE_NAME, refusal, tableHash } from './contract';
import { answerOf, recheckAnswerOf } from './answer';
import { verdictOf } from './recheck';
import { foldModel } from './fold';
import { boundCandidates, candidateId, matchCandidates, MatchingOverBudget, orderCandidates, RecheckEntry, recheckWalk } from './generate';
import { absentFacts, applyKg, classInventory, kgClassModules, readKg } from './kg';
import { OptionsResult, parseOptions } from './options';
import { READS, readModel, Row, Run } from './reads';
import { EDGE_KIND_TABLE } from './edge-kinds.table';
import { EdgeKind, EdgeKindTable, validateTable } from './table';

/** The only Cypher this module runs. */
const ALLOWED_CYPHER: ReadonlySet<string> = new Set(Object.values(READS));

/** The caller's raw bearer, forwarded to the knowledge graph: entitlement is a statement about the caller. */
function callerToken(context: unknown): string | undefined {
  const token = (context as { token?: unknown } | undefined)?.token;
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/** The caller's identity for the in-flight limit: the verified user's subject, or one shared key when auth is off. */
function callerKey(context: unknown): string {
  const sub = (context as { user?: { sub?: unknown } } | undefined)?.user?.sub;
  return typeof sub === 'string' && sub.length > 0 ? `user:${sub}` : 'anonymous';
}

/** A Neo4j server-side transaction timeout: the deadline passed inside a read. */
function isTransactionTimeout(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && code.includes('TransactionTimedOut');
}

/**
 * Dethernety Hidden Edges: proposes inferred attack paths ("hidden edges") a threat model does not show, from
 * its exposures and their ATT&CK techniques, as one read-only query. The answer is JSON in a String, as the
 * other backend-only modules answer, so @neo4j/graphql never treats a new object type as a node.
 *
 * Read-only is this module's own discipline: the platform hands it the full driver. Every read runs in a read
 * session and a read transaction, the runner refuses any Cypher but the module's declared reads, and a test
 * refuses write clauses in them. The platform's resolver timeout cancels nothing, so the bounds are structural
 * (see bounds.ts), and each caller has at most one call in flight.
 *
 * The platform has no per-model authorization: any verified user can read any model through its own queries,
 * and so can learn here whether a model id exists and its counts. This module adds no access check of its own.
 */
class DethernetyHiddenEdgesModule extends DtFileOpaModule {
  private databaseName: string | undefined;
  private readonly inFlight = new Set<string>();
  /**
   * Validated once at load: a malformed table fails the module's load, never one call. Compiled in (generated
   * from edge-kinds.json), so the packaged module carries it and no JSON-module support is needed.
   */
  private readonly table: EdgeKindTable = validateTable(EDGE_KIND_TABLE);
  /** Which table answered: its hash. */
  private readonly tableHash: string = tableHash(EDGE_KIND_TABLE);
  private kg: KgClient | undefined;
  /** Each kind's class, read once from the module's own class files: a missing or malformed one fails the load. */
  private readonly classes: Readonly<Record<EdgeKind, KindClass>>;

  private readonly driver: any;
  private readonly log: Logger;

  /**
   * The four hidden-edge classes are file data, served as any file-policy module serves its classes: beside the
   * compiled module when it is packaged (`data/`), else the package's own `data/` (from the sources, or the
   * unpackaged build under `dist/dethernety/<name>/`).
   */
  constructor(driver: any, logger: Logger) {
    const dataDir =
      [path.resolve(__dirname, 'data'), path.resolve(__dirname, '..', 'data'), path.resolve(__dirname, '..', '..', '..', 'data')].find((d) => existsSync(d)) ??
      path.resolve(__dirname, 'data');
    super(dataDir, MODULE_NAME, driver, logger);
    this.classes = readKindClasses(dataDir);
    this.driver = driver;
    this.log = logger;
  }

  getSchemaExtension(): string {
    return /* GraphQL */ `
      extend type Query {
        """Hidden-edge candidates for a model, as a JSON-encoded string. Read-only. See dethernety-hidden-edges."""
        hiddenEdgeCandidates(modelId: ID!, options: String): String
      }
    `;
  }

  /** Use this knowledge-graph client instead of the one the deployment's configuration selects (tests). */
  useKgClient(client: KgClient): void {
    this.kg = client;
  }

  getResolvers(context: ModuleResolverContext): ResolverMap {
    this.databaseName = context.databaseName;
    this.kg ??= createKgClient({ driver: context.driver ?? this.driver, logger: context.logger ?? this.log, databaseName: context.databaseName });
    return {
      Query: {
        hiddenEdgeCandidates: async (_parent: unknown, args: { modelId?: unknown; options?: unknown }, requestContext: unknown) => {
          const phases: Record<string, number> = {};
          const answer = await this.candidates(args, { caller: callerKey(requestContext), token: callerToken(requestContext), phases });
          const started = Date.now();
          const text = JSON.stringify(answer);
          phases.stringify = Date.now() - started;
          // durations only: no ids, no counts, nothing of the model
          this.log.debug?.(`${MODULE_NAME}: phases (ms) ${Object.entries(phases).map(([k, v]) => `${k}=${v}`).join(' ')}`);
          return text;
        },
      },
    };
  }

  /**
   * The answer for one call: a refusal, or the contract with what the call read. `phases` receives each phase's
   * duration in milliseconds, for the debug log.
   */
  async candidates(
    args: { modelId?: unknown; options?: unknown },
    { caller = 'anonymous', deadline = new Deadline(), token, phases = {} }: { caller?: string; deadline?: Deadline; token?: string; phases?: Record<string, number> } = {},
  ): Promise<object> {
    const modelId = args.modelId;
    if (typeof modelId !== 'string' || modelId.length === 0 || modelId.length > MODEL_ID_MAX) return refusal('model_not_found');
    const parsed = parseOptions(args.options);
    // narrowed by hand: the platform's tests compile this file without strict null checks
    if (parsed.ok !== true) {
      const refused = parsed as Extract<OptionsResult, { ok: false }>;
      return refusal(refused.code, refused.detail);
    }
    const { options, contract } = parsed as Extract<OptionsResult, { ok: true }>;
    let mark = Date.now();
    const phase = (name: string) => {
      const now = Date.now();
      phases[name] = now - mark;
      mark = now;
    };

    if (this.inFlight.has(caller)) return refusal('busy', undefined, contract);
    this.inFlight.add(caller);
    let session: any;
    try {
      session = this.driver.session({
        ...(this.databaseName ? { database: this.databaseName } : {}),
        defaultAccessMode: 'READ',
      });
      deadline.check();
      const rows = await session.executeRead(
        (tx: any) => {
          const run: Run = async (cypher, params) => {
            if (!ALLOWED_CYPHER.has(cypher)) throw new Error('refused a query the module does not declare');
            return (await tx.run(cypher, params)).records.map((r: any) => r.toObject() as Row);
          };
          return readModel(run, modelId, deadline);
        },
        { timeout: Math.max(1, deadline.remaining()) },
      );
      phase('read');
      if (rows === null) return refusal('model_not_found', undefined, contract);
      const model = foldModel(rows);
      phase('fold');
      if (options.recheck) {
        const { parts, topology } = await recheckWalk(model, this.table, options.recheck, deadline);
        phase('recheck');
        // one verdict per edge, in the order first asked; an edge asked twice is judged on every finding given for it
        const asked = new Map<string, RecheckEntry>();
        for (const x of options.recheck) {
          const id = candidateId(x.kind, x.source, x.target);
          const prior = asked.get(id);
          if (prior) prior.exposure_ids = [...new Set([...prior.exposure_ids, ...x.exposure_ids])];
          else asked.set(id, { ...x, exposure_ids: [...x.exposure_ids] });
        }
        const verdicts = [...asked].map(([id, x]) => verdictOf(model, (s, t) => topology.hasDeclaredFlow(s, t), x, parts.get(id) ?? []));
        return recheckAnswerOf(this.tableHash, verdicts);
      }
      const matched = await matchCandidates(model, this.table, { ...options, explain: contract === 2 }, deadline);
      phase('match');
      // the answer's candidates are chosen before the knowledge graph runs, so it can lower a tier but never
      // push a candidate out of a budget
      const chosen = boundCandidates(matched.candidates, model, matched.counts);
      phase('bound');
      const facts = this.kg ? await readKg(this.kg, token, classInventory(model, kgClassModules()), deadline) : absentFacts('unavailable');
      phase('kg');
      // each candidate names the class an accepted edge of its kind is written with (answerOf adds it)
      const kgEvidence = new Map<string, string[]>();
      const candidates = orderCandidates(applyKg(model, this.table, chosen, matched.anchors, facts, kgEvidence), model);
      const answer = await answerOf({
        contract,
        model,
        table: this.table,
        tableHash: this.tableHash,
        classes: this.classes,
        matched,
        candidates,
        kgEvidence,
        deadline,
        regime: facts.regime,
        classesCapped: facts.classesCapped,
      });
      phase('explain');
      return answer;
    } catch (err) {
      if (err instanceof ReadOverCap) return refusal('model_too_large', err.read, contract);
      if (err instanceof MatchingOverBudget) return refusal('model_too_large', 'matching', contract);
      if (err instanceof DeadlineExceeded || isTransactionTimeout(err)) return refusal('deadline', undefined, contract);
      // A fault: logged without the query, its parameters or its message, and thrown with a generic one.
      this.log.error(`${MODULE_NAME}: the read failed (${err instanceof Error ? err.name : typeof err})`);
      throw new Error('hidden-edge candidates could not be read');
    } finally {
      this.inFlight.delete(caller);
      if (session) {
        try {
          await session.close();
        } catch (err) {
          this.log.error(`${MODULE_NAME}: closing the session failed (${err instanceof Error ? err.name : typeof err})`);
        }
      }
    }
  }
}

export default DethernetyHiddenEdgesModule;
