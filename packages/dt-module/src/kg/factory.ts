/**
 * Mode selection for the knowledge-graph client.
 *
 * Which implementation a deployment gets follows its configuration, not introspection: a module's
 * resolver context carries a driver, a logger and a database name, and has no view of which other
 * modules are loaded. So the two environment variables decide, and nothing above the interface
 * ever learns which implementation it was handed.
 *
 * | `MODULE_KG_BASE_URL` | `MODULE_KG_VERSION` | result |
 * |---|---|---|
 * | set | a valid digest | remote |
 * | set | absent or malformed | unavailable, logged as a misconfiguration |
 * | unset | — | local — which reports itself unavailable when the graph holds no such nodes |
 *
 * **Neither variable has a default.** An unconfigured deployment goes inert rather than pointing
 * itself at a host, the same rule the content client follows.
 *
 * **A missing pin never falls back to "latest".** The service publishes a newest version, and
 * taking it would silently advance the knowledge graph under a deployment that pinned deliberately
 * — so a half-configured remote mode is as inert as an unconfigured one.
 *
 * The fourth row of the specification's table — no service, no local nodes — is not a branch here.
 * It cannot be: deciding it means asking the database, and this call is synchronous because the
 * module constructors that use it are. The local client carries the probe instead, reports
 * `available: false` from it, and refuses to answer queries rather than returning empty.
 */
import { Logger } from '@nestjs/common';
import { KgClient } from '../interfaces/kg-client-interface';
import { FetchLike } from '../remote/wire-client';
import { CloudKgClient } from './cloud-client';
import { LocalKgClient } from './local-client';
import { UnavailableKgClient } from './unavailable-client';

/** The pinned version, as published: a content digest and nothing else. */
const VERSION_PATTERN = /^sha256:[0-9a-f]{64}$/;

export interface KgClientContext {
  /** The bolt driver the module received. Typed `any` — this package carries no driver dependency. */
  driver: any;
  logger?: Logger;
  /** `undefined` means the server's default database. */
  databaseName?: string;
}

/** Test seams. The two configuration values fall back to the environment, mirroring how the
 * content client is configured; the transport is injected only by tests. */
export interface KgClientDeps {
  baseUrl?: string;
  version?: string;
  /** An in-process transport, so the remote path is exercised with no sockets and no credentials. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export function createKgClient(ctx: KgClientContext, deps?: KgClientDeps): KgClient {
  const baseUrl = deps?.baseUrl ?? process.env.MODULE_KG_BASE_URL;
  const version = deps?.version ?? process.env.MODULE_KG_VERSION;

  if (baseUrl) {
    if (version && VERSION_PATTERN.test(version)) {
      return new CloudKgClient({
        baseUrl,
        version,
        fetchImpl: deps?.fetchImpl,
        timeoutMs: deps?.timeoutMs,
      });
    }
    // Logged once, at construction, because this is the only moment an operator can be told: the
    // deployment named a service and then never asked it anything, and every later symptom is an
    // absence. The value is not logged — it is configuration, and a malformed one is still theirs.
    ctx.logger?.warn(
      'A knowledge-graph service is configured but its version pin is absent or malformed; ' +
        'the knowledge graph is unavailable. Set MODULE_KG_VERSION to a published sha256 digest.',
    );
    return new UnavailableKgClient();
  }

  return new LocalKgClient({ driver: ctx.driver, logger: ctx.logger, databaseName: ctx.databaseName });
}
