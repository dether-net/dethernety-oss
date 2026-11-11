/**
 * `cross-fetch` is not installed: the build and the tests alias it to
 * `./fetch.ts`, which serves Node's own fetch.
 */
declare module 'cross-fetch' {
  const fetch: typeof globalThis.fetch
  export default fetch
}
