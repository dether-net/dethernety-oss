import {
  AUTHOR_MAX,
  CLIENT_MAX,
  CUSTOM_FIELDS_MAX,
  FIELD_LABEL_MAX,
  FIELD_VALUE_MAX,
  PROJECT_MAX,
  REPORT_DETAILS_MAX_BYTES,
  ReportDetailsError,
  checkCustomFields,
  checkInput,
  checkText,
  mergeDetails,
  newest,
  parseStored,
  suggestion,
  toDetails,
  visibleLabel,
} from '../shared/report-details';

const NOW = '2026-11-20T10:15:00.000Z';
const SHIELD = String.fromCodePoint(0x1f6e1); // outside the BMP: two UTF-16 units, one code point
const RLO = String.fromCodePoint(0x202e);
const NONE = { client: null, author: null, project: null, customFields: null, updated: null };

function errorOf(fn: () => unknown): ReportDetailsError | string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ReportDetailsError ? error : `not a ReportDetailsError: ${String(error)}`;
  }
  return undefined;
}

function codeOf(fn: () => unknown): string | undefined {
  const error = errorOf(fn);
  return error instanceof ReportDetailsError ? error.code : error;
}

const field = (label: string, value = 'v') => ({ label, value });
const fields = (n: number) => Array.from({ length: n }, (_, i) => field(`Field ${i}`, `Value ${i}`));

/** Every key at its limit, in one character repeated. */
const at = (char: string) => ({
  client: char.repeat(CLIENT_MAX),
  author: char.repeat(AUTHOR_MAX),
  project: char.repeat(PROJECT_MAX),
  customFields: Array.from({ length: CUSTOM_FIELDS_MAX }, (_, i) => ({
    label: `${i}`.padEnd(FIELD_LABEL_MAX, char),
    value: char.repeat(FIELD_VALUE_MAX),
  })),
});

describe.each([
  ['client', CLIENT_MAX, 'CLIENT'],
  ['author', AUTHOR_MAX, 'AUTHOR'],
  ['project', PROJECT_MAX, 'PROJECT'],
] as const)('checkText(%s)', (key, max, code) => {
  it('leaves an absent value alone, and clears it for null or blank', () => {
    expect(checkText(key, undefined)).toBeUndefined();
    expect(checkText(key, null)).toBeNull();
    expect(checkText(key, '   ')).toBeNull();
  });

  it('trims', () => {
    expect(checkText(key, '  Example Ltd  ')).toBe('Example Ltd');
  });

  it(`takes ${max} code points and refuses ${max + 1}, counting a character outside the BMP once`, () => {
    expect(checkText(key, 'a'.repeat(max))).toBe('a'.repeat(max));
    expect(checkText(key, SHIELD.repeat(max))).toBe(SHIELD.repeat(max));
    expect(codeOf(() => checkText(key, 'a'.repeat(max + 1)))).toBe(`REPORT_DETAILS_${code}_TOO_LONG`);
    expect(codeOf(() => checkText(key, SHIELD.repeat(max + 1)))).toBe(`REPORT_DETAILS_${code}_TOO_LONG`);
  });

  it.each([
    ['a line feed', 'Example\nLtd'],
    ['a C1 control', `Example${String.fromCodePoint(0x85)}Ltd`],
    ['a right-to-left override', `Example${RLO}Ltd`],
  ])('refuses %s', (_label, text) => {
    expect(codeOf(() => checkText(key, text))).toBe(`REPORT_DETAILS_${code}_CHARACTERS`);
  });
});

