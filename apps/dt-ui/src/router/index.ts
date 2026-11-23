/**
 * router/index.ts
 *
 * Route definitions for the application.
 */

import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/authStore'
import { createAuthGuard } from './guard'
import { setRouteResolver } from './returnPath'

// Layout wrapper — wraps page components in the default layout
import DefaultLayout from '@/layouts/default.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: DefaultLayout,
      children: [
        { path: '', name: 'home', component: () => import('@/pages/index.vue') },
        { path: 'browser', name: 'browser', component: () => import('@/pages/browser.vue') },
        { path: 'dataflow', name: 'dataflow', component: () => import('@/pages/dataflow.vue') },
        { path: 'analysisresults', name: 'analysisresults', component: () => import('@/pages/analysisresults.vue') },
        { path: 'issues', name: 'issues', component: () => import('@/pages/issues.vue') },
        { path: 'modules', name: 'modules', component: () => import('@/pages/modules.vue') },
      ],
    },
    // Auth routes (no layout)
    { path: '/login', name: 'login', component: () => import('@/pages/login.vue') },
    { path: '/auth/callback', name: 'auth-callback', component: () => import('@/pages/auth/callback.vue') },
    { path: '/auth/logout', name: 'auth-logout', component: () => import('@/pages/auth/logout.vue') },
    // The sign-in worked and the deployment refused the account. Under /auth/ so the guard below lets a
    // signed-in person reach it without a loop through the identity provider.
    { path: '/auth/not-admitted', name: 'auth-not-admitted', component: () => import('@/pages/auth/not-admitted.vue') },
  ],
})

// The address a signed-out tab asked for is kept only when this router resolves it to one of its pages.
setRouteResolver((to) => router.resolve(to))

// The sign-in guard (guard.ts): the auth mode is resolved once, before the first navigation.
const authGuard = createAuthGuard()
router.beforeEach((to) => authGuard(to, useAuthStore()))


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
