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
} from '@nestjs/common';
import { Request, Response } from 'express';
import { createHandler, HandlerOptions } from 'graphql-sse/lib/use/express';
import { ConfigService } from '@nestjs/config';
import { SchemaService } from '../services/schema.service';
import { RESOLVER_SERVICES } from '../resolvers.constants';
import { Inject } from '@nestjs/common';
import { ResolverService } from '../interfaces/resolver.interface';

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
 */
@Controller('graphql')
export class GraphQLSseController implements OnModuleInit {
  private readonly logger = new Logger(GraphQLSseController.name);
  private handler: ReturnType<typeof createHandler> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly schemaService: SchemaService,
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    @Inject(RESOLVER_SERVICES) private readonly resolverServices: ResolverService[],
  ) {}

  async onModuleInit() {
    try {
      this.logger.log('Initializing GraphQL SSE handler...');

      // Merge custom resolvers
      const customResolvers = this.schemaService.mergeResolvers(this.resolverServices);

      // Get the schema with custom resolvers
      const schema = await this.schemaService.buildSchemaWithResolvers(customResolvers);

      const databaseName = this.configService.get('database.name') || 'neo4j';

      // Create the graphql-sse handler
      this.handler = createHandler({
        schema,
        context: (req) => {
          // Extract token from Authorization header
          const authHeader = req.raw.headers.authorization;
          const token = authHeader?.replace('Bearer ', '');

          return {
            token,
            jwt: token,
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
