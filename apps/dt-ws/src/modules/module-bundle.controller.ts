import {
  Controller,
  Get,
  Param,
  Res,
  UseGuards,
  Logger,
  HttpStatus,
  HttpException,
  Req,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ModuleManagementService } from '../gql/module-management-services/module-management.service';
import { ModuleRegistryService } from '../gql/module-management-services/module-registry.service';
import { AuthorizationContext } from '../gql/interfaces/authorization.interface';

@Controller('modules')
@UseGuards(JwtAuthGuard)
export class ModuleBundleController {
  private readonly logger = new Logger(ModuleBundleController.name);

  constructor(
    private readonly moduleManagementService: ModuleManagementService,
    private readonly moduleRegistryService: ModuleRegistryService,
  ) {}

  @Get(':moduleName/bundle.js')
  async getModuleBundle(
    @Param('moduleName') moduleName: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const startTime = Date.now();
    
    try {
      this.logger.log('REST request for module bundle', {
        moduleName,
        userAgent: request.headers['user-agent'],
        ip: request.ip,
        userId: request['user']?.sub,
      });

      // Create authorization context from request
      const authContext: AuthorizationContext = {
        user: request['user'] ? {
          id: request['user'].sub,
          email: request['user'].email || '',
          roles: request['user'].roles || [],
          permissions: request['user'].permissions || [],
        } : undefined,
        token: request['token'],
        sessionId: request.headers['x-session-id'] as string,
      };

      // Get bundle content using service
      const bundleContent = await this.moduleManagementService.getModuleFrontendBundle(
        moduleName,
        this.moduleRegistryService,
      );

      const duration = Date.now() - startTime;

      // Set appropriate headers
      response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      response.setHeader('Cache-Control', 'public, max-age=300'); // 5 minutes cache
      response.setHeader('X-Module-Name', moduleName);
      response.setHeader('X-Response-Time', `${duration}ms`);

      this.logger.log('Module bundle served successfully via REST', {
        moduleName,
        bundleSize: bundleContent.length,
        duration,
        userId: request['user']?.sub,
      });

      response.send(bundleContent);

    } catch (error) {
      const duration = Date.now() - startTime;
      
      this.logger.error('Failed to serve module bundle via REST', {
        moduleName,
        error: error.message,
        duration,
        userId: request['user']?.sub,
      });

      // Map service errors to appropriate HTTP status codes
      if (error.message.includes('not registered')) {
        throw new HttpException(
          `Module '${moduleName}' not found`,
          HttpStatus.NOT_FOUND,
        );
      } else if (error.message.includes('not healthy')) {
        throw new HttpException(
          `Module '${moduleName}' is currently unavailable`,
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      } else if (error.message.includes('not in the allowed modules list')) {
        throw new HttpException(
          `Access to module '${moduleName}' is forbidden`,
          HttpStatus.FORBIDDEN,
        );
      } else if (error.message.includes('Frontend bundle not found')) {
        throw new HttpException(
          `Bundle not found for module '${moduleName}'`,
          HttpStatus.NOT_FOUND,
        );
      } else if (error.message.includes('Access denied')) {
        throw new HttpException(
          `Access denied to module '${moduleName}' bundle`,
          HttpStatus.FORBIDDEN,
        );
      } else {
        throw new HttpException(
          'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    }
  }
}
