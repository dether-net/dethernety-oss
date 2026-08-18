/**
 * A module that serves knowledge-graph queries from a service instead of from the deployment's own
 * graph.
 *
 * The sibling of the remote content module, and the same idea: it satisfies the ordinary module
 * contract, so the platform cannot tell it apart from one backed by local data. It contributes
 * schema and resolvers; everything below them is the knowledge-graph client, which is where the
 * choice between a local graph and a service already lives.
 *
 * The concrete module a deployment loads is a short generated stub extending this class. There is
 * nothing for that stub to carry — unlike a content mount, which names a module and a pinned
 * version, the knowledge-graph version is deployment-global — so the constructor takes only what
 * every module is handed.
 *
 * **This module and a locally-installed knowledge-graph module are mutually exclusive.** Both
 * would define the same types and the same capability field, which is a schema conflict rather
 * than a merge. Keeping them apart belongs to whatever mounts them.
 */
import { Logger } from '@nestjs/common';
import { DTModule } from '../interfaces/module-interface';
import { DTMetadata } from '../interfaces/module-metadata-interface';
import { ModuleResolverContext, ResolverMap } from '../interfaces/module-resolver-interface';
import { KgClient, KgRule, KgThreat } from '../interfaces/kg-client-interface';
import { createKgClient } from './factory';
import { kgRefKey } from './keys';
import { KG_REMOTE_SDL } from './schema';

/** The shape the `kgRules` resolver returns: a rule with its threats already attached. */
type ResolvedRule = KgRule & { addresses: KgThreat[] };

export class DtRemoteKnowledgeGraphModule implements DTModule {
  protected readonly logger: Logger;
  protected readonly driver: unknown;
  /** Built once, at `getResolvers` — the database name arrives with the resolver context. */
  protected kg?: KgClient;

  constructor(driver: unknown, logger?: Logger) {
    this.driver = driver;
    this.logger = logger ?? new Logger('DtRemoteKnowledgeGraphModule');
  }

  getMetadata(): DTMetadata {
    return {
      // Deliberately not the name a locally-installed knowledge-graph module uses: the two are
      // mutually exclusive, and a shared identity would make a misconfigured deployment look like
      // an upgrade of one into the other rather than like the conflict it is.
      name: 'knowledge-graph',
      description: 'Knowledge-graph queries answered by a remote service.',
      version: '1.0.0',
      author: 'Dethernety',
    };
  }

  getSchemaExtension(): string {
    return KG_REMOTE_SDL;
  }

  getResolvers(context: ModuleResolverContext): ResolverMap {
    this.kg = createKgClient({
      driver: context.driver ?? this.driver,
      logger: context.logger ?? this.logger,
      databaseName: context.databaseName,
    });

    return {
      Query: {
        // The third resolver argument is the per-request context; `token` on it is the caller's
        // raw bearer. Forwarding it is the whole reason these resolvers exist rather than a shared
        // client call — entitlement is a statement about the caller, and the client is built once
        // at startup while callers arrive per request. A resolver that dropped it would make every
        // query resolve to the locked outcome, which reads exactly like an access problem.
        kgRules: (_parent: unknown, args: { where?: KgRuleWhere }, ctx: { token?: string }) =>
          this.resolveRules(args?.where, ctx?.token),
        kgCapability: (_parent: unknown, _args: unknown, ctx: { token?: string }) =>
          this.client().capability(ctx?.token),
        // Declared and empty, matching the local module's own stubs — including their return type,
        // a JSON-encoded string rather than a list. Similarity is not part of this contract, and a
        // consumer must not be able to tell the modes apart by a validation error on a field that
        // answers nothing either way.
        matchKgStandards: async () => JSON.stringify([]),
        matchKgThreats: async () => JSON.stringify([]),
      },
    };
  }

  private client(): KgClient {
    if (!this.kg) {
      throw new Error('The knowledge-graph module was queried before its resolvers were built');
    }
    return this.kg;
  }

  /**
   * Rules for a class, with their threats already attached.
   *
   * **The threats are fetched once for the whole rule set, not once per rule.** Left as an
   * ordinary field resolver, `addresses` would fire per rule and turn one question about a class
   * into one request per rule it has — the round-trip-per-key degradation the batch surface exists
   * to prevent, and a multiplier on every per-request bound the service applies. A locally-served
   * schema resolves the same selection in a single traversal, so batching is also what keeps the
   * two modes comparable rather than merely correct.
   *
   * The cost is one extra call when a caller selects rules without threats. That is a case no
   * consumer exercises today; if one appears, the fix is to read the selection set here rather
   * than to reintroduce the per-rule fetch.
   */
  private async resolveRules(where: KgRuleWhere | undefined, token?: string): Promise<ResolvedRule[]> {
    const classId = where?.classId?.eq;
    if (!classId) {
      // Refused rather than answered empty. No named query resolves rules by rule id alone, and an
      // empty list here would be indistinguishable from a class that genuinely has no rules.
      throw new Error('kgRules requires where.classId.eq — filtering by ruleId alone is not supported');
    }

    const client = this.client();
    const byClass = await client.rulesByClassId([classId], undefined, token);
    let rules = byClass.get(classId) ?? [];

    const ruleId = where?.ruleId?.eq;
    if (ruleId) rules = rules.filter((r) => r.ruleId === ruleId);
    if (rules.length === 0) return [];

    // Every rule's threats in one call. The refs carry each rule's own `classId` — rule ids are
    // unique only within a class, so a ref built from the requested class alone would be correct
    // here by luck and wrong the moment a rule set spans classes.
    const threats = await client.threatsByRuleId(
      rules.map((r) => ({ classId: r.classId, ruleId: r.ruleId })),
      token,
    );

    return rules.map((rule) => ({
      ...rule,
      addresses: threats.get(kgRefKey(rule.classId, rule.ruleId)) ?? [],
    }));
  }
}

/** The filter subset consumers actually use. Both members optional, matching a generated schema. */
interface KgRuleWhere {
  classId?: { eq?: string };
  ruleId?: { eq?: string };
}
