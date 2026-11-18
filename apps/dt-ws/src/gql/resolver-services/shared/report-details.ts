import { FORBIDDEN_DISPLAY_CHARS, codePoints, printableKeys } from '../../../common/utils/display-text';

/**
 * Report details: what a report needs to know about an analysis that the analysis does not hold itself, such as the
 * client a report is prepared for. They are stored as one JSON string, `metadata`, on every ANALYZED_BY edge into the
 * analysis, because neither graph database stores a map as a property. Everything here is pure; the resolver service
 * reads and writes the edges.
 */

/** The stored JSON string, counted in UTF-8 bytes. */
export const REPORT_DETAILS_MAX_BYTES = 4 * 1024;
/** The client name, the author and the project, each counted in code points. */
export const CLIENT_MAX = 120;
export const AUTHOR_MAX = 120;
export const PROJECT_MAX = 120;
/** Custom fields: how many, and a label's and a value's length in code points. */
export const CUSTOM_FIELDS_MAX = 10;
export const FIELD_LABEL_MAX = 40;
export const FIELD_VALUE_MAX = 120;

/** The keys this server reads and writes. A stored key it does not know is kept by a set and left out of a read. */
const KNOWN_KEYS: ReadonlySet<string> = new Set(['client', 'author', 'project', 'customFields', 'updated']);

/** A field the user added, printed in its own block on a report's cover. */
export interface ReportDetailField {
  label: string;
  value: string;
}

export interface ReportDetails {
  client: string | null;
  author: string | null;
  project: string | null;
  /** In the order the user gave them; null when there are none. */
  customFields: ReportDetailField[] | null;
  /** When the details were last set (ISO 8601, UTC), stamped by the server. */
  updated: string | null;
}

/**
 * A set's input: a key given is written, null clears it, and a key left out stays as it is. `customFields` is one key:
 * given, it replaces the whole list, and null or an empty list removes it.
 */
export interface ReportDetailsInput {
  client?: string | null;
  author?: string | null;
  project?: string | null;
  customFields?: ReportDetailField[] | null;
}

export type ReportDetailsErrorCode =
  | 'REPORT_DETAILS_CLIENT_TOO_LONG'
  | 'REPORT_DETAILS_CLIENT_CHARACTERS'
  | 'REPORT_DETAILS_AUTHOR_TOO_LONG'
  | 'REPORT_DETAILS_AUTHOR_CHARACTERS'
  | 'REPORT_DETAILS_PROJECT_TOO_LONG'
  | 'REPORT_DETAILS_PROJECT_CHARACTERS'
  | 'REPORT_DETAILS_FIELD_TOO_LONG'
  | 'REPORT_DETAILS_FIELD_CHARACTERS'
  | 'REPORT_DETAILS_FIELD_INCOMPLETE'
  | 'REPORT_DETAILS_FIELD_DUPLICATE'
  | 'REPORT_DETAILS_TOO_MANY_FIELDS'
  | 'REPORT_DETAILS_TOO_LARGE'
  | 'ANALYSIS_NOT_FOUND'
  | 'ANALYSIS_NOT_BOUND';

/**
 * A refusal the client tells apart by its code: in production an error's message is masked and only its code kept.
 * The message is logged before it is masked, so it is fixed text and never quotes the input.
 */
export class ReportDetailsError extends Error {
  constructor(
    readonly code: ReportDetailsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReportDetailsError';
  }
}

type Stored = Record<string, unknown>;

/** One edge's stored value as an object. `corrupt` when the edge held something other than a JSON object. */
export function parseStored(raw: unknown): { value: Stored; corrupt: boolean } {
  if (raw === null || raw === undefined) return { value: {}, corrupt: false };
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { value: parsed as Stored, corrupt: false };
      }
    } catch {
      // Not JSON: read as empty, like any other value that is not an object.
    }
  }
  return { value: {}, corrupt: true };
}

const updatedOf = (value: { updated?: unknown }): string => (typeof value.updated === 'string' ? value.updated : '');

/**
 * The newest of the edges' values by `updated`. A set writes the same value to every edge, so they differ only when an
 * edge was added since; ISO 8601 stamps in UTC compare as strings. On a tie a value beats an empty one, so an edge
 * that carries nothing never hides keys another edge holds.
 */
export function newest(values: Stored[]): Stored {
  const newer = (value: Stored, best: Stored) =>
    updatedOf(value) > updatedOf(best) ||
    (updatedOf(value) === updatedOf(best) && Object.keys(best).length === 0 && Object.keys(value).length > 0);
  return values.reduce<Stored>((best, value) => (newer(value, best) ? value : best), values[0] ?? {});
}