describe('checkCustomFields', () => {
  it('leaves an absent list alone, and clears it for null or an empty list', () => {
    expect(checkCustomFields(undefined)).toBeUndefined();
    expect(checkCustomFields(null)).toBeNull();
    expect(checkCustomFields([])).toBeNull();
  });

  it('trims each label and value, keeps the order, and returns only label and value', () => {
    const extra = { label: ' Engagement ref ', value: ' ES-114 ', note: 'x' } as any;
    expect(checkCustomFields([extra, field('Classification', 'Confidential')])).toEqual([
      { label: 'Engagement ref', value: 'ES-114' },
      { label: 'Classification', value: 'Confidential' },
    ]);
  });

  it(`takes ${CUSTOM_FIELDS_MAX} fields and refuses ${CUSTOM_FIELDS_MAX + 1} before checking any of them`, () => {
    expect(checkCustomFields(fields(CUSTOM_FIELDS_MAX))).toHaveLength(CUSTOM_FIELDS_MAX);
    const tooMany = [...fields(CUSTOM_FIELDS_MAX), field('', '')];
    expect(codeOf(() => checkCustomFields(tooMany))).toBe('REPORT_DETAILS_TOO_MANY_FIELDS');
  });

  it(`takes a label of ${FIELD_LABEL_MAX} code points and a value of ${FIELD_VALUE_MAX}, and refuses one more`, () => {
    const label = SHIELD + 'a'.repeat(FIELD_LABEL_MAX - 1);
    const value = SHIELD.repeat(FIELD_VALUE_MAX);
    expect(checkCustomFields([field(label, value)])).toEqual([field(label, value)]);
    expect(codeOf(() => checkCustomFields([field(label + 'a', 'v')]))).toBe('REPORT_DETAILS_FIELD_TOO_LONG');
    expect(codeOf(() => checkCustomFields([field('L', value + 'a')]))).toBe('REPORT_DETAILS_FIELD_TOO_LONG');
  });

  it.each([
    ['an empty label', field('  ', 'v')],
    ['an empty value', field('Label', '  ')],
    ['a label of a soft hyphen only', field('\u00ad')],
    ['a label of a Hangul filler only', field('\u3164')],
    ['a label of a halfwidth Hangul filler only', field('\uffa0')],
    ['a label of Hangul choseong and jungseong fillers only', field('\u115f\u1160')],
    ['a label of a combining grapheme joiner only', field('\u034f')],
    ['a label of a blank braille cell only', field('\u2800')],
    ['a label of punctuation only', field('--')],
  ])('refuses %s as incomplete', (_name, entry) => {
    expect(codeOf(() => checkCustomFields([entry]))).toBe('REPORT_DETAILS_FIELD_INCOMPLETE');
  });

  it('takes a label in any script, and one with a digit only', () => {
    expect(checkCustomFields([field('Ügyfél'), field('案件'), field('7')])).toHaveLength(3);
  });

  it.each([
    ['in a label', field(`Ref${RLO}`)],
    ['in a value', field('Ref', `ES${RLO}114`)],
    ['as a line feed in a value', field('Ref', 'ES\n114')],
  ])('refuses a control or text-direction character %s', (_name, entry) => {
    expect(codeOf(() => checkCustomFields([entry]))).toBe('REPORT_DETAILS_FIELD_CHARACTERS');
  });

  it.each([
    ['in case', 'Engagement Ref', 'engagement ref'],
    ['in composition (NFC)', 'Café', 'Cafe\u0301'],
    ['by a soft hyphen', 'Engagement', 'Engage\u00adment'],
    ['by surrounding spaces', 'Ref', ' Ref '],
    ['by the kind of space between words', 'Client ref', 'Client\u00a0 ref'],
  ])('refuses two labels that differ only %s', (_name, a, b) => {
    expect(codeOf(() => checkCustomFields([field(a), field(b)]))).toBe('REPORT_DETAILS_FIELD_DUPLICATE');
  });

  it('takes the visible form of a label as NFC with the ignorable characters removed', () => {
    expect(visibleLabel('Cafe\u0301\u00ad')).toBe('Café');
    expect(visibleLabel('\u3164')).toBe('');
  });
});

describe('checkInput', () => {
  it('checks every key', () => {
    expect(checkInput({ client: ' C ', author: ' A ', project: null, customFields: [field(' L ', ' V ')] })).toEqual({
      client: 'C',
      author: 'A',
      project: null,
      customFields: [{ label: 'L', value: 'V' }],
    });
    expect(codeOf(() => checkInput({ project: 'p'.repeat(PROJECT_MAX + 1) }))).toBe(
      'REPORT_DETAILS_PROJECT_TOO_LONG',
    );
  });
});

