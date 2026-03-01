/**
 * Return error details only in non-production environments.
 * In production, returns a generic fallback message to prevent
 * leaking internal details (stack traces, DB errors, paths) to clients.
 */
export function safeErrorMessage(error: unknown, fallback = 'Operation failed'): string {
  if (process.env.NODE_ENV === 'production') return fallback;
  return error instanceof Error ? error.message : fallback;
}
