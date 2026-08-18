export * from './interfaces/module-interface';
export * from './interfaces/securityboundary-class-metadata-interface';
export * from './interfaces/component-class-metadata-interface';
export * from './interfaces/dataflow-class-metadata-interface';
export * from './interfaces/data-class-metadata-interface';
export * from './interfaces/control-class-metadata-interface';
export * from './interfaces/analysis-class-metadata-interface';
export * from './interfaces/module-metadata-interface';
export * from './interfaces/mitre-ref-interface';
export * from './interfaces/exposure-interface';
export * from './interfaces/countermeasure-interface';
export * from './interfaces/lg-analysis-config-interface';
export * from './interfaces/module-resolver-interface';
export * from './interfaces/kg-client-interface';

export * from './db-ops';
export { createKgClient } from './kg/factory';
export type { KgClientContext, KgClientDeps } from './kg/factory';
export { KgUnavailableError } from './kg/unavailable-client';
export { DtRemoteKnowledgeGraphModule } from './kg/remote-kg-module';
/** The capability fragment, shared so a locally-installed knowledge-graph module declares exactly
 * the same field — the whole point being that a consumer's selection validates in either mode. */
export { KG_CAPABILITY_SDL } from './kg/schema';
/** The whole remote fragment. Exported so a consumer can PROVE its document validates against the
 * surface a cloud-mode deployment serves, rather than establishing it by reading two files. The
 * field list is deliberately narrower than the local schema's, and a consumer selecting outside it
 * fails at query validation — which is only useful if the consumer can check before shipping. */
export { KG_REMOTE_SDL } from './kg/schema';
/** Exported for a module that IS the local graph and should say so, rather than going through the
 * factory and risking a stray service URL turning its own probe into a network call. */
export { LocalKgClient } from './kg/local-client';
export * from './embedding-file-cache';
export * from './embedding-text';
export * from './dt-file-opa-module';
export * from './dt-remote-module';
export {
  CloudSessionExpiredError,
  EvaluationNotEntitledError,
  RemoteModuleUnavailableError,
  ContentRecalledError,
  RemoteModuleMisconfiguredError,
} from './remote/errors';
export type { DenialInfo, RecallInfo, WireErrorCode } from './remote/errors';
export * from './rego-engine';
export * from './rego-lint';
export * from './rego-adhoc';
export * from './rego-builtins';
export * from './rego-mapping';
export * from './dt-lg-analysis-ops';
export * from './dt-lg-document-ops';
export * from './dt-lg-module';
export * from './schema-utils';
export * from './constants';
export * from './identity';