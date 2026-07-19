import { gqlSchemaFactory } from '../schema.module';

/**
 * Ordering pin for the GQL_SCHEMA build recipe — this seam IS the original
 * bug (the SSE/health paths built schemas without these steps). Modules
 * must load BEFORE fragments are read; fragments must be handed to the
 * service BEFORE the build; the build must receive the merged platform
 * resolvers plus the module resolvers.
 */
describe('gqlSchemaFactory', () => {
  it('loads modules, threads fragments, and passes merged + module resolvers to the build — in order', async () => {
    const calls: string[] = [];
    const fragments = ['extend type Query { m: String }'];
    const moduleResolvers = [{ moduleName: 'mod-a', resolvers: {} }];
    const mergedPlatform = { Query: { ping: () => 'pong' } };
    const builtSchema = { __schema: true };

    const moduleRegistry: any = {
      loadModules: jest.fn(async () => {
        await Promise.resolve(); // async gap — catches a dropped await
        calls.push('loadModules');
      }),
      getSchemaFragments: jest.fn(() => {
        calls.push('getSchemaFragments');
        return fragments;
      }),
      getModuleResolvers: jest.fn(() => moduleResolvers),
    };
    const schemaService: any = {
      setModuleSchemaFragments: jest.fn(() => calls.push('setFragments')),
      mergeResolvers: jest.fn(() => mergedPlatform),
      buildSchemaWithResolvers: jest.fn(async () => {
        calls.push('build');
        return builtSchema;
      }),
    };
    const resolverServices: any[] = [{ getResolvers: () => ({}) }];

    const schema = await gqlSchemaFactory(
      schemaService,
      resolverServices,
      moduleRegistry,
    );

    expect(schema).toBe(builtSchema);
    expect(calls).toEqual(['loadModules', 'getSchemaFragments', 'setFragments', 'build']);
    expect(schemaService.setModuleSchemaFragments).toHaveBeenCalledWith(fragments);
    expect(schemaService.mergeResolvers).toHaveBeenCalledWith(resolverServices);
    expect(schemaService.buildSchemaWithResolvers).toHaveBeenCalledWith(
      mergedPlatform,
      moduleResolvers,
    );
  });
});
