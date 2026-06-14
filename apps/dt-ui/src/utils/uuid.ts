/**
 * RFC-4122 v4 UUID generator that works in BOTH secure and insecure contexts.
 *
 * `crypto.randomUUID()` is only exposed in a "secure context" (HTTPS or
 * `localhost`). When the app is served over plain `http://<ip>` (e.g. a
 * self-hosted appliance reached by IP without TLS), `crypto.randomUUID` is
 * `undefined` and calling it throws. `crypto.getRandomValues()`, by contrast,
 * is available in insecure contexts too — so we fall back to it and assemble a
 * v4 UUID by hand.
 *
 * This mirrors how `authStore` already guards `crypto.subtle` behind
 * `isSecureContext`: the UI is meant to run over plain HTTP, so UUID generation
 * must not assume a secure context.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  // Fallback: 16 random bytes, set the version (4) and variant (10xx) bits per
  // RFC 4122 §4.4, then format as 8-4-4-4-12 hex.
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10xx

  const hex: string[] = []
  for (let i = 0; i < 16; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'))
  }
  return (
    hex.slice(0, 4).join('') +
    '-' +
    hex.slice(4, 6).join('') +
    '-' +
    hex.slice(6, 8).join('') +
    '-' +
    hex.slice(8, 10).join('') +
    '-' +
    hex.slice(10, 16).join('')
  )
}
