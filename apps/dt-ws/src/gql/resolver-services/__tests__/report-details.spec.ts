import {
  CLIENT_MAX,
  REPORT_DETAILS_MAX_BYTES,
  ReportDetailsError,
  checkClient,
  mergeDetails,
  newest,
  parseStored,
  suggestion,
  toDetails,
} from '../shared/report-details';

const NOW = '2026-11-20T10:15:00.000Z';
const SHIELD = String.fromCodePoint(0x1f6e1); // outside the BMP: two UTF-16 units, one code point
const RLO = String.fromCodePoint(0x202e);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ReportDetailsError ? error.code : `not a ReportDetailsError: ${String(error)}`;
  }
  return undefined;
}

describe('checkClient', () => {
  it('leaves an absent client alone, and clears it for null or blank', () => {
    expect(checkClient(undefined)).toBeUndefined();
    expect(checkClient(null)).toBeNull();
    expect(checkClient('   ')).toBeNull();
  });

  it('trims', () => {
    expect(checkClient('  Example Ltd  ')).toBe('Example Ltd');
  });

  it(`takes ${CLIENT_MAX} code points and refuses ${CLIENT_MAX + 1}, counting a character outside the BMP once`, () => {
    expect(checkClient('a'.repeat(CLIENT_MAX))).toBe('a'.repeat(CLIENT_MAX));
    expect(checkClient(SHIELD.repeat(CLIENT_MAX))).toBe(SHIELD.repeat(CLIENT_MAX));
    expect(codeOf(() => checkClient('a'.repeat(CLIENT_MAX + 1)))).toBe('REPORT_DETAILS_CLIENT_TOO_LONG');
    expect(codeOf(() => checkClient(SHIELD.repeat(CLIENT_MAX + 1)))).toBe('REPORT_DETAILS_CLIENT_TOO_LONG');
  });

  it.each([
    ['a line feed', 'Example\nLtd'],
    ['a C1 control', `Example${String.fromCodePoint(0x85)}Ltd`],
    ['a right-to-left override', `Example${RLO}Ltd`],
  ])('refuses %s', (_label, client) => {
    expect(codeOf(() => checkClient(client))).toBe('REPORT_DETAILS_CLIENT_CHARACTERS');
  });
});

describe('parseStored', () => {
  it('reads nothing stored as empty, and a JSON object as itself', () => {
    expect(parseStored(null)).toEqual({ value: {}, corrupt: false });
    expect(parseStored(undefined)).toEqual({ value: {}, corrupt: false });
    expect(parseStored('{"client":"x"}')).toEqual({ value: { client: 'x' }, corrupt: false });
  });

  it.each([['not JSON', '{'], ['an array', '[1]'], ['a string', '"x"'], ['null', 'null'], ['a number', 7]])(
    'reads %s as empty, and says it is corrupt',
    (_label, raw) => {
      expect(parseStored(raw)).toEqual({ value: {}, corrupt: true });
    },
  );
});

describe('newest and toDetails', () => {
  it('takes the value with the newest updated', () => {
    const older = { client: 'Old', updated: '2026-01-01T00:00:00.000Z' };
    const newer = { client: 'New', updated: '2026-06-01T00:00:00.000Z' };
    expect(newest([older, newer, {}])).toBe(newer);
    expect(newest([{}, older])).toBe(older);
    expect(newest([])).toEqual({});
  });

  it('lets a value beat an empty one on a tie, so an edge that carries nothing hides no keys', () => {
    const unstamped = { project: 'From another writer' };
    expect(newest([{}, unstamped])).toBe(unstamped);
    expect(newest([unstamped, {}])).toBe(unstamped);
  });

  it('returns the known keys only, each a string or null', () => {
    const stored = { client: 'x', updated: NOW, project: 'kept, not returned' };
    expect(toDetails(stored)).toEqual({ client: 'x', updated: NOW });
    expect(toDetails({ client: 7 })).toEqual({ client: null, updated: null });
  });
});

describe('mergeDetails', () => {
  it('writes the client and stamps updated', () => {
    const merged = JSON.parse(mergeDetails({}, { client: ' Example Ltd ' }, NOW));
    expect(merged).toEqual({ client: 'Example Ltd', updated: NOW });
  });

  it('merges by key: a key left out stays, null clears it, and a stored key this server does not know is kept', () => {
    const stored = { client: 'Example Ltd', project: 'From a newer release', updated: '2026-01-01T00:00:00.000Z' };
    expect(JSON.parse(mergeDetails(stored, {}, NOW))).toEqual({ ...stored, updated: NOW });
    const cleared = JSON.parse(mergeDetails(stored, { client: null }, NOW));
    expect(cleared).toEqual({ project: 'From a newer release', updated: NOW });
  });

  it('refuses a bad client before anything is merged', () => {
    expect(codeOf(() => mergeDetails({}, { client: `x${RLO}` }, NOW))).toBe('REPORT_DETAILS_CLIENT_CHARACTERS');
  });

  it(`caps the stored JSON at ${REPORT_DETAILS_MAX_BYTES} bytes of UTF-8, not UTF-16 units`, () => {
    // 2100 characters of two UTF-8 bytes each: under the cap counted in UTF-16 units, over it in bytes.
    const wide = { notes: 'é'.repeat(2100) };
    const narrow = { notes: 'e'.repeat(2100) };
    expect(codeOf(() => mergeDetails(wide, { client: 'x' }, NOW))).toBe('REPORT_DETAILS_TOO_LARGE');
    expect(() => mergeDetails(narrow, { client: 'x' }, NOW)).not.toThrow();
  });

  it('names the kept unknown keys when they make it too large', () => {
    expect(() => mergeDetails({ notes: 'é'.repeat(2100) }, {}, NOW)).toThrow(
      /keys this server does not know: "notes"/,
    );
  });
});

describe('suggestion', () => {
  it('offers the newest client name, skipping values without one', () => {
    const values = [
      { client: 'Older', updated: '2026-01-01T00:00:00.000Z' },
      { client: 'Newer', updated: '2026-06-01T00:00:00.000Z' },
      { updated: '2026-09-01T00:00:00.000Z' },
      { client: '', updated: '2026-10-01T00:00:00.000Z' },
    ];
    expect(suggestion(values)).toEqual({ client: 'Newer', updated: '2026-06-01T00:00:00.000Z' });
  });

  it('is null when no other analysis has a client name', () => {
    expect(suggestion([])).toBeNull();
    expect(suggestion([{ updated: NOW }])).toBeNull();
  });
});
