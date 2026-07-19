import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Query,
  Headers,
  Logger,
  OnModuleInit,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { createHandler } from 'graphql-sse/lib/use/express';
import { parse } from 'graphql';
import { ConfigService } from '@nestjs/config';
import { GQL_SCHEMA } from '../resolvers.constants';
import { Inject } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { extractBearerToken } from '../../common/utils/extract-bearer-token';
import {
  assertComplexityWithinLimit,
  buildGuardedValidate,
} from '../utils/query-guards';
import { buildMaskedExecutors } from '../utils/sse-error-masking';
import { GqlConfig } from '../gql.config';

/**
 * GraphQL SSE Controller
 *
 * Provides Server-Sent Events (SSE) transport for GraphQL subscriptions.
 * This replaces WebSocket-based subscriptions with HTTP-based streaming.
 *
 * Benefits:
 * - Works through CloudFront and other HTTP proxies
 * - No WebSocket upgrade required
 * - Simpler connection handling
 * - Better compatibility with VPC Origins
 *
 * Serves the SAME schema instance as /graphql (the shared GQL_SCHEMA —
 * module types/resolvers included) and applies the same depth/complexity
 * guards, so a query behaves identically on both transports.
 */
@Controller('graphql')
@UseGuards(JwtAuthGuard)
export class GraphQLSseController implements OnModuleInit {
  private readonly logger = new Logger(GraphQLSseController.name);
  private handler: ReturnType<typeof createHandler> | null = null;

  constructor(
    private readonly configService: ConfigService,
    @Inject(GQL_SCHEMA) private readonly schema: any,
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
  ) {}

  async onModuleInit() {
    try {
      this.logger.log('Initializing GraphQL SSE handler...');

      const databaseName = this.configService.get('database.name');
      const gqlConfig = this.configService.get<GqlConfig>('gql')!;
      const schema = this.schema;

      // Create the graphql-sse handler on the shared schema, with the
      // shared depth rules (validate), the complexity gate (onSubscribe —
      // the earliest hook where the operation + variables are available),
      // and production error-masking on execution results (the SSE
      // counterpart of Apollo's formatError).
      this.handler = createHandler({
        schema,
        validate: buildGuardedValidate(gqlConfig),
        ...buildMaskedExecutors(process.env.NODE_ENV === 'production'),
        onSubscribe: (_req, params) => {
          // A syntactically-invalid query falls through untouched — the
          // handler's own parse produces the proper GraphQL error response.
          let document;
          try {
            document =
              typeof params.query === 'string' ? parse(params.query) : params.query;
          } catch {
            return;
          }
          try {
            assertComplexityWithinLimit({
              schema,
              operationName: params.operationName,
              document,
              variables: params.variables as Record<string, unknown> | null,
              limit: gqlConfig.queryComplexityLimit,
            });
          } catch (error: any) {
            // A thrown onSubscribe error would escape the handler and
            // surface as an opaque 500 — return graphql-sse's Response
            // tuple instead so the client gets a structured 400 naming the
            // limit (same message Apollo's plugin returns on /graphql).
            return [
              JSON.stringify({ errors: [{ message: error?.message }] }),
              {
                status: 400,
                statusText: 'Bad Request',
                headers: { 'content-type': 'application/json; charset=utf-8' },
              },
            ] as const;
          }
        },
        context: (req) => {
          // Extract token from Authorization header
          const token = extractBearerToken(req.raw.headers.authorization);
          // Stamped by the class-level JwtAuthGuard, which already rejects an
          // invalid token before this handler runs — so `user` here is always
          // a verified payload (or the dev mock).
          const user = (req.raw as any).user;

          return {
            token, // raw bearer string (unverified)
            jwt: user, // VERIFIED claims only — never the raw bearer string
            user, // required by requireAdmin()
            driver: this.neo4jDriver,
            sessionConfig: { database: databaseName },
            cypherQueryOptions: { addVersionPrefix: false },
          };
        },
      });

      this.logger.log('GraphQL SSE handler initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize GraphQL SSE handler:', error);
      throw error;
    }
  }

  /**
   * SSE endpoint for GraphQL subscriptions
   * Supports both GET (EventSource) and POST (fetch with streaming)
   */
  @Get('stream')
  async streamGet(@Req() req: Request, @Res() res: Response) {
    if (!this.handler) {
      this.logger.error('SSE handler not initialized');
      res.status(503).json({ error: 'SSE handler not ready' });
      return;
    }

    try {
      await this.handler(req, res);
    } catch (error) {
      this.logger.error('SSE stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }

  @Post('stream')
  async streamPost(@Req() req: Request, @Res() res: Response) {
    if (!this.handler) {
      this.logger.error('SSE handler not initialized');
      res.status(503).json({ error: 'SSE handler not ready' });
      return;
    }

    try {
      await this.handler(req, res);
    } catch (error) {
      this.logger.error('SSE stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  }
}
