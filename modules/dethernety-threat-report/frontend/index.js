// frontend/index.js — module frontend entry.
//
// The host (dt-ui) imports this bundle's default export and calls install()
// with its dependency container, then the module registers Vue components by
// key into the host's componentRegistry.
//
// Mount: the backend declares a "Threat Report" analysis class and serves a
// document keyed `threat_report_dashboard` from getDocument({document:'index'}).
// The analysis-results page resolves that key via componentRegistry.getComponent
// and renders the component below — so the key here MUST match the document key.

import ThreatReportDashboard from './components/ThreatReportDashboard.vue'

export default {
  id: 'dethernety-threat-report',

  async install(hostDependencies) {
    if (!hostDependencies) {
      console.error('[threat-report] Host dependencies not provided to module')
      return
    }

    const { componentRegistry } = hostDependencies.services || {}
    if (!componentRegistry) {
      console.error('[threat-report] Component registry not available')
      return
    }

    const componentsToRegister = [
      { key: 'threat_report_dashboard', component: ThreatReportDashboard },
    ]

    componentsToRegister.forEach(({ key, component }) => {
      try {
        componentRegistry.register(key, component, 'dethernety-threat-report')
        console.log(`✅ [threat-report] Registered component: ${key}`)
      } catch (error) {
        console.error(`❌ [threat-report] Failed to register component ${key}:`, error)
      }
    })
  },

  uninstall() {
    const deps = window.__HOST_DEPENDENCIES__
    if (deps?.services?.componentRegistry) {
      deps.services.componentRegistry.unregisterModule('dethernety-threat-report')
    }
  },
}
