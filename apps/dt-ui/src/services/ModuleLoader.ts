// src/services/ModuleLoader.ts
import type { Component } from 'vue'
import type { FrontendModuleManifest } from '@dethernety/dt-core'
import { useModulesStore } from '@/stores/modulesStore'
import { useAuthStore } from '@/stores/authStore'
import { useHostContext } from '@/composables/useHostContext'
import { componentRegistry, ComponentRegistry } from '@/services/ComponentRegistry'
import { getConfig } from '@/config/environment'
import { timingMeasure } from '@/utils/userTiming'
// Re-export the host's already-bundled JSONForms engine to module bundles via
// __HOST_DEPENDENCIES__.__JSONFORMS__ (see exposeHostDependencies). Namespace imports
// resolve to the single host-bundled copy, so modules share one JSONForms bound to the
// host's one Vue — no duplicate instance, no version skew.
import * as JsonFormsCore from '@jsonforms/core'
import * as JsonFormsVue from '@jsonforms/vue'

declare global {
  interface Window {
    __HOST_DEPENDENCIES__: HostDependencies
    [key: string]: any
  }
}

export interface HostDependencies {
  useHostContext: typeof useHostContext
  services: {
    componentRegistry: typeof componentRegistry
  }
  __VUE__?: any
  // Host's already-bundled JSONForms engine shared with module bundles (see
  // exposeHostDependencies). `@jsonforms/core` + `@jsonforms/vue` only — modules supply
  // their own renderer set, so the host's vue-vuetify renderers are not exposed.
  __JSONFORMS__?: {
    core: typeof JsonFormsCore
    vue: typeof JsonFormsVue
  }
  __APP_CONTEXT__?: any,
}

/**
 * The version of HostDependencies above. A module frontend's manifest names the range it works
 * with (hostApi); raise this when the shape changes incompatibly.
 */
export const HOST_API_VERSION = 1

/**
 * Why a module's view could not be shown: the module is unhealthy (`unavailable`), built for
 * another host (`host-api`), or could not be fetched, evaluated or found (`unloadable`). The page
 * words it for the user; `message` and `cause` are for the console.
 */
export type ModuleFrontendErrorKind = 'unavailable' | 'unloadable' | 'host-api'

export class ModuleFrontendError extends Error {
  constructor(readonly kind: ModuleFrontendErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'ModuleFrontendError'
  }
}

const BUNDLE_PATH_PREFIX = '/module-bundles/'

/** What the loader needs from the rest of the app; replaced in tests. */
export interface ModuleLoaderDeps {
  fetchManifest: () => Promise<FrontendModuleManifest[]>
  /** The API server's URL; bundle paths from the manifest resolve against it and must stay on its origin. */
  apiUrl: () => Promise<string>
  fetch: typeof fetch
  auth: {
    disabled: () => boolean
    ensureValidToken: () => Promise<void>
    refresh: () => Promise<void>
    token: () => string | undefined
  }
  /** Evaluates a bundle and returns its exports. */
  importBundle: (code: string) => Promise<any>
  /** The registry the host exposes to module frontends; install() gets a scoped view of it. */
  registry: ComponentRegistry
  hostDependencies: () => HostDependencies | undefined
}

type ManifestIndex = {
  modules: Map<string, FrontendModuleManifest>
  owners: Map<string, string>
}

/**
 * Loads module frontends on demand: nothing before the app mounts, then the manifest on the first
 * `ensure()`, and a module's bundle when one of its component keys is first needed. A module is
 * fetched once. A failure is forgotten, along with a manifest that may be what failed it, so the
 * next `ensure()` — the page's Retry — starts again.
 */
export class ModuleLoader {
  private manifest: Promise<ManifestIndex> | null = null
  private loads = new Map<string, Promise<void>>()

  constructor(private readonly deps: ModuleLoaderDeps) {}

  /**
   * The component registered under `key`, loading its module's frontend first if needed. Throws a
   * ModuleFrontendError when the view cannot be shown.
   */
  async ensure(key: string): Promise<Component> {
    const registered = this.deps.registry.get(key)
    if (registered) return registered as Component

    try {
      const manifest = this.loadManifest()
      const owner = (await manifest).owners.get(key)
      if (!owner) {
        // Perhaps a module installed since the manifest was read; the next try asks again.
        this.forgetManifest(manifest)
        throw new ModuleFrontendError('unloadable', `No module frontend owns the component "${key}"`)
      }
      await this.loadModule(owner)
      const component = this.deps.registry.get(key)
      if (!component) {
        this.loads.delete(owner)
        throw new ModuleFrontendError('unloadable', `Module ${owner} did not register the component "${key}" it declares`)
      }
      return component as Component
    } catch (error) {
      if (error instanceof ModuleFrontendError) throw error
      throw new ModuleFrontendError('unloadable', 'Module frontend not loaded', { cause: error })
    }
  }

