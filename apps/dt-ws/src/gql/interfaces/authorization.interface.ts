/**
 * Authorization interfaces for future extensibility
 */

export interface AuthorizationContext {
  user?: {
    id: string;
    email: string;
    roles: string[];
    permissions: string[];
  };
  token?: string;
  sessionId?: string;
}

export interface OperationContext {
  operationType: 'query' | 'mutation' | 'subscription';
  operationName: string;
  resourceId?: string;
  resourceType?: string;
}

export interface AuthorizationResult {
  allowed: boolean;
  reason?: string;
  requiredPermissions?: string[];
  missingPermissions?: string[];
}

export interface AuthorizationPolicy {
  name: string;
  description: string;
  evaluate(context: AuthorizationContext, operation: OperationContext): Promise<AuthorizationResult>;
}

// Future authorization levels
export enum AuthorizationLevel {
  NONE = 'none',
  AUTHENTICATED = 'authenticated', // Current level
  ROLE_BASED = 'role_based',
  PERMISSION_BASED = 'permission_based',
  RESOURCE_BASED = 'resource_based',
  CUSTOM = 'custom',
}

// Module-specific permissions
export enum ModulePermissions {
  READ_MODULES = 'modules:read',
  RESET_MODULES = 'modules:reset',
  MANAGE_MODULES = 'modules:manage',
  ADMIN_MODULES = 'modules:admin',
}
