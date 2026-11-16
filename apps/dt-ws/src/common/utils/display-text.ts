/**
 * Text a person types that is later shown, printed or logged: the characters it may not hold, and its length as people
 * count it.
 */

/**
 * C0 and C1 control characters, the line and paragraph separators, the bidirectional formatting characters that can
 * reorder text on screen, and the invisible characters that can hide text from a reader: zero-width spaces and joiners
 * other than ZWNJ and ZWJ (which some scripts need), the byte-order mark, tag characters, the supplementary variation
 * selectors, and lone surrogates.
 *
 * The lone-surrogate range is meant: under the `u` flag a surrogate pair is one code point, so only a surrogate
 * without its partner matches it.
 */
// eslint-disable-next-line no-control-regex, no-misleading-character-class
export const FORBIDDEN_DISPLAY_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}\ud800-\udfff]/u;

// eslint-disable-next-line no-misleading-character-class
const FORBIDDEN_DISPLAY_CHARS_ALL = new RegExp(FORBIDDEN_DISPLAY_CHARS.source, 'gu');

/** The length of a string in code points, so a character outside the BMP counts once. */
export const codePoints = (text: string): number => [...text].length;

/**
 * Keys as they may appear in a log line or an error: quoted, with control and text-direction characters replaced, at
 * most `max` of them, so a key cannot forge a log line or drive the operator's terminal.
 */
export function printableKeys(keys: string[], max = 10): string {
  const shown = keys
    .slice(0, max)
    .map((key) => JSON.stringify(key.replace(FORBIDDEN_DISPLAY_CHARS_ALL, '?').slice(0, 64)));
  return keys.length > max ? `${shown.join(', ')} and ${keys.length - max} more` : shown.join(', ');
}
