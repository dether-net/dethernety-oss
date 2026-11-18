/**
 * The limits the server puts on report details, counted as people count characters (code points). The server enforces
 * them; the dialog mirrors them so a user sees the problem before saving.
 */
export const CLIENT_MAX = 120
export const AUTHOR_MAX = 120
export const PROJECT_MAX = 120
export const CUSTOM_FIELDS_MAX = 10
export const FIELD_LABEL_MAX = 40
export const FIELD_VALUE_MAX = 120
/** The stored details as JSON, in UTF-8 bytes. */
export const REPORT_DETAILS_MAX_BYTES = 4 * 1024

/** A string's length in code points, so a character outside the BMP (an emoji, say) counts once, as on the server. */
export const codePointLength = (text: string): number => [...text].length

/**
 * A custom label as a reader sees it, as the server reads it: composed (NFC), with the characters that render as
 * nothing removed. A label must show a letter or digit.
 */
export const visibleLabel = (label: string): string =>
  label.normalize('NFC').replace(/\p{Default_Ignorable_Code_Point}/gu, '')

/**
 * Two labels with the same key are the same label to the server: as a reader sees them, any run of spaces as one,
 * ignoring case.
 */
export const labelKey = (label: string): string => visibleLabel(label).replace(/\s+/gu, ' ').toLowerCase()

export const hasLetterOrDigit = (label: string): boolean => /[\p{L}\p{N}]/u.test(visibleLabel(label))

/** The details a save would store, as the server writes them: the size the server counts against the cap. */
export function storedSize(details: Record<string, unknown>): number {
  // The server stamps `updated`; its length is the same for every save.
  const json = JSON.stringify({ ...details, updated: new Date(0).toISOString() })
  return new TextEncoder().encode(json).length
}

const CHARACTERS = 'a character a report cannot print, such as a control, text-direction or invisible character'

/**
 * What the dialog says when the server refuses a save. In production an error's message is masked and only its code
 * reaches the browser, so the text is chosen by code.
 */
const MESSAGES: Record<string, string> = {
  REPORT_DETAILS_CLIENT_TOO_LONG: `The client name is longer than ${CLIENT_MAX} characters.`,
  REPORT_DETAILS_CLIENT_CHARACTERS: `The client name contains ${CHARACTERS}.`,
  REPORT_DETAILS_AUTHOR_TOO_LONG: `The author is longer than ${AUTHOR_MAX} characters.`,
  REPORT_DETAILS_AUTHOR_CHARACTERS: `The author contains ${CHARACTERS}.`,
  REPORT_DETAILS_PROJECT_TOO_LONG: `The project is longer than ${PROJECT_MAX} characters.`,
  REPORT_DETAILS_PROJECT_CHARACTERS: `The project contains ${CHARACTERS}.`,
  REPORT_DETAILS_FIELD_TOO_LONG:
    `A custom field's label is longer than ${FIELD_LABEL_MAX} characters, or its value longer than ${FIELD_VALUE_MAX}.`,
  REPORT_DETAILS_FIELD_CHARACTERS: `A custom field contains ${CHARACTERS}.`,
  REPORT_DETAILS_FIELD_INCOMPLETE: 'Every custom field needs a value and a label with a letter or digit.',
  REPORT_DETAILS_FIELD_DUPLICATE: 'Two custom fields have the same label.',
  REPORT_DETAILS_TOO_MANY_FIELDS: `At most ${CUSTOM_FIELDS_MAX} custom fields.`,
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
