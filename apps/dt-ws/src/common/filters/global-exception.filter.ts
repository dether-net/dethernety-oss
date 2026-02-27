import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  method: string;
  message: string;
  error?: string;
  details?: any;
  requestId?: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Unknown Error';
    let details: any = null;

    // Generate request ID for tracking
    const requestId = this.generateRequestId();
    
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || responseObj.error || exception.message;
        error = responseObj.error || exception.name;
        details = responseObj.details || null;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
      
      // Log stack trace for debugging
      if (process.env.NODE_ENV !== 'production') {
        details = exception.stack;
      }
    }

    const errorResponse: ErrorResponse = {
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      method: request.method,
      message: process.env.NODE_ENV === 'production' && status >= 500 
        ? 'Internal server error' 
        : message,
      requestId,
    };

    // Add error details only in development
    if (process.env.NODE_ENV !== 'production') {
      errorResponse.error = error;
      if (details) {
        errorResponse.details = details;
      }
    }

    // Log error with context
    const logContext = {
      requestId,
      method: request.method,
      url: request.url,
      userAgent: request.get('User-Agent'),
      ip: request.ip,
      statusCode: status,
      error: error,
      message: message,
      stack: exception instanceof Error ? exception.stack : undefined,
    };

    if (status >= 500) {
      this.logger.error('Server error occurred', logContext);
    } else if (status >= 400) {
      this.logger.warn('Client error occurred', logContext);
    } else {
      this.logger.log('Request processed with error', logContext);
    }

    response.status(status).json(errorResponse);
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
