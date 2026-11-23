/**
 * router/returnPath.ts
 *
 * Where a tab returns after it signs in. The guard keeps the address a signed-out tab asked for, in that tab's
 * sessionStorage (the sign-in is per tab too); the callback takes it once the sign-in succeeds. The router decides
 * what qualifies: an address it resolves to one of the app's pages, never a sign-in route or an unmatched one.
 * Anything else, a value older than ten minutes, or no router to ask, returns home. The redirect is the parsed
 * address, on this origin and under the app's base, never the stored string.
 */

export const RETURN_PATH_KEY = 'auth_return_to'
export const RETURN_PATH_MAX = 2048
export const RETURN_PATH_TTL_MS = 10 * 60 * 1000

/** The routes of the sign-in itself: returning to one would start it again. */
const SIGN_IN_ROUTES: ReadonlySet<string> = new Set(['login', 'auth-callback', 'auth-logout', 'auth-not-admitted'])
/** A backslash reads as a slash to a browser, and the URL parser drops tabs and newlines. */
const UNSAFE = /[\\\u0000-\u001f\u007f]/

type Resolved = { matched: ReadonlyArray<{ path: string }>; name?: unknown }
let resolveRoute: ((to: string) => Resolved) | null = null

/** The router's own resolve, set where the router is made; without it no address qualifies. */
export function setRouteResolver(resolve: ((to: string) => Resolved) | null): void {
  resolveRoute = resolve
}

const plainPath = (p: unknown): p is string =>
  typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && p.length <= RETURN_PATH_MAX && !UNSAFE.test(p)

/** A router-relative address the router resolves to one of the app's pages: not a sign-in route, not a catch-all. */
export function isReturnPath(p: unknown): p is string {
  if (!plainPath(p) || !resolveRoute) return false
  let route: Resolved
  try {
    route = resolveRoute(p)
  } catch {
    return false
  }
  if (!route.matched.length) return false
  if (typeof route.name === 'string' && SIGN_IN_ROUTES.has(route.name)) return false
  return !route.matched.some((m) => m.path.includes('(.*)') || m.path.includes(':pathMatch'))
}

/** Keep the address a signed-out tab asked for; any other request clears it, so the latest one wins. */
export function rememberReturnPath(fullPath: string, now = Date.now()): void {
  try {
    if (isReturnPath(fullPath)) sessionStorage.setItem(RETURN_PATH_KEY, JSON.stringify({ path: fullPath, at: now }))
    else sessionStorage.removeItem(RETURN_PATH_KEY)
  } catch {
    // no storage: the tab goes home after sign-in, as before
  }
}

export function forgetReturnPath(): void {
  try {
    sessionStorage.removeItem(RETURN_PATH_KEY)
  } catch {
    // no storage: nothing kept
  }
}

/**
 * The address to return to after sign-in, taken once: `pathname + search + hash` on `origin` under `base`, or null.
 * The stored value is checked again here, since anything in the origin can write sessionStorage.
 */
export function takeReturnPath(base: string, origin: string, now = Date.now()): string | null {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(RETURN_PATH_KEY)
    sessionStorage.removeItem(RETURN_PATH_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const { path, at } = (value && typeof value === 'object' ? value : {}) as { path?: unknown; at?: unknown }
  if (typeof at !== 'number' || !(now - at >= 0 && now - at <= RETURN_PATH_TTL_MS)) return null
  if (!plainPath(path)) return null
  let url: URL
  try {
    url = new URL(`${base}${path.slice(1)}`, origin)
  } catch {
    return null
  }
  if (url.origin !== origin || !url.pathname.startsWith(base) || url.pathname.startsWith('//')) return null
  // the parsed address, dot segments resolved, asked of the router again
  if (!isReturnPath(`/${url.pathname.slice(base.length)}${url.search}${url.hash}`)) return null
  return `${url.pathname}${url.search}${url.hash}`
}
