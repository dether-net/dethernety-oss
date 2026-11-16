/**
 * One at a time per key: calls for the same key run in the order they came, each after the one before has
 * settled; calls for other keys run alongside.
 */
export class Turns {
  private readonly tails = new Map<string, Promise<unknown>>()

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const before = this.tails.get(key) ?? Promise.resolve()
    const mine = before.then(fn, fn)
    const tail = mine.catch(() => undefined)
    this.tails.set(key, tail)
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key)
    })
    return mine
  }
}