  /**
   * Starts loading a module's frontend ahead of need: the results page knows the owner before it
   * knows the key. A module that cannot be used is left for `ensure()` to report.
   */
  prefetch(moduleName: string): void {
    this.loadManifest()
      .then(index => {
        const module = index.modules.get(moduleName)
        if (module && unusable(module) === undefined) return this.loadModule(moduleName)
      })
      .catch(() => {})
  }

  private loadManifest(): Promise<ManifestIndex> {
    if (!this.manifest) {
      const manifest = this.deps.fetchManifest().then(buildIndex)
      this.manifest = manifest
      manifest.catch(error => {
        console.error('Failed to load the module frontend manifest:', error)
        this.forgetManifest(manifest)
      })
    }
    return this.manifest
  }

  private forgetManifest(manifest: Promise<ManifestIndex>): void {
    if (this.manifest === manifest) this.manifest = null
  }

  private loadModule(moduleName: string): Promise<void> {
    let load = this.loads.get(moduleName)
    if (!load) {
      load = this.fetchAndInstall(moduleName)
      this.loads.set(moduleName, load)
      load.catch(error => {
        // Never silenced: a module that fails to load presents as a view that never appears.
        console.error(`Failed to load module ${moduleName}:`, error)
        if (this.loads.get(moduleName) === load) this.loads.delete(moduleName)
      })
    }
    return load
  }

  private async fetchAndInstall(moduleName: string): Promise<void> {
    const start = performance.now()
    let ok = false
    try {
      let manifest = this.loadManifest()
      let index = await manifest
      let module = this.usable(index.modules.get(moduleName), manifest)

      let response = await this.fetchBundle(module.url)
      if (response.status === 404) {
        // A stale hash: the module changed since the manifest was read.
        this.forgetManifest(manifest)
        manifest = this.loadManifest()
        index = await manifest
        module = this.usable(index.modules.get(moduleName), manifest)
        response = await this.fetchBundle(module.url)
      }
      if (response.status === 503) throw new ModuleFrontendError('unavailable', `Module ${moduleName} is unavailable`)
      if (!response.ok) throw new ModuleFrontendError('unloadable', `Module ${moduleName} bundle: HTTP ${response.status}`)

      const bytes = await response.arrayBuffer()
      const hash = await sha256(bytes)
      if (hash !== undefined && hash !== module.hash) {
        throw new ModuleFrontendError('unloadable', `Module ${moduleName} bundle does not match its hash`)
      }
      await this.install(module, index, new TextDecoder().decode(bytes))
      ok = true
    } finally {
      timingMeasure(`dt:module:${moduleName}`, start, ok)
    }
  }

  /** The module, if it can be loaded now. An unavailable one forgets the manifest, to notice recovery. */
  private usable(module: FrontendModuleManifest | undefined, manifest: Promise<ManifestIndex>): FrontendModuleManifest {
    if (!module) throw new ModuleFrontendError('unloadable', 'The module frontend is no longer listed')
    const refusal = unusable(module)
    if (refusal?.kind === 'unavailable') this.forgetManifest(manifest)
    if (refusal) throw refusal
    return module
  }

  /**
   * GET with the bearer token when auth is on; a refused token is refreshed and retried once. Only a
   * bundle path on the API server's origin is fetched, and redirects are refused, so the token
   * never leaves it.
   */
  private async fetchBundle(path: string): Promise<Response> {
    const api = new URL(await this.deps.apiUrl(), globalThis.location?.href)
    const url = new URL(path, api)
    if (url.origin !== api.origin || !url.pathname.startsWith(BUNDLE_PATH_PREFIX)) {
      throw new ModuleFrontendError('unloadable', `Refusing a module bundle URL off the API server: ${url.origin}${url.pathname}`)
    }
    const { auth } = this.deps
    const send = async () => {
      const headers: Record<string, string> = {}
      if (!auth.disabled()) {
        await auth.ensureValidToken()
        const token = auth.token()
        if (token) headers.Authorization = `Bearer ${token}`
      }
      return this.deps.fetch(url.href, { headers, redirect: 'error' })
    }
    const response = await send()
    if (response.status !== 401 || auth.disabled()) return response
    await auth.refresh()
    return send()
  }

