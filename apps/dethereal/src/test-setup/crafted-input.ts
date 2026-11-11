/**
 * Inputs for the tests that hold a check to a reference reading (an expression or loop kept in the test), and to a time
 * bound: a seeded random source, and long inputs made by repeating a unit.
 */

/** A seeded source of random choices (mulberry32): the same seed, the same choices, every run. */
export function seeded(seed: number): { next(): number; int(n: number): number; pick<T>(xs: readonly T[]): T } {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let x = s
    x = Math.imul(x ^ (x >>> 15), x | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (xs) => xs[Math.floor(next() * xs.length)]!,
  }
}

/** `head`, then `unit` repeated, then `tail`: about `length` characters in all. */
export function crafted(length: number, unit: string, head = '', tail = ''): string {
  return head + unit.repeat(Math.max(0, Math.ceil((length - head.length - tail.length) / unit.length))) + tail
}

/** Every string of up to `length` of `pieces` joined, the empty one included. */
export function* allJoined(pieces: readonly string[], length: number, prefix = ''): Generator<string> {
  yield prefix
  if (length > 0) for (const p of pieces) yield* allJoined(pieces, length - 1, prefix + p)
}

/** How long `run` takes, in milliseconds, after one call to warm it up. */
export function timed(run: () => unknown): number {
  run()
  const started = performance.now()
  run()
  return performance.now() - started
}
