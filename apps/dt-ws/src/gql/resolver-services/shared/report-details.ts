import { FORBIDDEN_DISPLAY_CHARS, codePoints, printableKeys } from '../../../common/utils/display-text';

/**
 * Report details: what a report needs to know about an analysis that the analysis does not hold itself, such as the
 * client a report is prepared for. They are stored as one JSON string, `metadata`, on every ANALYZED_BY edge into the
 * analysis, because neither graph database stores a map as a property. Everything here is pure; the resolver service
 * reads and writes the edges.
 */

/** The stored JSON string, counted in UTF-8 bytes. */
export const REPORT_DETAILS_MAX_BYTES = 4 * 1024;
/** The client name, counted in code points. */
export const CLIENT_MAX = 120;

/** The keys this server reads and writes. A stored key it does not know is kept by a set and left out of a read. */
const KNOWN_KEYS: ReadonlySet<string> = new Set(['client', 'updated']);

export interface ReportDetails {
  client: string | null;
  /** When the details were last set (ISO 8601, UTC), stamped by the server. */
  updated: string | null;
}

/** A set's input: a key given is written, null clears it, and a key left out stays as it is. */
export interface ReportDetailsInput {
  client?: string | null;
}

export type ReportDetailsErrorCode =
  | 'REPORT_DETAILS_CLIENT_TOO_LONG'
  | 'REPORT_DETAILS_CLIENT_CHARACTERS'
  | 'REPORT_DETAILS_TOO_LARGE'
  | 'ANALYSIS_NOT_FOUND'
  | 'ANALYSIS_NOT_BOUND';

/** A refusal the client tells apart by its code: in production an error's message is masked and only its code kept. */
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

const updatedOf = (value: Stored): string => (typeof value.updated === 'string' ? value.updated : '');

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

/** What a read returns: the known keys of a stored value, each a string or null. */
export function toDetails(value: Stored): ReportDetails {
  return {
    client: typeof value.client === 'string' ? value.client : null,
    updated: typeof value.updated === 'string' ? value.updated : null,
  };
}

/**
 * The client name a set writes: undefined leaves the stored one, null or blank clears it, and anything else is trimmed
 * and must be at most CLIENT_MAX code points of text with no control or text-direction character.
 */
export function checkClient(client: string | null | undefined): string | null | undefined {
  if (client === undefined) return undefined;
  if (client === null) return null;
  const trimmed = client.trim();
  if (trimmed === '') return null;
  if (codePoints(trimmed) > CLIENT_MAX) {
    throw new ReportDetailsError(
      'REPORT_DETAILS_CLIENT_TOO_LONG',
      `The client name is longer than ${CLIENT_MAX} characters`,
    );
  }
  if (FORBIDDEN_DISPLAY_CHARS.test(trimmed)) {
    throw new ReportDetailsError(
      'REPORT_DETAILS_CLIENT_CHARACTERS',
      'The client name contains a control or text-direction character',
    );
  }
  return trimmed;
}

/**
 * The JSON a set writes: the stored value with the input merged in by key, unknown keys kept, and `updated` stamped.
 * Refused when it is over the size cap; the refusal names the kept unknown keys, which are then what makes it large.
 */
export function mergeDetails(stored: Stored, input: ReportDetailsInput, now: string): string {
  const merged: Stored = { ...stored };
  const client = checkClient(input.client);
  if (client === null) delete merged.client;
  else if (client !== undefined) merged.client = client;
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

/** The newest client name among other analyses' details, offered as a suggestion; null when none has one. */
export function suggestion(values: Stored[]): ReportDetails | null {
  const withClient = values.filter((value) => typeof value.client === 'string' && value.client !== '');
  return withClient.length > 0 ? toDetails(newest(withClient)) : null;
}
