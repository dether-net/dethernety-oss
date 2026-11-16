/**
 * Platform and agent text as triage shows it to the operator: on one line, with nothing invisible.
 */

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}\p{Cs}]/gu

/** A text as a line shows it: on one line, every invisible or control character as `?`, and cut to `max` characters. */
export function shown(text: string, max = Number.POSITIVE_INFINITY): string {
  const line = text.replace(/\r\n|\r|\n/g, ' ').replace(INVISIBLE, '?')
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
