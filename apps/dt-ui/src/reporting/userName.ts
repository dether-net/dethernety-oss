const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// One token of 20 or more id characters with a digit in it: what an identity provider's subject id looks like.
const OPAQUE_TOKEN = /^(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}$/

/**
 * The name a report prints as "exported by", from the signed-in user's display name. Null when there is no name to
 * print: an empty value, the 'Unknown' fallback, or an opaque subject id (a UUID, or one long token with a digit), so
 * an identity provider's internal id is never printed as a person's name.
 */
export function reportUserName(name: unknown): string | null {
  const value = typeof name === 'string' ? name.trim() : ''
  if (!value || value === 'Unknown' || UUID.test(value) || OPAQUE_TOKEN.test(value)) return null
  return value
}
