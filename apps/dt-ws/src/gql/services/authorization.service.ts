import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  AuthorizationContext, 
  OperationContext, 
  AuthorizationResult,
  AuthorizationLevel 
} from '../interfaces/authorization.interface';
import { GqlConfig } from '../gql.config';

/**
 * Shared authorization service for GraphQL resolvers
 * Currently passes through to schema-level @authentication
 * Ready for future enhancement with role-based, resource-based authorization
 */
@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger(AuthorizationService.name);
  private readonly config: GqlConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<GqlConfig>('gql')!;
    this.logger.log('AuthorizationService initialized');
  }

  /**
   * Future-ready authorization check (currently passes through)
   * When you need complex authorization, implement logic here
   */
  async checkAuthorization(
    context: AuthorizationContext,
    operation: OperationContext,
  ): Promise<AuthorizationResult> {
    // Currently: Schema-level @authentication handles this
    // Future: Implement role-based, resource-based, or custom authorization here
    
    this.logger.debug('Authorization check', {
      operation: operation.operationName,
      resourceType: operation.resourceType,
      resourceId: operation.resourceId,
      userId: context.user?.id,
    });

    // Example future implementations:
    // if (operation.operationName === 'getTemplate') {
    //   return await this.checkTemplateAccessPermission(context, operation.resourceId);
    // }
    // 
    // if (operation.operationName === 'resetModule') {
    //   return await this.checkModuleManagementPermission(context, operation.resourceId);
    // }

    // Currently always allow - schema handles authentication
    return {
      allowed: true,
      reason: 'Schema-level authentication passed',
    };
  }

  /**
   * Validates user context
   */
  validateContext(context: AuthorizationContext): boolean {
    // Basic context validation
    if (!context) {
      this.logger.warn('Missing authorization context');
      return false;
    }

    // Future: Add more sophisticated context validation
    return true;
  }

  /**
   * Extracts authorization context from GraphQL context
   */
  extractAuthContext(graphqlContext: any): AuthorizationContext {
    return {
      user: graphqlContext?.user,
      token: graphqlContext?.token,
      sessionId: graphqlContext?.sessionId,
    };
  }

  // Future authorization methods (examples):
  
  // private async checkTemplateAccessPermission(
  //   context: AuthorizationContext, 
  //   templateId: string
  // ): Promise<AuthorizationResult> {
  //   // Check if user can access specific template
  //   // Could check module ownership, role permissions, etc.
  //   return { allowed: true };
  // }

  // private async checkModuleManagementPermission(
  //   context: AuthorizationContext, 
  //   moduleId: string
  // ): Promise<AuthorizationResult> {
  //   // Check if user can manage specific module
  //   // Could check ownership, admin role, etc.
  //   return { allowed: true };
  // }
}
