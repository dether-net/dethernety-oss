/** The longest client name the server takes, counted as people count characters (code points). */
export const CLIENT_MAX = 120

/** A string's length in code points, so a character outside the BMP (an emoji, say) counts once, as on the server. */
export const codePointLength = (text: string): number => [...text].length

/**
 * What the dialog says when the server refuses a save. In production an error's message is masked and only its code
 * reaches the browser, so the text is chosen by code.
 */
const MESSAGES: Record<string, string> = {
  REPORT_DETAILS_CLIENT_TOO_LONG: `The client name is longer than ${CLIENT_MAX} characters.`,
  REPORT_DETAILS_CLIENT_CHARACTERS:
    'The client name contains a character a report cannot print, such as a control, text-direction or invisible character.',
  REPORT_DETAILS_TOO_LARGE: 'The report details are too large to save.',
  ANALYSIS_NOT_FOUND: 'This analysis no longer exists.',
  ANALYSIS_NOT_BOUND: 'This analysis is not bound to a model element, so it cannot have report details.',
  UNAUTHENTICATED: 'Your session has ended. Sign in again, then save.',
  FORBIDDEN: 'You are not allowed to change the report details of this analysis.',
}
const FALLBACK = "The report details couldn't be saved. Try again."

/** The error code of a failed GraphQL call, wherever the client library put it. */
function errorCode(error: unknown): string | undefined {
  const e = error as {
    errors?: { extensions?: { code?: unknown } }[]
    graphQLErrors?: { extensions?: { code?: unknown } }[]
    extensions?: { code?: unknown }
  } | null
  const code = e?.errors?.[0]?.extensions?.code ?? e?.graphQLErrors?.[0]?.extensions?.code ?? e?.extensions?.code
  return typeof code === 'string' ? code : undefined
}

/** The message for a refused save. */
export function saveErrorMessage(error: unknown): string {
  return MESSAGES[errorCode(error) ?? ''] ?? FALLBACK
}
