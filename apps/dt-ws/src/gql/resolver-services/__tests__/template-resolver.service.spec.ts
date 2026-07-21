import { TemplateResolverService } from '../template-resolver.service';
import { ConfigService } from '@nestjs/config';
import { ModuleRegistryService } from '../../module-management-services/module-registry.service';
import { AuthorizationService } from '../../services/authorization.service';
import { MonitoringService } from '../../services/monitoring.service';
import { TemplateCacheService } from '../../services/template-cache.service';

/**
 * Per-request token threading + caller-variant cache bypass for class template/guide.
 *
 * The field resolvers had a latent signature defect — `async ({ id, module }, context)`
 * bound graphql-js's `args` (position 2) to the param named `context`, so the real
 * GraphQLContext (position 3) was never captured and the caller token never reached the
 * module. The fix inserts `_args` so `context` captures position 3; the token then threads
 * (as an additive param) into moduleInstance.getClassTemplate/getClassGuide. A module that
 * declares isContentCallerVariant() bypasses the shared template cache entirely.
 *
 * These are the first tests of this service (previously zero coverage).
 */

type ModuleFixture = {
  getClassTemplate: jest.Mock;
  getClassGuide: jest.Mock;
  isContentCallerVariant?: () => boolean;
};

function makeService(moduleFixture?: ModuleFixture) {
  const fixture: ModuleFixture =
    moduleFixture ?? {
      getClassTemplate: jest.fn(async () => 'TPL'),
      getClassGuide: jest.fn(async () => 'GUIDE'),
    };

  const getModuleByName = jest.fn(() => fixture);
  const moduleRegistry: any = { getModuleByName };
  const configService: any = { get: jest.fn(() => ({})) }; // GqlConfig — truthy
  const authorizationService: any = {
    // Mirror the real extractAuthContext: copy the raw bearer + user off the context.
    extractAuthContext: (c: any) => ({ user: c?.user, token: c?.token, sessionId: c?.sessionId }),
    checkAuthorization: jest.fn(async () => ({ allowed: true })),
  };
  const monitoringService: any = { recordOperation: jest.fn() };
  const templateCache: any = { get: jest.fn(() => null), set: jest.fn() };
  const neo4jDriver: any = {};

  const service = new TemplateResolverService(
    neo4jDriver,
    moduleRegistry as ModuleRegistryService,
    configService as ConfigService,
    authorizationService as AuthorizationService,
    monitoringService as MonitoringService,
    templateCache as TemplateCacheService,
  );
  return { service, fixture, getModuleByName, templateCache };
}

const MODULE = [{ name: 'mod-1' }];

describe('TemplateResolverService — per-request token threading', () => {
  it('field resolver forwards the position-3 context token into getClassTemplate (signature-fix guard)', async () => {
    // If the `_args` signature fix is reverted, `context` binds args ({}) and the token is
    // undefined — this assertion would then fail. That is the point of the test.
    const { service, fixture } = makeService();
    const resolvers = service.getResolvers();

    await resolvers.ComponentClass.template(
      { id: 'c1', module: MODULE },
      {}, // graphql-js args (position 2)
      { user: { sub: 'u' }, token: 'bearer-xyz' }, // real context (position 3)
    );

    expect(fixture.getClassTemplate).toHaveBeenCalledWith('c1', 'bearer-xyz');
  });

  it('field resolver forwards the token into getClassGuide', async () => {
    const { service, fixture } = makeService();
    const resolvers = service.getResolvers();

    await resolvers.ComponentClass.guide(
      { id: 'c1', module: MODULE },
      {},
      { user: { sub: 'u' }, token: 'bearer-xyz' },
    );

    expect(fixture.getClassGuide).toHaveBeenCalledWith('c1', 'bearer-xyz');
  });

  it('direct getClassTemplate/getClassGuide pass the token through to the module', async () => {
    const { service, fixture } = makeService();

    const tpl = await service.getClassTemplate('c1', MODULE, undefined, 'bearer-xyz');
    expect(fixture.getClassTemplate).toHaveBeenCalledWith('c1', 'bearer-xyz');
    expect(tpl.success).toBe(true);
    expect(tpl.content).toBe('TPL');

    const guide = await service.getClassGuide('c1', MODULE, undefined, 'bearer-xyz');
    expect(fixture.getClassGuide).toHaveBeenCalledWith('c1', 'bearer-xyz');
    expect(guide.success).toBe(true);
    expect(guide.content).toBe('GUIDE');
  });

  it('absence: token is undefined (dev/NOAUTH) and the module still answers', async () => {
    const { service, fixture } = makeService();

    const tpl = await service.getClassTemplate('c1', MODULE, undefined, undefined);
    expect(fixture.getClassTemplate).toHaveBeenCalledWith('c1', undefined);
    expect(tpl.success).toBe(true);
  });
});

describe('TemplateResolverService — caller-variance / caching', () => {
  it('a caller-independent module uses the shared cache (unchanged behavior)', async () => {
    const { service, templateCache } = makeService(); // no isContentCallerVariant

    await service.getClassTemplate('c1', MODULE, undefined, 'A');
    expect(templateCache.get).toHaveBeenCalledWith('template', 'mod-1', 'c1');
    expect(templateCache.set).toHaveBeenCalledWith('template', 'mod-1', 'TPL', 'c1');

    // A subsequent request served from cache reports source 'cache'.
    templateCache.get.mockReturnValueOnce('TPL');
    const cached = await service.getClassTemplate('c1', MODULE, undefined, 'A');
    expect(cached.source).toBe('cache');
    expect(cached.content).toBe('TPL');
  });

  it('a caller-variant module bypasses the cache entirely (no leak across callers)', async () => {
    const fixture: ModuleFixture = {
      getClassTemplate: jest.fn(async () => 'TPL'),
      getClassGuide: jest.fn(async () => 'GUIDE'),
      isContentCallerVariant: () => true,
    };
    const { service, templateCache } = makeService(fixture);

    await service.getClassTemplate('c1', MODULE, undefined, 'A');
    await service.getClassTemplate('c1', MODULE, undefined, 'B');

    // Neither read nor written — so user B can never be served user A's content.
    expect(templateCache.get).not.toHaveBeenCalled();
    expect(templateCache.set).not.toHaveBeenCalled();
    // The module is invoked on every call, with the current caller's token.
    expect(fixture.getClassTemplate).toHaveBeenCalledTimes(2);
    expect(fixture.getClassTemplate).toHaveBeenLastCalledWith('c1', 'B');
  });

  it('caller-variant bypass also applies to getClassGuide', async () => {
    const fixture: ModuleFixture = {
      getClassTemplate: jest.fn(async () => 'TPL'),
      getClassGuide: jest.fn(async () => 'GUIDE'),
      isContentCallerVariant: () => true,
    };
    const { service, templateCache } = makeService(fixture);

    await service.getClassGuide('c1', MODULE, undefined, 'A');

    expect(templateCache.get).not.toHaveBeenCalled();
    expect(templateCache.set).not.toHaveBeenCalled();
    expect(fixture.getClassGuide).toHaveBeenCalledWith('c1', 'A');
  });
});