describe('error messages', () => {
  const MARK = 'zqxj';
  it.each([
    ['client', () => checkText('client', MARK.repeat(40))],
    ['client characters', () => checkText('client', `${MARK}${RLO}`)],
    ['author', () => checkText('author', MARK.repeat(40))],
    ['author characters', () => checkText('author', `${MARK}${RLO}`)],
    ['project', () => checkText('project', MARK.repeat(40))],
    ['project characters', () => checkText('project', `${MARK}${RLO}`)],
    ['label length', () => checkCustomFields([field(MARK.repeat(11), MARK)])],
    ['value length', () => checkCustomFields([field(MARK, MARK.repeat(31))])],
    ['field characters', () => checkCustomFields([field(MARK, `${MARK}${RLO}`)])],
    ['incomplete', () => checkCustomFields([field(MARK, ' ')])],
    ['no letter', () => checkCustomFields([field('--', MARK)])],
    ['duplicate', () => checkCustomFields([field(MARK), field(MARK.toUpperCase())])],
    ['too many', () => checkCustomFields(Array.from({ length: 11 }, (_, i) => field(`${MARK}${i}`, MARK)))],
    ['too large', () => mergeDetails({}, { customFields: [field(MARK, MARK)] }, 'x'.repeat(5000))],
  ])('never quote the input (%s)', (_name, fn) => {
    const error = errorOf(fn);
    expect(error).toBeInstanceOf(ReportDetailsError);
    expect((error as ReportDetailsError).message.toLowerCase()).not.toContain(MARK);
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
    const unstamped = { notes: 'From another writer' };
    expect(newest([{}, unstamped])).toBe(unstamped);
    expect(newest([unstamped, {}])).toBe(unstamped);
  });

  it('returns the known keys only, each its value or null', () => {
    const stored = {
      client: 'x',
      author: 'A. Analyst',
      project: 'P',
      customFields: [field('Ref', 'ES-114')],
      updated: NOW,
      notes: 'kept, not returned',
    };
    expect(toDetails(stored)).toEqual({
      client: 'x',
      author: 'A. Analyst',
      project: 'P',
      customFields: [field('Ref', 'ES-114')],
      updated: NOW,
    });
    expect(toDetails({ client: 7, author: {}, project: [], customFields: 'x' })).toEqual(NONE);
  });

  it('reads a value from an earlier release, which holds the client only', () => {
    const earlier = { client: 'Example Ltd', updated: NOW };
    expect(toDetails(earlier)).toEqual({ ...NONE, ...earlier });
  });

  it('drops a stored named value that a set would refuse', () => {
    const stored = { client: 'c'.repeat(10_000), author: `A${RLO}`, project: ' ' };
    expect(toDetails(stored)).toEqual(NONE);
  });

  it('keeps the first well-formed custom fields of a hand-written value, as label and value only', () => {
    const stored = {
      customFields: [
        null,
        'Ref',
        { label: 'Ref', value: 7 },
        { label: `Bidi${RLO}`, value: 'v' },
        { label: 'Long', value: 'x'.repeat(10_000) },
        { label: '\u3164', value: 'v' },
        { label: 'First', value: 'one', extra: 'dropped' },
        { label: 'FIRST', value: 'a later duplicate' },
        ...Array.from({ length: 500 }, (_, i) => field(`Field ${i}`, `Value ${i}`)),
      ],
    };
    const read = toDetails(stored).customFields;
    expect(read).toHaveLength(CUSTOM_FIELDS_MAX);
    expect(read?.[0]).toEqual({ label: 'First', value: 'one' });
    expect(read?.[1]).toEqual(field('Field 0', 'Value 0'));
    expect(read?.[CUSTOM_FIELDS_MAX - 1]).toEqual(field('Field 8', 'Value 8'));
  });

  it('reads a list with no well-formed field as none', () => {
    expect(toDetails({ customFields: [] }).customFields).toBeNull();
    expect(toDetails({ customFields: [{ label: '', value: '' }] }).customFields).toBeNull();
  });
});

