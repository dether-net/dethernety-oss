// main.ts - Updated for composable approach
import { createApp, h, provide } from 'vue'
import App from './App.vue'
import { registerPlugins } from '@/plugins'
import { DefaultApolloClient } from '@vue/apollo-composable'
import apolloClient, { initializeApolloClient } from '@/plugins/apolloClient'
import * as VueRuntime from 'vue'
import { moduleLoader, ModuleLoader } from './services/ModuleLoader'

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

registerPlugins(app)

const initializeApp = async () => {
  try {
    if (import.meta.env.DEV) {
      console.log('Creating Vue app...')
    }

    if (import.meta.env.DEV) {
      console.log('Initializing Apollo client...')
    }
    await initializeApolloClient()

    if (import.meta.env.DEV) {
      console.log('Exposing host dependencies...')
    }
    // Use the static method to expose dependencies
    ModuleLoader.exposeHostDependencies(VueRuntime, app._context)

    if (import.meta.env.DEV) {
      console.log('Loading dynamic modules...')
    }
    await moduleLoader.loadAvailableModules()

    if (import.meta.env.DEV) {
      console.log('Mounting app...')
    }
    app.mount('#app')

  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('Failed to initialize app:', error)
    }
    app.mount('#app')
  }
}

initializeApp()