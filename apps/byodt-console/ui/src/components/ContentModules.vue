<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api, SessionExpired, type CatalogPackage, type MountedModule } from '@/api'
import { CATALOG_URL } from '@/links'
import Banner from '@/components/Banner.vue'

// The content-module manager: one list, grouped by package, where every module shows its own state —
// a Mount button when it is not mounted, or its currency plus Update (when outdated) and Unmount when it
// is. It owns both fetches (the public catalog and the local mounted inventory) and reloads on
// reloadToken so it stays in step with the rest of the dashboard; it emits 'changed' after any action so
// the dashboard refreshes the pending-restart banner (a mount change needs a stack recreate).
const props = defineProps<{ reloadToken: number }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const packages = ref<CatalogPackage[]>([])
// Keyed by moduleKey alone: only one directory per module key can exist on disk, and a module's content
// is identical across whatever packages list it, so a module mounted from one package reads as mounted
// everywhere it appears.
const mountedByKey = ref<Map<string, MountedModule>>(new Map())
const catalogError = ref('') // the catalog fetch failed; the mounted inventory can still render
const note = ref('') // a non-fatal note on the mounted inventory (e.g. currency could not be judged)
const message = ref('') // the last action's result
const busyKey = ref('') // the module- or package-key currently acting, so only its controls disable
const loaded = ref(false)
// Package bands are collapsed by default so the tab opens as a scannable list of packages, not a wall
// of modules. Keyed by package key; a key present here is expanded.
const expanded = ref<Set<string>>(new Set())
// A mount/unmount only writes files into the modules bind mount — the platform re-scans it at startup,
// so the change is inert until the platform is recreated. Nothing in the mode view reflects that (unlike
// a cloud connect, which flips restartPending), so this flag drives a prominent in-tab reminder. It is a
// sticky session reminder: the console cannot observe the operator running the command, so once an action
// needs a restart it stays until the page is reloaded.
const restartNeeded = ref(false)

function isOpen(key: string): boolean {
  return expanded.value.has(key)
}

function toggle(key: string) {
  const next = new Set(expanded.value)
  next.has(key) ? next.delete(key) : next.add(key)
  expanded.value = next
}

async function load() {
  // Tolerate a partial failure: if the catalog is unreachable but the local inventory loads, still show
  // what is mounted (so it can be unmounted) rather than blanking the whole tab.
  const [cat, mods] = await Promise.allSettled([api.packages(), api.modules()])
  if ([cat, mods].some((r) => r.status === 'rejected' && r.reason instanceof SessionExpired)) return

  if (mods.status === 'fulfilled') {
    mountedByKey.value = new Map(mods.value.modules.map((m) => [m.moduleKey, m]))
    note.value = mods.value.note ?? ''
  } else {
    message.value = mods.reason instanceof Error ? mods.reason.message : 'could not load mounted modules'
  }

  if (cat.status === 'fulfilled') {
    packages.value = cat.value.packages
    catalogError.value = ''
  } else {
    packages.value = []
    catalogError.value = cat.reason instanceof Error ? cat.reason.message : 'could not load the catalog'
  }
  loaded.value = true
}

// Each package decorated with its modules' mount state and its mounted/unmounted counts (which drive the
// package-level Mount all / Unmount all controls).
const view = computed(() =>
  packages.value.map((pkg) => {
    const modules = pkg.modules.map((cat) => ({ cat, mounted: mountedByKey.value.get(cat.key) }))
    return {
      pkg,
      modules,
      mountedCount: modules.filter((m) => m.mounted).length,
      unmountedCount: modules.filter((m) => !m.mounted).length,
      // Only an explicit false gates; undefined (entitlement undetermined) never blocks.
      notSubscribed: pkg.entitled === false,
    }
  }),
)

// Mounted modules the catalog no longer lists (removed upstream, or a package errored). They must still
// be shown so they can be unmounted.
const orphans = computed(() => {
  const inCatalog = new Set(packages.value.flatMap((p) => p.modules.map((m) => m.key)))
  return [...mountedByKey.value.values()].filter((m) => !inCatalog.has(m.moduleKey))
})

