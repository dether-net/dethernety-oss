import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() === 'http') {
      return this.handleHttpRequest(context, next);
    } else if (context.getType<any>() === 'graphql') {
      return this.handleGraphQLRequest(context, next);
    }

    return next.handle();
  }

  private handleHttpRequest(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const method = request.method;
    const url = request.url;
    const startTime = Date.now();

    // Generate request ID
    const requestId = this.generateRequestId();
    request['requestId'] = requestId;

    // Log incoming request
    this.logger.log('Incoming HTTP request', {
      requestId,
      method,
      url,
      userAgent: request.get('User-Agent'),
      ip: request.ip,
      timestamp: new Date().toISOString(),
    });

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        this.logger.log('HTTP request completed', {
          requestId,
          method,
          url,
          statusCode,
          duration,
          timestamp: new Date().toISOString(),
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        
        this.logger.error('HTTP request failed', {
          requestId,
          method,
          url,
          duration,
          error: error.message,
          timestamp: new Date().toISOString(),
        });

        throw error;
      }),
    );
  }

  private handleGraphQLRequest(context: ExecutionContext, next: CallHandler): Observable<any> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    // Get GraphQL context
    const gqlContext = context.getArgs()[2];
    const operation = gqlContext?.req?.body?.operationName || 'Unknown';
    const query = gqlContext?.req?.body?.query;

    // Log GraphQL operation start
    this.logger.log('GraphQL operation started', {
      requestId,
      operation,
      query: this.sanitizeQuery(query),
      timestamp: new Date().toISOString(),
    });

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;

        this.logger.log('GraphQL operation completed', {
          requestId,
          operation,
          duration,
          timestamp: new Date().toISOString(),
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;

        this.logger.error('GraphQL operation failed', {
          requestId,
          operation,
          duration,
          error: error.message,
          timestamp: new Date().toISOString(),
        });

        throw error;
      }),
    );
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private sanitizeQuery(query: string): string {
    if (!query) return 'N/A';
    
    // Remove extra whitespace and limit length for logging
    const sanitized = query.replace(/\s+/g, ' ').trim();
    return sanitized.length > 200 ? `${sanitized.substring(0, 200)}...` : sanitized;
  }
}