/**
 * A custom label as a reader sees it: composed (NFC), with the characters that render as nothing removed. Two labels
 * that look the same have the same key (any run of spaces counts as one), and a label must show at least one letter or
 * digit.
 */
export const visibleLabel = (label: string): string =>
  label.normalize('NFC').replace(/\p{Default_Ignorable_Code_Point}/gu, '');
const labelKey = (label: string): string => visibleLabel(label).replace(/\s+/gu, ' ').toLowerCase();
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

type NamedKey = 'client' | 'author' | 'project';
interface NamedRule {
  max: number;
  name: string;
  tooLong: ReportDetailsErrorCode;
  characters: ReportDetailsErrorCode;
}
const NAMED: Record<NamedKey, NamedRule> = {
  client: {
    max: CLIENT_MAX,
    name: 'The client name',
    tooLong: 'REPORT_DETAILS_CLIENT_TOO_LONG',
    characters: 'REPORT_DETAILS_CLIENT_CHARACTERS',
  },
  author: {
    max: AUTHOR_MAX,
    name: 'The author',
    tooLong: 'REPORT_DETAILS_AUTHOR_TOO_LONG',
    characters: 'REPORT_DETAILS_AUTHOR_CHARACTERS',
  },
  project: {
    max: PROJECT_MAX,
    name: 'The project',
    tooLong: 'REPORT_DETAILS_PROJECT_TOO_LONG',
    characters: 'REPORT_DETAILS_PROJECT_CHARACTERS',
  },
};

/** What is wrong with a trimmed named value, or null when nothing is. */
function namedProblem(key: NamedKey, text: string): ReportDetailsError | null {
  const { max, name, tooLong, characters } = NAMED[key];
  if (codePoints(text) > max) return new ReportDetailsError(tooLong, `${name} is longer than ${max} characters`);
  if (FORBIDDEN_DISPLAY_CHARS.test(text)) {
    return new ReportDetailsError(characters, `${name} contains a control or text-direction character`);
  }
  return null;
}

/** What is wrong with a trimmed custom field, or null when nothing is. The duplicate check is the caller's. */
function fieldProblem(label: string, value: string): ReportDetailsError | null {
  if (label === '' || value === '') {
    return new ReportDetailsError('REPORT_DETAILS_FIELD_INCOMPLETE', 'A custom field needs both a label and a value');
  }
  if (codePoints(label) > FIELD_LABEL_MAX || codePoints(value) > FIELD_VALUE_MAX) {
    return new ReportDetailsError(
      'REPORT_DETAILS_FIELD_TOO_LONG',
      `A custom field's label is longer than ${FIELD_LABEL_MAX} characters or its value longer than ${FIELD_VALUE_MAX}`,
    );
  }
  if (FORBIDDEN_DISPLAY_CHARS.test(label) || FORBIDDEN_DISPLAY_CHARS.test(value)) {
    return new ReportDetailsError(
      'REPORT_DETAILS_FIELD_CHARACTERS',
      'A custom field contains a control or text-direction character',
    );
  }
  if (!LETTER_OR_DIGIT.test(visibleLabel(label))) {
    return new ReportDetailsError(
      'REPORT_DETAILS_FIELD_INCOMPLETE',
      "A custom field's label has no visible letter or digit",
    );
  }
  return null;
}

/**
 * The client name, author or project a set writes: undefined leaves the stored one, null or blank clears it, and
 * anything else is trimmed and must be at most its maximum in code points, with no control or text-direction character.
 */
export function checkText(key: NamedKey, text: string | null | undefined): string | null | undefined {
  if (text === undefined) return undefined;
  if (text === null) return null;
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const problem = namedProblem(key, trimmed);
  if (problem) throw problem;
  return trimmed;
}

/**
 * The custom fields a set writes: undefined leaves the stored list, null or an empty list clears it, and anything else
 * is at most CUSTOM_FIELDS_MAX fields, each trimmed, with a label that shows a letter or digit, unique as a reader sees
 * it, ignoring case.
 */
