/**
 * `cross-fetch` as the bundle sees it: Node's own `fetch`, looked up at call
 * time. Bundling node-fetch would pull in CommonJS code that `require`s Node
 * built-ins at run time, which an ES module bundle cannot serve.
 */
const fetchShim = (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
  if (typeof globalThis.fetch !== 'function') throw new Error('Dethereal needs Node.js 22.12.0 or newer')
  return globalThis.fetch(...args)
}

export default fetchShim