const isEmpty = computed(
  () => loaded.value && !catalogError.value && packages.value.length === 0 && orphans.value.length === 0,
)

function chipClass(currency: MountedModule['currency']): string {
  if (currency === 'current') return 'bg-dt-secondary/15 text-dt-accent'
  if (currency === 'outdated') return 'bg-dt-tertiary/15 text-dt-tertiary'
  return 'bg-white/5 text-dt-text-muted'
}

function chipLabel(m: MountedModule): string {
  if (m.currency === 'current') return 'up to date'
  if (m.currency === 'outdated') return `newer available${m.latestVersion ? ` (${m.latestVersion})` : ''}`
  return 'update unknown'
}

// run wraps a single action: it clears the prior message, records the result, emits 'changed', and always
// releases the busy key. A SessionExpired is swallowed here (early return); the next 5s poll's 401 drives
// the App-level sign-in redirect.
async function run(fn: () => Promise<{ message: string }>, fallback: string) {
  message.value = ''
  try {
    const r = await fn()
    message.value = r.message
    restartNeeded.value = true // the mount/unmount is written; it applies on the next platform recreate
    emit('changed')
  } catch (e) {
    if (e instanceof SessionExpired) return
    message.value = e instanceof Error ? e.message : fallback
  } finally {
    busyKey.value = ''
  }
}

function mountOne(packageKey: string, m: { key: string; contentHash: string }) {
  busyKey.value = m.key
  return run(() => api.mountModule({ packageKey, moduleKey: m.key, pin: m.contentHash }), 'could not mount the module')
}

function update(m: MountedModule) {
  if (!m.latestPin) return
  busyKey.value = m.moduleKey
  return run(
    () => api.mountModule({ packageKey: m.packageKey, moduleKey: m.moduleKey, pin: m.latestPin as string }),
    'could not update the module',
  )
}

function unmountOne(moduleKey: string) {
  busyKey.value = moduleKey
  return run(() => api.unmountModule(moduleKey), 'could not unmount the module')
}

function summary(verb: string, ok: number, failed: string[]): string {
  let s = `${verb} ${ok} module${ok === 1 ? '' : 's'}`
  if (failed.length) s += `; ${failed.length} failed: ${failed.join(', ')}`
  return s
}

// mountAll / unmountAll act on a whole package sequentially (the daemon is single-process, and a serial
// loop gives a clean per-module error summary). They emit 'changed' once, at the end, so the dashboard
// reloads a single time rather than after every module.
async function mountAll(pkg: CatalogPackage) {
  const targets = pkg.modules.filter((m) => !mountedByKey.value.has(m.key))
  if (!targets.length) return
  busyKey.value = pkg.key
  message.value = ''
  let ok = 0
  const failed: string[] = []
  try {
    for (const m of targets) {
      try {
        await api.mountModule({ packageKey: pkg.key, moduleKey: m.key, pin: m.contentHash })
        ok++
      } catch (e) {
        if (e instanceof SessionExpired) return
        failed.push(m.name || m.key)
      }
    }
    message.value = summary('Mounted', ok, failed)
    if (ok) {
      restartNeeded.value = true
      emit('changed')
    }
  } finally {
    busyKey.value = ''
  }
}

async function unmountAll(pkg: CatalogPackage) {
  const targets = pkg.modules.filter((m) => mountedByKey.value.has(m.key))
  if (!targets.length) return
  busyKey.value = pkg.key
  message.value = ''
  let ok = 0
  const failed: string[] = []
  try {
    for (const m of targets) {
      try {
        await api.unmountModule(m.key)
        ok++
      } catch (e) {
        if (e instanceof SessionExpired) return
        failed.push(m.name || m.key)
      }
    }
    message.value = summary('Unmounted', ok, failed)
    if (ok) {
      restartNeeded.value = true
      emit('changed')
    }
  } finally {
    busyKey.value = ''
  }
}

