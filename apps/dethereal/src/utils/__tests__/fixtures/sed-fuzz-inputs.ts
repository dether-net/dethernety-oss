/**
 * The exact, deterministic sequence of sed scripts the differential check runs: every string of up to four of a small
 * set of pieces, then a long run of seeded-random ones. Both the recorded verdicts and the test build the sequence
 * from here, so they cannot drift; `sedFuzzHash` guards that the committed verdicts were recorded against this very list.
 */
import { createHash } from 'node:crypto'
import { allJoined, seeded } from '../../../test-setup/crafted-input.js'

/** A backslash or a non-ASCII character as the `s` delimiter, or a bracket expression — where the scan may refuse where the former reference accepted. */
export const bracketRisk = (s: string): boolean => s.includes('[') || /s[^\x20-\x7e]/.test(s)

/** The sed scripts, in order: the short exhaustive space, then 100 000 seeded-random ones. */
export function sedFuzzInputs(): string[] {
  const out: string[] = []
  for (const s of allJoined(['s', '/', '\\', ';', '\n', ' ', ',', '!', '1', 'p', 'g', '$', '{', 'x', '+', '\r', '[', ']'], 4)) out.push(s)
  const random = seeded(7)
  const single = ['s', '/', '\\', ';', '\n', ' ', '\t', ',', '!', '0', '1', '9', 'p', 'd', 'q', '=', 'l', 'n', 'g', 'i', 'I', 'w', 'e', '$', '{', '}', '+', '~',
    'x', '|', '#', '\r', ' ', ' ', '[', ']', '^', ':']
  const pieces = ['s/', 's|', 's\\', 's///', 's/a/b/', 's|x|y|', 's\n', '/', '|', '\\', '\\/', '\\|', '\\\n', 'a', '0', '1', '9', '12', ',', '!', 'p', 'd', 'q',
    '=', 'l', 'n', 'g', 'i', 'I', 'e', 'w', ';', '\n', ' ', '\t', ' ', '$', '{', '}', '+', '~', '+2', '~3', 'gp', '[0-9]', '[/]', '[^]/]', '[[:digit:]]', '[]']
  for (let r = 0; r < 100_000; r++) {
    const length = 1 + (r % 12)
    let s = ''
    while (s.length < length) s += random.pick(r % 2 ? single : pieces)
    out.push(s.slice(0, length))
  }
  return out
}

/** A hash of the whole sequence, so a changed generator fails loudly instead of reading verdicts recorded for another list. */
export function sedFuzzHash(inputs: string[]): string {
  const h = createHash('sha256')
  for (const s of inputs) h.update(String(s.length)).update('\u0000').update(s)
  return h.digest('hex')
}

/** One bit out of a base64 bitmap recorded in input order. */
export function bitOf(bitmapBase64: string): (i: number) => boolean {
  const buf = Buffer.from(bitmapBase64, 'base64')
  return (i) => ((buf[i >> 3] ?? 0) >> (i & 7) & 1) === 1
}