describe('mergeDetails', () => {
  it('writes each key and stamps updated', () => {
    const merged = JSON.parse(
      mergeDetails(
        {},
        { client: ' Example Ltd ', author: 'A. Analyst', project: 'P', customFields: [field('Ref', 'ES-114')] },
        NOW,
      ),
    );
    expect(merged).toEqual({
      client: 'Example Ltd',
      author: 'A. Analyst',
      project: 'P',
      customFields: [field('Ref', 'ES-114')],
      updated: NOW,
    });
  });

  it('merges by key: a key left out stays, null clears it, and a stored key this server does not know is kept', () => {
    const stored = {
      client: 'Example Ltd',
      author: 'A. Analyst',
      notes: 'From a newer release',
      updated: '2026-01-01T00:00:00.000Z',
    };
    expect(JSON.parse(mergeDetails(stored, {}, NOW))).toEqual({ ...stored, updated: NOW });
    const cleared = JSON.parse(mergeDetails(stored, { client: null, author: '  ' }, NOW));
    expect(cleared).toEqual({ notes: 'From a newer release', updated: NOW });
  });

  it('replaces the custom fields whole, and deletes them for null or an empty list', () => {
    const stored = { customFields: [field('A'), field('B')], updated: '2026-01-01T00:00:00.000Z' };
    expect(JSON.parse(mergeDetails(stored, { customFields: [field('C')] }, NOW)).customFields).toEqual([field('C')]);
    expect(JSON.parse(mergeDetails(stored, { customFields: null }, NOW))).toEqual({ updated: NOW });
    expect(JSON.parse(mergeDetails(stored, { customFields: [] }, NOW))).toEqual({ updated: NOW });
    expect(JSON.parse(mergeDetails(stored, { client: 'x' }, NOW)).customFields).toEqual(stored.customFields);
  });

  it('refuses a bad value before anything is merged', () => {
    expect(codeOf(() => mergeDetails({}, { client: `x${RLO}` }, NOW))).toBe('REPORT_DETAILS_CLIENT_CHARACTERS');
    expect(codeOf(() => mergeDetails({}, { customFields: [field('A'), field('a')] }, NOW))).toBe(
      'REPORT_DETAILS_FIELD_DUPLICATE',
    );
  });

  it(`caps the stored JSON at ${REPORT_DETAILS_MAX_BYTES} bytes of UTF-8, not UTF-16 units`, () => {
    // 2100 characters of two UTF-8 bytes each: under the cap counted in UTF-16 units, over it in bytes.
    const wide = { notes: 'é'.repeat(2100) };
    const narrow = { notes: 'e'.repeat(2100) };
    expect(codeOf(() => mergeDetails(wide, { client: 'x' }, NOW))).toBe('REPORT_DETAILS_TOO_LARGE');
    expect(() => mergeDetails(narrow, { client: 'x' }, NOW)).not.toThrow();
  });

  it('fits every key at its limit in plain text, and refuses it in two-byte text', () => {
    expect(() => mergeDetails({}, at('e'), NOW)).not.toThrow();
    expect(codeOf(() => mergeDetails({}, at('é'), NOW))).toBe('REPORT_DETAILS_TOO_LARGE');
  });

  it('names the kept unknown keys when they make it too large', () => {
    expect(() => mergeDetails({ notes: 'é'.repeat(2100) }, {}, NOW)).toThrow(
      /keys this server does not know: "notes"/,
    );
  });

  it('writes a known key as a read returns it, so a hand-written value a read leaves out does not stay behind', () => {
    const stored = {
      client: 'c'.repeat(10_000),
      customFields: Array.from({ length: 500 }, (_, i) => field(`Field ${i}`, `Value ${i}`)),
      notes: 'kept',
    };
    const written = JSON.parse(mergeDetails(stored, { author: 'A. Analyst' }, NOW));
    expect(written).toEqual({
      author: 'A. Analyst',
      customFields: fields(CUSTOM_FIELDS_MAX),
      notes: 'kept',
      updated: NOW,
    });
  });

  it('does not count the new keys as unknown', () => {
    const error = errorOf(() =>
      mergeDetails({ author: 'A. Analyst', customFields: [field('A')] }, at('é'), NOW),
    );
    expect((error as ReportDetailsError).message).not.toMatch(/does not know/);
  });
});

describe('suggestion', () => {
  it('offers the newest details that hold anything, skipping values without any', () => {
    const values = [
      { client: 'Older', updated: '2026-01-01T00:00:00.000Z' },
      { author: 'Newer', customFields: [field('Ref', 'x')], updated: '2026-06-01T00:00:00.000Z' },
      { updated: '2026-09-01T00:00:00.000Z' },
      { client: '', updated: '2026-10-01T00:00:00.000Z' },
      { client: `x${RLO}`, notes: 'unknown only', updated: '2026-11-01T00:00:00.000Z' },
    ];
    expect(suggestion(values)).toEqual({
      ...NONE,
      author: 'Newer',
      customFields: [field('Ref', 'x')],
      updated: '2026-06-01T00:00:00.000Z',
    });
  });

  it('is null when no other analysis has any details', () => {
    expect(suggestion([])).toBeNull();
    expect(suggestion([{ updated: NOW }])).toBeNull();
    expect(suggestion([{ customFields: [{ label: '\u3164', value: 'v' }], updated: NOW }])).toBeNull();
  });
});
