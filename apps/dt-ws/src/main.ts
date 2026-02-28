import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import * as express from 'express';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  try {
    logger.log('Starting application...');
    
    // Create NestJS application with proper logging
    const app = await NestFactory.create(AppModule, {
      logger: process.env.NODE_ENV === 'production' 
        ? ['error', 'warn', 'log'] 
        : ['error', 'warn', 'log', 'debug', 'verbose'],
    });

    // Request body size limits
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ limit: '1mb', extended: true }));

    // Get configuration service
    const configService = app.get(ConfigService);
    
    // Global validation pipe
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      disableErrorMessages: process.env.NODE_ENV === 'production',
    }));

    // Disable X-Powered-By header
    app.getHttpAdapter().getInstance().disable('x-powered-by');

    // CORS configuration
    app.enableCors({
      origin: process.env.NODE_ENV === 'production' 
        ? process.env.ALLOWED_ORIGINS?.split(',') || false
        : true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    });

    // Security headers
    if (process.env.NODE_ENV === 'production') {
      // Build connect-src dynamically to allow OIDC provider domains
      const connectSrcParts = ["'self'"];
      if (process.env.OIDC_ISSUER) {
        try { connectSrcParts.push(new URL(process.env.OIDC_ISSUER).origin); } catch { /* invalid URL, skip */ }
      }
      if (process.env.OIDC_DOMAIN) {
        const sanitizedDomain = process.env.OIDC_DOMAIN.replace(/[^a-zA-Z0-9.\-:]/g, '');
        connectSrcParts.push(`https://${sanitizedDomain}`);
      }
      const connectSrc = connectSrcParts.join(' ');

      app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src ${connectSrc}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`);
        next();
      });
    }

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.log('SIGTERM received, shutting down gracefully...');
      await app.close();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      logger.log('SIGINT received, shutting down gracefully...');
      await app.close();
      process.exit(0);
    });

    // Start server
    const port = process.env.PORT || 3003;
    await app.listen(port, '0.0.0.0');
    
    logger.log(`Application is running on port ${port}`);
    logger.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.log(`GraphQL endpoint: http://localhost:${port}/graphql`);
    
    if (process.env.NODE_ENV !== 'production') {
      logger.log(`GraphQL Playground: http://localhost:${port}/graphql`);
    }
    
  } catch (error) {
    logger.error('Failed to start application', error.stack);
    process.exit(1);
  }
}

bootstrap();
