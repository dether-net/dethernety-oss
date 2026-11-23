/**
 * router/guard.ts
 *
 * The sign-in guard: the auth mode is resolved once before the first navigation; with auth disabled every route
 * opens; the sign-in routes always open; any other route needs a signed-in tab, and a signed-out one goes to
 * /login with the address it asked for kept, so the sign-in returns there (returnPath.ts).
 */
import { rememberReturnPath } from './returnPath'

export interface GuardAuth {
  authDisabled: boolean
  isAuthenticated: boolean
  initializeAuthMode: () => Promise<void>
}

export function createAuthGuard() {
  let authInitialized = false
  return async function authGuard(to: { path: string; fullPath: string }, authStore: GuardAuth): Promise<true | string> {
    // One-time check: detect whether authentication is required
    if (!authInitialized) {
      await authStore.initializeAuthMode()
      authInitialized = true
    }

    // When auth is disabled (no-auth) allow all routes
    if (authStore.authDisabled) {
      return true
    }

    // Allow access to auth-related routes
    if (to.path === '/login' || to.path.startsWith('/auth/')) {
      return true
    }

    if (!authStore.isAuthenticated) {
      rememberReturnPath(to.fullPath)
      return '/login'
    }

    return true
  }
}