watch(
  () => props.reloadToken,
  () => void load(),
)
onMounted(load)
</script>

<template>
  <div class="dt-card p-6 text-sm">
    <!-- A mount/unmount is inert until the platform re-scans the modules directory, and nothing in the
         mode view reflects that — so this is the only place the operator learns a restart is owed. -->
    <Banner
      v-if="restartNeeded"
      tone="warn"
      title="Restart required to apply your changes"
      class="mb-4"
      data-restart-required
    >
      Mounted and unmounted modules take effect when you recreate the platform:
      <code class="ml-1 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-dt-text">byodt restart platform</code>
    </Banner>

    <p v-if="catalogError" class="text-dt-text-muted">{{ catalogError }}</p>
    <p v-else-if="isEmpty" class="text-dt-text-muted" data-empty="true">The catalog is empty.</p>

    <ul v-if="view.length" class="space-y-4">
      <li v-for="row in view" :key="row.pkg.key" data-package>
        <!-- The band header. The title is a toggle that expands the module list (collapsed by default),
             and the bulk actions share the row so they stay aligned with the title; the description sits
             on its own full-width line below and never shifts them. -->
        <div class="flex items-center justify-between gap-3">
          <button
            v-if="row.pkg.modules.length"
            type="button"
            class="flex min-w-0 items-center gap-2 text-left"
            :aria-expanded="isOpen(row.pkg.key)"
            :data-expand="row.pkg.key"
            @click="toggle(row.pkg.key)"
          >
            <svg
              class="h-3.5 w-3.5 shrink-0 text-dt-text-muted transition-transform"
              :class="isOpen(row.pkg.key) ? 'rotate-90' : ''"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              stroke-width="1.75"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M7 5l6 5-6 5" />
            </svg>
            <span class="min-w-0 truncate font-medium">
              {{ row.pkg.name || row.pkg.key }}
              <span v-if="row.pkg.version" class="text-xs font-normal text-dt-text-muted">{{ row.pkg.version }}</span>
            </span>
          </button>
          <p v-else class="min-w-0 truncate font-medium">
            {{ row.pkg.name || row.pkg.key }}
            <span v-if="row.pkg.version" class="text-xs font-normal text-dt-text-muted">{{ row.pkg.version }}</span>
          </p>
          <div v-if="row.pkg.modules.length" class="flex shrink-0 items-center gap-2">
            <!-- A collapsed band still shows how many of its modules are mounted, so the operator can scan
                 without expanding. -->
            <span class="whitespace-nowrap text-xs text-dt-text-muted">{{ row.mountedCount }}/{{ row.pkg.modules.length }} mounted</span>
            <!-- Not subscribed: mounting is inert (the platform 403s the content), so the package can't be
                 mounted — only the path to subscribe. Already-mounted modules stay manageable below. -->
            <template v-if="row.notSubscribed">
              <span class="rounded-full bg-white/5 px-2 py-0.5 text-xs text-dt-text-muted">Not subscribed</span>
              <a
                :href="CATALOG_URL"
                target="_blank"
                rel="noopener noreferrer"
                class="text-xs text-dt-accent hover:underline"
              >Subscribe ↗</a>
            </template>
            <button
              v-else-if="row.unmountedCount"
              type="button"
              :disabled="busyKey === row.pkg.key"
              class="rounded-lg bg-dt-secondary px-3 py-1.5 font-heading text-sm text-dt-surface hover:bg-dt-secondary/80 disabled:opacity-50"
              @click="mountAll(row.pkg)"
            >
              Mount all
            </button>
            <button
              v-if="row.mountedCount"
              type="button"
              :disabled="busyKey === row.pkg.key"
              class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
              @click="unmountAll(row.pkg)"
            >
              Unmount all
            </button>
          </div>
        </div>

        <p v-if="row.pkg.description" class="mt-0.5 text-xs text-dt-text-muted">{{ row.pkg.description }}</p>
        <p v-if="row.pkg.error" class="mt-1 text-xs text-dt-tertiary">{{ row.pkg.error }}</p>

        <ul v-if="row.modules.length && isOpen(row.pkg.key)" class="mt-2 space-y-1">
          <li
            v-for="m in row.modules"
            :key="m.cat.key"
            data-module-row
            class="flex items-start justify-between gap-2 rounded-md border border-dt-border px-3 py-1.5"
          >
            <div class="min-w-0">
              <p>
                <span class="font-medium">{{ m.cat.name || m.cat.key }}</span>
                <span class="ml-1 text-xs text-dt-text-muted">{{ m.cat.version }}</span>
              </p>
              <p v-if="m.cat.description" class="mt-0.5 text-xs text-dt-text-muted">{{ m.cat.description }}</p>
            </div>

            <div v-if="m.mounted" class="flex shrink-0 items-center gap-2">
              <span class="rounded-full px-2 py-0.5 text-xs" :class="chipClass(m.mounted.currency)">
                {{ chipLabel(m.mounted) }}
              </span>
              <button
                v-if="m.mounted.currency === 'outdated'"
                type="button"
                :disabled="busyKey === m.cat.key || busyKey === row.pkg.key"
                class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
                @click="update(m.mounted)"
              >
                Update
              </button>
              <button
                type="button"
                :disabled="busyKey === m.cat.key || busyKey === row.pkg.key"
                class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
                @click="unmountOne(m.cat.key)"
              >
                Unmount
              </button>
            </div>
            <button
              v-else
              type="button"
              :disabled="busyKey === m.cat.key || busyKey === row.pkg.key || row.notSubscribed"
              :title="row.notSubscribed ? 'Not subscribed to this package' : undefined"
              class="shrink-0 rounded-lg bg-dt-secondary px-3 py-1.5 font-heading text-sm text-dt-surface hover:bg-dt-secondary/80 disabled:opacity-50"
              @click="mountOne(row.pkg.key, m.cat)"
            >
              Mount
            </button>
          </li>
        </ul>
      </li>
    </ul>

    <!-- Mounted modules the catalog no longer lists — kept so they remain unmountable. -->
    <div v-if="orphans.length" class="mt-4">
      <p class="font-medium">Mounted — not in catalog</p>
      <ul class="mt-2 space-y-1">
        <li
          v-for="m in orphans"
          :key="m.moduleKey"
          data-module-row
          class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dt-border px-3 py-1.5"
        >
          <div class="min-w-0">
            <p class="font-medium">{{ m.name || m.moduleKey }}</p>
            <p class="truncate text-xs text-dt-text-muted">
              {{ m.packageKey }} · <span class="font-mono">{{ m.pin }}</span>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span class="rounded-full px-2 py-0.5 text-xs" :class="chipClass(m.currency)">{{ chipLabel(m) }}</span>
            <button
              v-if="m.currency === 'outdated'"
              type="button"
              :disabled="busyKey === m.moduleKey"
              class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
              @click="update(m)"
            >
              Update
            </button>
            <button
              type="button"
              :disabled="busyKey === m.moduleKey"
              class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
              @click="unmountOne(m.moduleKey)"
            >
              Unmount
            </button>
          </div>
        </li>
      </ul>
    </div>

    <p v-if="note" class="mt-2 text-xs text-dt-text-muted">{{ note }}</p>
    <p v-if="message" class="mt-2 text-dt-text-muted">{{ message }}</p>

    <!-- Persistent CTA: the portal catalog is where an operator subscribes to more packages. -->
    <p class="mt-4 border-t border-white/10 pt-3 text-xs">
      <a :href="CATALOG_URL" target="_blank" rel="noopener noreferrer" class="text-dt-accent hover:underline">
        Subscribe to more packages ↗
      </a>
    </p>
  </div>
</template>
