import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppController } from './app.controller';
import { ConfigModule } from '@nestjs/config';
import { GqlModule } from './gql/gql.module';
import { DatabaseModule } from './database/database.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { environmentValidation } from './config/environment.validation';
import { SpaFallbackController } from './common/controllers/spa-fallback.controller';
import { join } from 'path';

@Module({
  imports: [
    // Configuration (load and validate environment variables)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'production' ? '.env.production' : '.env',
      validate: environmentValidation.validate,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    
    
    // Backend static assets serving
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/static',
      serveStaticOptions: {
        index: false,
        fallthrough: true, // Allow fallthrough for other static files
      },
    }),
    
    // Frontend assets serving - serve built Vue.js application from /public directly
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      serveRoot: '/',
      serveStaticOptions: {
        index: false, // Don't auto-serve index.html (let SPA fallback handle it)
        fallthrough: true, // Allow fallthrough to other handlers
        // Cache static assets for performance
        setHeaders: (res, path) => {
          if (path.includes('/assets/') || path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
          }
        },
      },
    }),
    
    // Core modules
    DatabaseModule,
    GqlModule,
  ],
  controllers: [AppController, SpaFallbackController],
  providers: [
    // Global error handling
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    
    // Global request/response logging
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule {}
