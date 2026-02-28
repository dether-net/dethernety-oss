/**
 * Extract Bearer token from Authorization header.
 * Case-insensitive "Bearer" prefix, rejects malformed headers.
 */
export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = header.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}