  private async install(module: FrontendModuleManifest, index: ManifestIndex, code: string): Promise<void> {
    const host = this.deps.hostDependencies()
    if (!host) throw new Error('Host dependencies not available. Modules must be loaded after app initialization.')

    const exports = await this.deps.importBundle(code)
    const frontend = exports?.default || exports
    if (!frontend || typeof frontend.install !== 'function') {
      throw new ModuleFrontendError('unloadable', `Module ${module.name} has no install function`)
    }
    // Registers only the keys the index gives this module: its own, and no other module's.
    const scoped = this.deps.registry.scoped(
      key => index.owners.get(key) === module.name,
      key => console.error(`Module ${module.name} touched the component "${key}", which it does not own: ignored`),
    )
    await frontend.install({ ...host, services: { ...host.services, componentRegistry: scoped } })
  }

  // Static method to set up host dependencies
  static exposeHostDependencies(VueRuntime?: any, appContext?: any): void {
    window.__HOST_DEPENDENCIES__ = {
      useHostContext,
      services: {
        componentRegistry,
      },
      __VUE__: VueRuntime,
      // Share the host's already-bundled JSONForms engine with module bundles so a
      // module can render a class's schema/uiSchema through JSONForms with its own
      // renderer set. Same single-instance discipline as __VUE__ (one JSONForms bound
      // to the host's one Vue). The host's vue-vuetify renderer set is intentionally
      // not exposed — modules supply renderers in their own design language.
      __JSONFORMS__: { core: JsonFormsCore, vue: JsonFormsVue },
      __APP_CONTEXT__: appContext,
    }

    if (import.meta.env.DEV) {
      console.log('Host dependencies exposed with composable approach')
    }
  }
}

/** Why the module cannot be loaded now, or undefined. */
function unusable(module: FrontendModuleManifest): ModuleFrontendError | undefined {
  if (!module.available) return new ModuleFrontendError('unavailable', `Module ${module.name} is unavailable`)
  if (HOST_API_VERSION < module.hostApi.min || HOST_API_VERSION > module.hostApi.max) {
    return new ModuleFrontendError('host-api', `Module ${module.name} needs host API ${module.hostApi.min}-${module.hostApi.max}, this is ${HOST_API_VERSION}`)
  }
  return undefined
}

/**
 * The key → module index. A key two modules declare belongs to neither: the view fails with a
 * visible error rather than render whichever module happens to win.
 */
function buildIndex(manifests: FrontendModuleManifest[]): ManifestIndex {
  const modules = new Map<string, FrontendModuleManifest>()
  const declaredBy = new Map<string, string[]>()
  for (const module of manifests) {
    modules.set(module.name, module)
    for (const key of module.components) declaredBy.set(key, [...(declaredBy.get(key) ?? []), module.name])
  }
  const owners = new Map<string, string>()
  for (const [key, names] of declaredBy) {
    if (names.length === 1) owners.set(key, names[0])
    else console.error(`The component "${key}" is declared by more than one module (${names.join(', ')}): not loaded`)
  }
  return { modules, owners }
}

/**
 * The bundle's sha256, or undefined where crypto.subtle is missing: it exists only in a secure context,
 * and a deployment served over plain HTTP on a LAN address is not one. The check then is skipped,
 * since the bundle route serves only held, hash-addressed bytes anyway.
 */
async function sha256(bytes: ArrayBuffer): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle) return undefined
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
}

async function importBundle(code: string): Promise<any> {
  const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }))
  try {
    return await import(/* @vite-ignore */ url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Global instance
export const moduleLoader = new ModuleLoader({
  fetchManifest: () => useModulesStore().getFrontendModuleManifest(),
  apiUrl: async () => (await getConfig()).graphqlUrl,
  fetch: (...args) => window.fetch(...args),
  auth: {
    disabled: () => useAuthStore().authDisabled,
    ensureValidToken: () => useAuthStore().ensureValidToken(),
    refresh: () => useAuthStore().performTokenRefresh(),
    token: () => useAuthStore().token || undefined,
  },
  importBundle,
  registry: componentRegistry,
  hostDependencies: () => window.__HOST_DEPENDENCIES__,
})
