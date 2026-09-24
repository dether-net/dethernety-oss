/**
 * Secret redaction.
 *
 * The server never puts a token into a tool result on purpose, but it does relay
 * text it does not control: platform error messages, a proxy's error page, the
 * bundled GraphQL layer's own stderr logging. A server that echoes the request's
 * `Authorization` header back in an error would otherwise hand the bearer to the
 * model through whichever tool happened to fail.
 *
 * So every session secret this process handles is registered here, and the two
 * places text leaves the process — tool results and stderr — pass through
 * `redactSecrets`. Exact values only: a pattern ("anything that looks like a
 * JWT") would also rewrite model data and would hide a registration that stopped
 * happening, because the pattern would still catch the token in a test.
 */

const REDACTED = '[redacted]'

/** Shorter values are too likely to occur in ordinary text to be replaced safely. */
const MIN_SECRET_LENGTH = 16

const secrets = new Set<string>()

/** Remember session secrets so later output can be scrubbed of them. Non-strings are ignored. */
export function registerSecret(...values: unknown[]): void {
  for (const value of values) {
    if (typeof value === 'string' && value.length >= MIN_SECRET_LENGTH) {
      secrets.add(value)
    }
  }
}

/** Replace every registered secret in `text`. */
export function redactSecrets(text: string): string {
  let out = text
  for (const secret of secrets) {
    if (out.includes(secret)) {
      out = out.split(secret).join(REDACTED)
    }
  }
  return out
}

let stderrWrapped = false

/**
 * Route everything written to stderr through `redactSecrets`.
 *
 * stderr is the one sink every logger in the process shares — `debug()`, the
 * bundled GraphQL layer's `console.error`, Node's own warnings — so wrapping it
 * once covers writers this package does not own. Idempotent.
 */
export function redactStderr(): void {
  if (stderrWrapped) return
  stderrWrapped = true
  const write = process.stderr.write.bind(process.stderr) as (...args: unknown[]) => boolean
  process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (secrets.size > 0) {
      if (typeof chunk === 'string') {
        chunk = redactSecrets(chunk)
      } else if (chunk instanceof Uint8Array) {
        // latin1 maps every byte to one character and back, so the chunk keeps its
        // exact bytes and its type; the secrets are ASCII and match the same way.
        const text = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('latin1')
        chunk = Buffer.from(redactSecrets(text), 'latin1')
      }
    }
    return write(chunk, ...rest)
  }) as typeof process.stderr.write
}
