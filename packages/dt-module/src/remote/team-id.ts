/**
 * The deployment's team identifier — which team this deployment belongs to, so the content service can
 * scope what it serves. A person who belongs to two teams must not be served one team's content on the
 * other team's deployment, and the deployment is the only party that knows which team it is.
 *
 * It is read from the environment rather than passed down from the host, for the same reason the content
 * base URL is: the value is deployment-global, written into the process environment when the deployment
 * is connected, and constant for the life of the process.
 */

/**
 * The header the identifier travels in.
 *
 * Bound to the operator console's own constant by a parity test, because this client is not the only
 * sender. Two senders that disagree on this name is one of them scoping and the other not, and the
 * symptom — some content is scoped — is far harder to read than an outright failure.
 */
export const DEPLOYMENT_TEAM_HEADER = 'X-Deployment-Team';

/**
 * The shape an identifier must have: a character class and a bound, never an exact length. Pinning the
 * length would tie this client to the issuer's current format across a release boundary. Every character
 * it admits is already a valid HTTP header-value character, because a header is where the value goes.
 *
 * Bound to the console's pattern by the same parity test, and for a sharper reason than the name: if one
 * sender accepts an identifier the other rejects, half a deployment's calls are scoped and half are not.
 */
export const TEAM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Reads the deployment's team identifier from the environment, or `undefined` when there is none to read.
 *
 * A MALFORMED VALUE IS IGNORED RATHER THAN THROWN, BUT NOT SILENTLY. This runs inside a module resolver on
 * a platform the operator runs, and a resolver that dies because one environment variable is mistyped is a
 * worse answer than one that degrades. The console validates this same shape when it writes the value, so a
 * malformed one reaching here means the environment was edited past that check — which is worth a line in
 * the log, because the operator who made that edit is the only person who can undo it. The console's own
 * reader logs the equivalent case; this used to be the quiet half of the pair.
 *
 * WHAT DEGRADING COSTS HAS CHANGED, and the comment should not outlive the fact. With no identifier the
 * calls still go out naming no team. The content service still answers those while it establishes that
 * every deployment has been told its team; once it requires the header, they fail. So this is a choice
 * about *where* the failure surfaces — a running console with a logged warning, rather than a resolver
 * that will not start — and not a choice to avoid one.
 *
 * The logger is optional and falls back to `console.warn`, following `EmbeddingFileCache`. The rejected
 * value is passed as structured metadata rather than interpolated into the message.
 */
/**
 * The value, if it is usable as one; `undefined` otherwise. Never throws.
 *
 * THE ONE PLACE THE SHAPE IS ENFORCED, and it had to become that rather than stay inside the environment
 * reader. `TEAM_ID_PATTERN` was applied only by `deploymentTeamId()` below, so every caller that supplied
 * `teamId` directly — `RemoteModuleDeps`, `KgClientDeps`, `CloudKgClientOptions`, `WireClientOptions` —
 * bypassed validation entirely. The pattern was exported and the check was not reachable from where the
 * value actually goes on the wire. `WireClient` now calls this, which is the single point every sender
 * funnels through, so a supplied value is held to the same shape as a read one.
 */
export function usableTeamId(raw: string | undefined): string | undefined {
  if (!raw || !TEAM_ID_PATTERN.test(raw)) return undefined;
  return raw;
}

export function deploymentTeamId(
  env: NodeJS.ProcessEnv = process.env,
  logger: { warn: (msg: string, meta?: object) => void } = {
    warn: (msg, meta) => console.warn(msg, meta ?? {}),
  },
): string | undefined {
  const raw = env.DEPLOYMENT_TEAM_ID;
  if (!raw) return undefined;
  if (usableTeamId(raw) === undefined) {
    logger.warn(
      'DEPLOYMENT_TEAM_ID is not a usable team identifier and is being ignored; entitled calls from this ' +
        'deployment will name no team',
      { value: raw },
    );
    return undefined;
  }
  return raw;
}
