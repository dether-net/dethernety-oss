import { FORBIDDEN_DISPLAY_CHARS, codePoints, printableKeys } from '../display-text';

describe('FORBIDDEN_DISPLAY_CHARS', () => {
  it.each([
    ['a NUL', 'a\u0000b'],
    ['a line feed', 'a\nb'],
    ['DEL', 'a\u007fb'],
    ['a C1 control', 'a\u0085b'],
    ['the Arabic letter mark', 'a\u061cb'],
    ['a line separator', 'a\u2028b'],
    ['a right-to-left override', 'a\u202eb'],
    ['a first-strong isolate', 'a\u2068b'],
    ['a zero-width space', 'a\u200bb'],
    ['a word joiner', 'a\u2060b'],
    ['a byte-order mark', 'a\ufeffb'],
    ['a tag character', `a${String.fromCodePoint(0xe0041)}b`],
    ['a supplementary variation selector', `a${String.fromCodePoint(0xe0100)}b`],
    ['a lone surrogate', `a${String.fromCharCode(0xd800)}b`],
  ])('finds %s', (_label, text) => {
    expect(FORBIDDEN_DISPLAY_CHARS.test(text)).toBe(true);
  });

  it('passes ZWNJ, ZWJ and the variation selectors names and emoji sequences need', () => {
    expect(FORBIDDEN_DISPLAY_CHARS.test('a\u200cb\u200dc\u2764\ufe0f')).toBe(false);
  });

  it('passes letters, punctuation and characters outside the BMP', () => {
    expect(FORBIDDEN_DISPLAY_CHARS.test('Example Ltd. \u00e9t\u00e9 \u5ba2\u6237 \ud83d\udee1\ufe0f')).toBe(false);
  });
});

describe('codePoints', () => {
  it('counts a character outside the BMP once', () => {
    expect(codePoints('a\ud83d\udee1b')).toBe(3);
  });
});

describe('printableKeys', () => {
  it('quotes keys and replaces control and text-direction characters, so a key cannot forge a log line', () => {
    expect(printableKeys(['colors', 'x\n[Nest] LOG forged', '\u001b[31mred', 'a\u202eb'])).toBe(
      '"colors", "x?[Nest] LOG forged", "?[31mred", "a?b"',
    );
  });

  it('lists at most ten keys, each cut to 64 characters', () => {
    const keys = Array.from({ length: 12 }, (_, i) => `k${i}`);
    expect(printableKeys(keys)).toBe(`${keys.slice(0, 10).map((k) => `"${k}"`).join(', ')} and 2 more`);
    expect(printableKeys(['a'.repeat(100)])).toBe(`"${'a'.repeat(64)}"`);
  });
});
