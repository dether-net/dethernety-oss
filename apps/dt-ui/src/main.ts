// main.ts - Updated for composable approach
import { createApp, h, provide } from 'vue'
import App from './App.vue'
import { registerPlugins } from '@/plugins'
import { DefaultApolloClient } from '@/plugins/apolloComposable'
import apolloClient, { initializeApolloClient } from '@/plugins/apolloClient'
import * as VueRuntime from 'vue'
import { ModuleLoader } from './services/ModuleLoader'
import { useAuthStore } from '@/stores/authStore'
import { timingMark, timingMeasure } from '@/utils/userTiming'
import { isConfigUnavailable, mountConfigUnavailable } from '@/plugins/configUnavailable'

// CSS imports
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'
import '@/styles/main.scss'

const app = createApp({
  setup () {
    provide(DefaultApolloClient, apolloClient)
  },
  render: () => h(App),
})

// The page the person opened, before the router's first navigation can move the address: a retry after a failed start
// returns here.
const bootHref = window.location.href

registerPlugins(app)

// User Timing: dt:boot → dt:mounted, measured as dt:mount.
const markMounted = (ok: boolean) => {
  timingMark('dt:mounted')
  timingMeasure('dt:mount', 'dt:boot', ok)
}

const initializeApp = async () => {
  timingMark('dt:boot')
  try {
    if (import.meta.env.DEV) {
      console.log('Creating Vue app...')
    }

    if (import.meta.env.DEV) {
      console.log('Initializing Apollo client...')
    }
    await initializeApolloClient()

    // Resolve auth mode (incl. no-auth) BEFORE mount. Authenticated requests —
    // GraphQL via the Apollo authLink, and module frontend bundles — skip token
    // handling only once authStore.authDisabled is set; without it the first
    // request after mount would fail with a spurious "Invalid authentication
    // token". initializeAuthMode is idempotent (config is cached), so the router
    // guard's later call is a no-op.
    if (import.meta.env.DEV) {
      console.log('Initializing auth mode...')
    }
    await useAuthStore().initializeAuthMode()

    if (import.meta.env.DEV) {
      console.log('Exposing host dependencies...')
    }
    // Module frontends load on first use (moduleLoader.ensure), never before mount;
    // they find the host's dependencies here.
    ModuleLoader.exposeHostDependencies(VueRuntime, app._context)

    if (import.meta.env.DEV) {
      console.log('Mounting app...')
    }
    app.mount('#app')
    markMounted(true)

  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('Failed to initialize app:', error)
    }
    // Without the platform's configuration the app does not start: it says so and offers a retry.
    if (isConfigUnavailable(error)) {
      mountConfigUnavailable('#app', bootHref)
    } else {
      app.mount('#app')
    }
    markMounted(false)
  }
}

initializeApp()