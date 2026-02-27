import { registerAs } from '@nestjs/config';
// Note: Install these packages: npm install class-validator class-transformer
// import { IsString, IsBoolean, IsOptional, IsNumber, validateSync } from 'class-validator';
// import { plainToClass, Transform } from 'class-transformer';

// Temporary implementation without class-validator for immediate use
interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

function validateConfig(config: any): ValidationResult {
  const errors: string[] = [];
  
  // Core GraphQL settings
  if (typeof config.playground !== 'boolean') {
    errors.push('playground must be a boolean');
  }
  if (typeof config.introspection !== 'boolean') {
    errors.push('introspection must be a boolean');
  }
  if (config.oidcJwksUri && typeof config.oidcJwksUri !== 'string') {
    errors.push('oidcJwksUri must be a string');
  }
  if (typeof config.queryDepthLimit !== 'number' || config.queryDepthLimit < 0) {
    errors.push('queryDepthLimit must be a positive number');
  }
  if (typeof config.queryComplexityLimit !== 'number' || config.queryComplexityLimit < 0) {
    errors.push('queryComplexityLimit must be a positive number');
  }
  if (typeof config.enableSubscriptions !== 'boolean') {
    errors.push('enableSubscriptions must be a boolean');
  }
  if (!['sse', 'ws'].includes(config.subscriptionTransport)) {
    errors.push('subscriptionTransport must be "sse" or "ws"');
  }

  // Module Registry settings
  if (typeof config.customModulesPath !== 'string') {
    errors.push('customModulesPath must be a string');
  }
  if (!Array.isArray(config.allowedModules)) {
    errors.push('allowedModules must be an array');
  } else {
    // Validate each allowed module name
    for (const moduleName of config.allowedModules) {
      if (typeof moduleName !== 'string') {
        errors.push('allowedModules must contain only strings');
        break;
      }
    }
  }
  if (typeof config.enableModuleHotReload !== 'boolean') {
    errors.push('enableModuleHotReload must be a boolean');
  }
  if (typeof config.moduleLoadTimeout !== 'number' || config.moduleLoadTimeout < 1000) {
    errors.push('moduleLoadTimeout must be a number >= 1000ms');
  }
  if (typeof config.enableModuleSecurityValidation !== 'boolean') {
    errors.push('enableModuleSecurityValidation must be a boolean');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

export type SubscriptionTransport = 'sse' | 'ws';

export class GqlConfig {
  playground: boolean = false;
  introspection: boolean = false;
  oidcJwksUri?: string;
  oidcIssuer?: string;
  oidcAudience?: string;
  queryDepthLimit: number = 10;
  queryComplexityLimit: number = 1000;
  enableSubscriptions: boolean = true;
  subscriptionTransport: SubscriptionTransport = 'sse';

  // Module Registry Configuration
  customModulesPath: string = 'custom_modules';
  allowedModules: string[] = [];
  enableModuleHotReload: boolean = true;
  moduleLoadTimeout: number = 30000; // 30 seconds
  enableModuleSecurityValidation: boolean = true;
}

export default registerAs('gql', () => {
  // Validate subscription transport value
  const transportEnv = process.env.SUBSCRIPTION_TRANSPORT?.toLowerCase();
  const subscriptionTransport: SubscriptionTransport =
    transportEnv === 'ws' ? 'ws' : 'sse'; // Default to SSE

  const config = {
    playground: process.env.NODE_ENV !== 'production',
    introspection: process.env.NODE_ENV !== 'production',
    oidcJwksUri: process.env.OIDC_JKWS_URI,
    oidcIssuer: process.env.OIDC_ISSUER,
    oidcAudience: process.env.OIDC_AUDIENCE,
    queryDepthLimit: parseInt(process.env.GQL_QUERY_DEPTH_LIMIT || '10', 10),
    queryComplexityLimit: parseInt(process.env.GQL_QUERY_COMPLEXITY_LIMIT || '1000', 10),
    enableSubscriptions: process.env.GQL_ENABLE_SUBSCRIPTIONS !== 'false',
    subscriptionTransport,

    // Module Registry Configuration
    customModulesPath: process.env.CUSTOM_MODULES_PATH || 'custom_modules',
    allowedModules: process.env.ALLOWED_MODULES ? process.env.ALLOWED_MODULES.split(',').map(m => m.trim()) : [],
    enableModuleHotReload: process.env.ENABLE_MODULE_HOT_RELOAD !== 'false',
    moduleLoadTimeout: parseInt(process.env.MODULE_LOAD_TIMEOUT || '30000', 10),
    enableModuleSecurityValidation: process.env.NODE_ENV === 'production',
  };

  const validation = validateConfig(config);
  if (!validation.isValid) {
    throw new Error(`GraphQL configuration validation failed: ${validation.errors.join(', ')}`);
  }

  return config as GqlConfig;
});
