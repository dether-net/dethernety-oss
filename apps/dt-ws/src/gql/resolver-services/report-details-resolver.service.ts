import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphQLError } from 'graphql';
import { writeLockClause } from '@dethernety/dt-module';
import { AuthorizationService } from '../services/authorization.service';
import { AuthorizationContext } from '../interfaces/authorization.interface';
import { ResolverMap, ResolverService } from '../interfaces/resolver.interface';
import { GqlConfig } from '../gql.config';
import { authenticationRequired, authenticationRequiredError } from '../services/schema.service';
import { safeErrorMessage } from '../../common/utils/safe-error-message';
import {
  ReportDetails,
  ReportDetailsError,
  ReportDetailsInput,
  checkInput,
  mergeDetails,
  newest,
  parseStored,
  suggestion,
  toDetails,
} from './shared/report-details';

/** Every binding's stored report details. The edge type has no relationship properties in the GraphQL schema. */
export const READ_REPORT_DETAILS = `
MATCH (:Analysis {id: $analysisId})<-[r:ANALYZED_BY]-()
RETURN r.metadata AS metadata`;

/**
 * Locks the analysis for the rest of a set's transaction, before the read the write depends on: on Neo4j a second set
 * waits here and then reads what the first committed; on Memgraph it conflicts, and the managed transaction retries it.
 */
export const LOCK_ANALYSIS = `
MATCH (a:Analysis {id: $analysisId})
${writeLockClause('a')}
RETURN a.id AS id`;

/** The same value on every binding, so the details do not depend on which binding remains. */
export const WRITE_REPORT_DETAILS = `
MATCH (:Analysis {id: $analysisId})<-[r:ANALYZED_BY]-()
SET r.metadata = $metadata
RETURN count(r) AS edges`;

/** The report details of the other analyses of the element(s) this one is bound to; never the elements' own data. */
export const READ_SIBLING_REPORT_DETAILS = `
MATCH (:Analysis {id: $analysisId})<-[:ANALYZED_BY]-(e)
MATCH (e)-[r:ANALYZED_BY]->(other:Analysis)
WHERE other.id <> $analysisId AND r.metadata IS NOT NULL
RETURN r.metadata AS metadata`;

/**
 * The report details of an analysis: read, set, and suggested from the element's other analyses. They are read and
 * written only here; the edge property is not in the GraphQL schema, so no generated query or filter reaches it.
 */
@Injectable()
export class ReportDetailsResolverService implements ResolverService {
  private readonly logger = new Logger(ReportDetailsResolverService.name);
  private readonly userRequired: boolean;

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly authorizationService: AuthorizationService,
  ) {
    this.userRequired = authenticationRequired(this.configService.get<GqlConfig>('gql') ?? { enableNoauth: false });
  }

  getResolvers(): ResolverMap {
    return {
      Query: {
        reportDetails: async (_parent, args, context) =>
          this.reportDetails(args.analysisId, this.authorizationService.extractAuthContext(context)),
        suggestReportDetails: async (_parent, args, context) =>
          this.suggestReportDetails(args.analysisId, this.authorizationService.extractAuthContext(context)),
      },
      Mutation: {
        setReportDetails: async (_parent, args, context) =>
          this.setReportDetails(
            args.analysisId,
            args.details ?? {},
            this.authorizationService.extractAuthContext(context),
          ),
      },
    };
  }

  /** The analysis's report details; null for an unknown analysis or one bound to no element. */
  async reportDetails(analysisId: string, authContext: AuthorizationContext): Promise<ReportDetails | null> {
    await this.authorize(authContext, 'query', 'reportDetails', analysisId);
    const rows = await this.read(READ_REPORT_DETAILS, analysisId);
    if (rows.length === 0) return null;
    return toDetails(newest(this.parse(rows, analysisId)));
  }

  /**
   * The newest report details among the other analyses of the same element(s); null when there are none. Authorization
   * is checked for the requested analysis only: a per-analysis authorization must also cover the analyses read here.
   */
  async suggestReportDetails(analysisId: string, authContext: AuthorizationContext): Promise<ReportDetails | null> {
    await this.authorize(authContext, 'query', 'suggestReportDetails', analysisId);
    const rows = await this.read(READ_SIBLING_REPORT_DETAILS, analysisId);
    return suggestion(rows.map((raw) => parseStored(raw).value));
  }

  /**
   * Sets the analysis's report details on every binding, in one write transaction: lock the analysis, read what is
   * stored, merge in TypeScript (neither database parses JSON in Cypher), write. Returns the details as stored.
   */
  async setReportDetails(
    analysisId: string,
    details: ReportDetailsInput,
    authContext: AuthorizationContext,
  ): Promise<ReportDetails> {
    await this.authorize(authContext, 'mutation', 'setReportDetails', analysisId);
    const session = this.neo4jDriver.session({ database: this.configService.get('database.name') });
    try {
      // Checked before the transaction, so a bad value takes no lock.
      checkInput(details);
      return await session.executeWrite(async (tx: any) => {
        const locked = await tx.run(LOCK_ANALYSIS, { analysisId });
        if (locked.records.length === 0) {
          throw new ReportDetailsError('ANALYSIS_NOT_FOUND', 'No analysis has this id');
        }
        const read = await tx.run(READ_REPORT_DETAILS, { analysisId });
        if (read.records.length === 0) {
          throw new ReportDetailsError(
            'ANALYSIS_NOT_BOUND',
            'The analysis is bound to no element, so it has no report details',
          );
        }
        const stored = newest(this.parse(read.records.map((record: any) => record.get('metadata')), analysisId));
        const metadata = mergeDetails(stored, details, new Date().toISOString());
        await tx.run(WRITE_REPORT_DETAILS, { analysisId, metadata });
        return toDetails(JSON.parse(metadata));
      });
    } catch (error) {
      if (error instanceof ReportDetailsError) {
        throw new GraphQLError(error.message, { extensions: { code: error.code } });
      }
      this.logger.error('Failed to set report details', { analysisId, error: safeErrorMessage(error) });
      throw error;
    } finally {
      await session.close();
    }
  }

  /** A verified user first (see authenticationRequired), then the authorization check. */
  private async authorize(
    authContext: AuthorizationContext,
    operationType: 'query' | 'mutation',
    operationName: string,
    analysisId: string,
  ): Promise<void> {
    if (this.userRequired && !authContext.user) {
      this.logger.warn(`${operationName} called without authentication`);
      throw authenticationRequiredError();
    }
    const result = await this.authorizationService.checkAuthorization(authContext, {
      operationType,
      operationName,
      resourceType: 'Analysis',
      resourceId: analysisId,
    });
    if (!result.allowed) throw new ForbiddenException(result.reason || `Not authorized to ${operationName}`);
  }

  private async read(query: string, analysisId: string): Promise<unknown[]> {
    const session = this.neo4jDriver.session({ database: this.configService.get('database.name') });
    try {
      const result = await session.executeRead((tx: any) => tx.run(query, { analysisId }));
      return result.records.map((record: any) => record.get('metadata'));
    } finally {
      await session.close();
    }
  }

  /** The stored values as objects; one log line when any binding holds something that is not a JSON object. */
  private parse(rows: unknown[], analysisId: string): Record<string, unknown>[] {
    const parsed = rows.map(parseStored);
    if (parsed.some((row) => row.corrupt)) {
      this.logger.warn('Report details on a binding of the analysis are not a JSON object; read as empty', {
        analysisId,
      });
    }
    return parsed.map((row) => row.value);
  }
}
