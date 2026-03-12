/**
 * router/index.ts
 *
 * Automatic routes for `./src/pages/*.vue`
 */

// Composables
import { createRouter, createWebHistory } from 'vue-router'
import { setupLayouts } from 'virtual:generated-layouts'
import { routes } from 'vue-router/auto-routes'
import { useAuthStore } from '@/stores/authStore'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  // history: createWebHashHistory(import.meta.env.BASE_URL), // Use hash mode instead of history mode
  routes: setupLayouts([...routes]),
})

// Ensure auth mode is resolved once before the first navigation.
let authInitialized = false

router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  // One-time check: detect whether authentication is required
  if (!authInitialized) {
    await authStore.initializeAuthMode()
    authInitialized = true
  }

  // When auth is disabled (demo / development) allow all routes
  if (authStore.authDisabled) {
    return true
  }

  // Allow access to auth-related routes
  if (to.path === '/login' || to.path.startsWith('/auth/')) {
    return true
  }

  if (!authStore.isAuthenticated) {
    return '/login'
  }

  return true
})


if (import.meta.env.DEV) {
  // Workaround for https://github.com/vitejs/vite/issues/11804
  router.onError((err, to) => {
    if (err?.message?.includes?.('Failed to fetch dynamically imported module')) {
      if (!localStorage.getItem('vuetify:dynamic-reload')) {
        console.log('Reloading page to fix dynamic import error')
        localStorage.setItem('vuetify:dynamic-reload', 'true')
        location.assign(to.fullPath)
      } else {
        console.error('Dynamic import error, reloading page did not fix it', err)
      }
    } else {
      console.error(err)
    }
  })

  router.isReady().then(() => {
    localStorage.removeItem('vuetify:dynamic-reload')
  })
}

export default router
