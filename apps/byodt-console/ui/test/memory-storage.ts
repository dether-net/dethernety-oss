// An in-memory Storage. Node 26 defines its own global localStorage, which is undefined unless node is
// started with --localstorage-file, and it shadows happy-dom's — so a test that needs localStorage stubs
// this in with vi.stubGlobal.
export function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    get length() {
      return m.size
    },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i: number) => [...m.keys()][i] ?? null,
    removeItem: (k: string) => void m.delete(k),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
  }
}