export function checkCustomFields(
  fields: ReportDetailField[] | null | undefined,
): ReportDetailField[] | null | undefined {
  if (fields === undefined) return undefined;
  if (fields === null || fields.length === 0) return null;
  if (fields.length > CUSTOM_FIELDS_MAX) {
    throw new ReportDetailsError('REPORT_DETAILS_TOO_MANY_FIELDS', `At most ${CUSTOM_FIELDS_MAX} custom fields`);
  }
  const seen = new Set<string>();
  return fields.map((field) => {
    const label = field.label.trim();
    const value = field.value.trim();
    const problem = fieldProblem(label, value);
    if (problem) throw problem;
    const key = labelKey(label);
    if (seen.has(key)) {
      throw new ReportDetailsError('REPORT_DETAILS_FIELD_DUPLICATE', 'Two custom fields have the same label');
    }
    seen.add(key);
    return { label, value };
  });
}

/** Every key of a set's input, checked: what each key writes (see checkText and checkCustomFields). */
export function checkInput(input: ReportDetailsInput): ReportDetailsInput {
  return {
    client: checkText('client', input.client),
    author: checkText('author', input.author),
    project: checkText('project', input.project),
    customFields: checkCustomFields(input.customFields),
  };
}

/** A stored named value as a read returns it: dropped when it would not pass a set's check. */
function readText(key: NamedKey, stored: unknown): string | null {
  if (typeof stored !== 'string') return null;
  const trimmed = stored.trim();
  return trimmed !== '' && namedProblem(key, trimmed) === null ? trimmed : null;
}

/**
 * Stored custom fields as a read returns them. A stored value is not trusted, since it can be written to the database
 * by hand: the first CUSTOM_FIELDS_MAX fields that would pass a set's check are kept, each as a label and a value only,
 * and later duplicates are dropped.
 */
function readCustomFields(stored: unknown): ReportDetailField[] | null {
  if (!Array.isArray(stored)) return null;
  const kept: ReportDetailField[] = [];
  const seen = new Set<string>();
  for (const entry of stored) {
    if (kept.length === CUSTOM_FIELDS_MAX) break;
    if (entry === null || typeof entry !== 'object') continue;
    const { label, value } = entry as Record<string, unknown>;
    if (typeof label !== 'string' || typeof value !== 'string') continue;
    const field = { label: label.trim(), value: value.trim() };
    if (fieldProblem(field.label, field.value) !== null) continue;
    const key = labelKey(field.label);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(field);
  }
  return kept.length > 0 ? kept : null;
}

/** What a read returns: the known keys of a stored value, each dropped (null) when it would not pass a set's check. */
export function toDetails(value: Stored): ReportDetails {
  return {
    client: readText('client', value.client),
    author: readText('author', value.author),
    project: readText('project', value.project),
    customFields: readCustomFields(value.customFields),
    updated: typeof value.updated === 'string' ? value.updated : null,
  };
}

/**
 * The JSON a set writes: the stored value with the input merged in by key, unknown keys kept, and `updated` stamped.
 * A known key is kept as a read returns it, so a value written to the database by hand that a read leaves out does not
 * stay behind. Refused when it is over the size cap; the refusal names the kept unknown keys, which are then what makes
 * it large.
 */
export function mergeDetails(stored: Stored, input: ReportDetailsInput, now: string): string {
  const merged: Stored = { ...stored };
  const read = toDetails(stored);
  for (const key of ['client', 'author', 'project', 'customFields'] as const) {
    if (read[key] === null) delete merged[key];
    else merged[key] = read[key];
  }
  for (const [key, value] of Object.entries(checkInput(input))) {
    if (value === null) delete merged[key];
    else if (value !== undefined) merged[key] = value;
  }
  merged.updated = now;
  const json = JSON.stringify(merged);
  if (Buffer.byteLength(json, 'utf8') <= REPORT_DETAILS_MAX_BYTES) return json;
  const unknown = Object.keys(stored).filter((key) => !KNOWN_KEYS.has(key));
  throw new ReportDetailsError(
    'REPORT_DETAILS_TOO_LARGE',
    unknown.length > 0
      ? `The report details would be over ${REPORT_DETAILS_MAX_BYTES} bytes, mostly in keys this server does not ` +
          `know: ${printableKeys(unknown)}`
      : `The report details would be over ${REPORT_DETAILS_MAX_BYTES} bytes`,
  );
}

const hasDetail = (details: ReportDetails): boolean =>
  details.client !== null || details.author !== null || details.project !== null || details.customFields !== null;

/**
 * The newest of other analyses' details that holds anything besides `updated`, read as a read returns it, offered as a
 * suggestion; null when none does.
 */
export function suggestion(values: Stored[]): ReportDetails | null {
  const candidates = values.map(toDetails).filter(hasDetail);
  if (candidates.length === 0) return null;
  return candidates.reduce((best, details) => (updatedOf(details) > updatedOf(best) ? details : best));
}
