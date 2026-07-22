/**
 * `@dethernety/dt-module/testing` — the dev/test-only surface.
 *
 * Ships the in-process mock content service, its fixtures, and the parameterized
 * contract suite, so a platform developer can run a remote-module setup against
 * fixtures with no cloud, and the same suite can later gate the real service.
 * This subpath MUST NOT be imported by the package's main entry.
 */
export { MockContentServer } from './mock-content-server';
export type { FailureMode, CapturedRequest } from './mock-content-server';
export * from './fixtures';
export { runContractSuite } from './contract/suite';
export type { ContractHarness } from './contract/suite';
