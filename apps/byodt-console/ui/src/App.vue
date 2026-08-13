<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  api,
  clearSession,
  clearIdToken,
  hasSession,
  mintCloud,
  mintLocal,
  SessionExpired,
  type ModeView,
  type PostureView,
  type StateView,
} from '@/api'
import { completeSignIn, consoleRedirectUri, type OidcConfig } from '@/auth'
import { PORTAL_URL, GUIDE_URL, PLATFORM_URL } from '@/links'
import LoginCard from '@/components/LoginCard.vue'
import PhaseBadge from '@/components/PhaseBadge.vue'
import Banner from '@/components/Banner.vue'
import StatusHero from '@/components/StatusHero.vue'
import UpgradeRail from '@/components/UpgradeRail.vue'
import FailureBanner from '@/components/FailureBanner.vue'
import ModulesTable from '@/components/ModulesTable.vue'
import IngestPanel from '@/components/IngestPanel.vue'
import CloudPanel from '@/components/CloudPanel.vue'
import CloudNotice, { type CloudNoticeData } from '@/components/CloudNotice.vue'
import ContentModules from '@/components/ContentModules.vue'

const POLL_MS = 5000

// The deployment posture, read ungated from the daemon before any session exists. It decides which
// sign-in the SPA presents (local auto-mints with no credential; cloud runs SSO) and carries the OIDC
// discovery values the cloud PKCE needs pre-session.
const posture = ref<PostureView | null>(null)
const signedIn = ref(false)
const signInError = ref('') // a local-mint failure or a cloud sign-in "retry" — shown by the sign-in area
const mode = ref<ModeView | null>(null)
const state = ref<StateView | null>(null)
const loadError = ref('')
const cloudNotice = ref<CloudNoticeData | null>(null) // an actionable cloud-phase failure (alert)
// Bumped after any content mount change so the two content panels reload in step, and paired with a
// dashboard refresh so the pending-restart banner reflects the owed stack recreate.
const contentReload = ref(0)
let timer: ReturnType<typeof setInterval> | undefined
// Bounds the local auto-remint recovery: a healthy re-mint is honored by the next poll (which resets
// this to 0), so >2 consecutive failures means the session keeps being rejected — stop rather than spin.
let localRemintAttempts = 0

// The dashboard is tabbed so the content catalog doesn't shout on first load. The Content tab appears
// only once the platform is actually running in cloud mode; if that goes away while it is selected, the
// watcher below falls back to Overview.
const activeTab = ref<'overview' | 'cloud' | 'content'>('overview')
const tabs = computed(() => {
  const t: { id: typeof activeTab.value; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'cloud', label: 'Cloud' },
  ]
  if (mode.value?.phase === 'post-cloud') t.push({ id: 'content', label: 'Content' })
  return t
})
watch(tabs, (list) => {
  if (!list.some((t) => t.id === activeTab.value)) activeTab.value = 'overview'
})

// The always-visible alerts region: anything the operator must see regardless of which tab is open.
const hasAlerts = computed(
  () =>
    !!loadError.value ||
    !!(mode.value && mode.value.restartPending) ||
    !!(state.value && state.value.failures.length) ||
    !!cloudNotice.value,
)

// The OIDC discovery config the cloud SSO card and the initial-sign-in callback both run against, sourced
// from the ungated posture read (available before a session exists, unlike /api/mode).
function oidcFromPosture(): OidcConfig {
  const p = posture.value
  return { domain: p?.oidcDomain ?? '', clientId: p?.oidcClientId ?? '', scope: p?.oidcScope ?? '' }
}

async function refresh() {
  try {
    mode.value = await api.mode()
    state.value = await api.state()
    loadError.value = ''
    localRemintAttempts = 0 // a poll succeeded — the session is healthy, so reset the recovery guard
  } catch (e) {
    if (e instanceof SessionExpired) {
      toLogin()
      return
    }
    // A non-session error (e.g. a 500 reading the init state) is surfaced rather than swallowed:
    // on first load there is no last-known view to fall back to, so without this the dashboard
    // would render blank with no signal. The banner stays until the next tick succeeds.
    loadError.value = e instanceof Error ? e.message : 'failed to load deployment state'
  }
}

function toLogin() {
  if (timer) clearInterval(timer)
  timer = undefined
  clearSession()
  clearIdToken()
  signedIn.value = false
  mode.value = null
  state.value = null
  loadError.value = ''
  cloudNotice.value = null
  void reestablish()
}

// reestablish re-reads the LIVE posture, then re-establishes the session for it. The posture must be
// re-read (not the value cached at mount): a connect/disconnect flips posture on disk AND flushes the
// session, so the 401 that lands here usually coincides with a flip — recovering against the stale
// posture would render the wrong sign-in (or fail the mint) for the new one.
async function reestablish() {
  try {
    posture.value = await api.posture()
  } catch {
    signInError.value = 'Could not reach the console. Reload to retry.'
    return
  }
  await ensureSignedIn()
}

function startPolling() {
  if (timer) return // guard against a second timer — this is reachable from several entry points now
  void refresh()
  timer = setInterval(() => void refresh(), POLL_MS)
}

function onSignedIn() {
  signInError.value = ''
  signedIn.value = true
  startPolling()
}

// ensureSignedIn drives the sign-in surface off the posture: a persisted session just resumes; local
// posture mints with no credential and opens the dashboard; cloud posture with no session leaves the SSO
// card on screen (nothing to do here — the template renders it).
async function ensureSignedIn() {
  if (hasSession()) {
    onSignedIn()
    return
  }
  if (posture.value?.posture === 'local') {
    if (localRemintAttempts >= 2) {
      signInError.value = 'The console session keeps ending. Reload to retry.'
      return
    }
    localRemintAttempts++
    try {
      await mintLocal()
      onSignedIn()
    } catch {
      signInError.value = 'Could not start the console session. Reload to retry.'
    }
  }
}

function onContentChanged() {
  contentReload.value++ // reload both content panels
  void refresh() // a mount change needs a stack recreate — update the pending banner
}

// After the cloud PKCE sign-in, the hosted UI redirects back to /auth/callback?code&state. The code is
// stripped from the URL immediately so it never lingers in history, then the callback is completed: it
// serves a single intent — an operator completing the INITIAL cloud sign-in, so its ID token mints the
// session and is retained (in memory) for gated requests.
async function handleCallback() {
  const params = new URLSearchParams(window.location.search)
  // Cognito can return an error instead of a code (e.g. redirect_mismatch, access_denied). Surface
  // it and clean the URL rather than failing silently with the error left in the address bar.
  const authError = params.get('error')
  if (authError) {
    window.history.replaceState({}, '', import.meta.env.BASE_URL)
    const description = params.get('error_description') || ''
    if (authError === 'redirect_mismatch') {
      // The provider rejected the console's callback because it is not registered — the one failure
      // that leaves nothing in any log we own, so the console names the exact value to register.
      cloudNotice.value = {
        title: "This console's sign-in callback is not registered",
        message:
          description ||
          'The identity provider rejected the sign-in because the callback below is not a registered redirect URI.',
        registerUri: consoleRedirectUri(),
        recovery: ['Register the callback above with your identity provider (it must match exactly).', 'Then sign in again.'],
      }
    } else {
      cloudNotice.value = {
        title: 'Cloud sign-in failed',
        message: description || `The identity provider returned an error: ${authError}.`,
      }
    }
    return
  }
  const code = params.get('code')
  const stateParam = params.get('state')
  if (!code || !stateParam) {
    // A code with no state (malformed or tampered callback) must still be stripped so it never lingers.
    if (code) window.history.replaceState({}, '', import.meta.env.BASE_URL)
    return
  }
  window.history.replaceState({}, '', import.meta.env.BASE_URL)

  // Complete the exchange against the posture's discovery values (mode() is gated and unavailable
  // pre-session) and mint the cloud session by presenting the ID token.
  try {
    const idToken = await completeSignIn(oidcFromPosture(), consoleRedirectUri(), code, stateParam)
    await mintCloud(idToken) // sets the session and retains the ID token for gated requests
    onSignedIn()
  } catch (e) {
    signInError.value = e instanceof Error ? e.message : 'Cloud sign-in failed.'
  }
}

onMounted(async () => {
  try {
    posture.value = await api.posture()
  } catch {
    // The daemon that serves this SPA is unexpectedly unreachable; without the posture no session can be
    // established. Surface it rather than spinning on a blank screen.
    signInError.value = 'Could not reach the console. Reload to retry.'
    return
  }
  await handleCallback()
  await ensureSignedIn()
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="page-gradient min-h-screen">
    <!-- Chrome: a slim sticky header carrying the brand and, top-right, the phase — the same shape as the
         account portal. Rendered only once signed in; the sign-in screen is a bare centered card. -->
    <header
      v-if="signedIn"
      class="sticky top-0 z-50 border-b border-white/10 bg-dt-surface/80 backdrop-blur-md"
    >
      <div class="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-6 py-3">
        <span class="font-heading text-sm font-bold text-dt-text">Dethernety</span>
        <span class="font-heading text-xs text-dt-text-muted">Console</span>
        <div class="ml-auto flex items-center gap-x-3">
          <!-- The way back to the product: the platform is served at the front-door root. -->
          <a :href="PLATFORM_URL" class="font-heading text-xs text-dt-accent hover:underline">Open platform →</a>
          <!-- The signed-in operator (cloud posture only; local mints carry no identity). -->
          <span v-if="mode?.user" class="hidden text-xs text-dt-text-muted sm:inline">{{ mode.user.name || mode.user.email }}</span>
          <PhaseBadge v-if="mode" :mode="mode" />
        </div>
      </div>
    </header>

    <main class="relative z-10 mx-auto max-w-6xl px-6 py-10">
      <!-- Not signed in: cloud posture shows the SSO card; local posture auto-mints, so it shows only a
           brief "starting" line (no card — unauthenticated-local is intentional). A sign-in failure (a
           local mint error, or a cloud "retry") surfaces below, and a callback error (e.g. the console's
           redirect not registered) must be diagnosable here too, before any dashboard exists. -->
      <div v-if="!signedIn" class="flex min-h-[55vh] flex-col items-center justify-center gap-3">
        <LoginCard v-if="posture?.posture === 'cloud'" :oidc="oidcFromPosture()" />
        <section v-else class="dt-card max-w-md p-8 text-center">
          <p v-if="!signInError" class="text-sm text-dt-text-muted">Starting the console…</p>
        </section>
        <p v-if="signInError" role="alert" class="text-sm text-dt-quinary">{{ signInError }}</p>
        <CloudNotice v-if="cloudNotice" :notice="cloudNotice" class="w-full max-w-md" />
      </div>

      <div v-else class="space-y-6">
        <!-- Page header -->
        <div>
          <h1 class="font-heading text-2xl font-bold tracking-[-0.02em] text-dt-text sm:text-3xl">
            Deployment
          </h1>
          <p class="mt-1 text-sm text-dt-text-muted">
            Status for this box.<span v-if="state?.initRan && state.tag">
              · Init {{ state.tag }}<span v-if="state.ranAt"> · {{ state.ranAt }}</span></span
            >
          </p>
        </div>

        <!-- Now-region: always-visible alerts, above the tabs, so a failure is never behind a tab.
             Priority order — load error, pending restart, module/ingest failures, cloud notice. -->
        <div v-if="hasAlerts" class="space-y-2">
          <Banner v-if="loadError" tone="fault" title="Could not load deployment state">
            {{ loadError }} — retrying…
          </Banner>

          <Banner
            v-if="mode && mode.restartPending"
            tone="warn"
            :title="mode.cloudFileWritten ? 'Cloud configuration not yet applied' : 'Revert to pure open-source not yet applied'"
          >
            <template v-if="mode.cloudFileWritten">
              A cloud configuration is written but the platform is not running it — recreate the stack to
              apply it:
              <code class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-dt-text">byodt restart</code>. A deployment that was rolled
              back to before it was connected shows this too; the same command re-applies it.
            </template>
            <template v-else>
              A revert to the pure open-source configuration is written but not yet applied — recreate the
              stack to complete it:
              <code class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-dt-text">byodt restart</code>
            </template>
          </Banner>

          <FailureBanner v-for="(f, i) in state?.failures ?? []" :key="`${f.kind}-${i}`" :failure="f" />

          <CloudNotice v-if="cloudNotice" :notice="cloudNotice" />
        </div>

        <!-- At-a-glance health -->
        <StatusHero v-if="state" :state="state" />

        <!-- Open-source-edition funnel: only in local posture. Selecting it opens the Cloud tab. -->
        <UpgradeRail v-if="posture?.posture === 'local'" @connect="activeTab = 'cloud'" />

        <!-- Tabs -->
        <nav class="flex flex-wrap gap-1 border-b border-white/10">
          <button
            v-for="t in tabs"
            :key="t.id"
            type="button"
            :data-tab="t.id"
            :aria-selected="activeTab === t.id"
            class="-mb-px border-b-2 px-3 py-2 font-heading text-sm transition-colors"
            :class="
              activeTab === t.id
                ? 'border-dt-secondary text-dt-text'
                : 'border-transparent text-dt-text-muted hover:text-dt-text'
            "
            @click="activeTab = t.id"
          >
            {{ t.label }}
          </button>
        </nav>

        <!-- Overview -->
        <section v-show="activeTab === 'overview'" class="space-y-6">
          <div v-if="state">
            <h2 class="mb-2 font-heading text-sm font-semibold text-dt-text">Modules</h2>
            <ModulesTable :modules="state.modules" />
          </div>
          <div v-if="state">
            <h2 class="mb-2 font-heading text-sm font-semibold text-dt-text">Data ingest</h2>
            <IngestPanel :ingest="state.ingest" />
          </div>
        </section>

        <!-- Cloud -->
        <section v-show="activeTab === 'cloud'">
          <CloudPanel v-if="mode" :mode="mode" @changed="refresh" />
        </section>

        <!-- Content — exists only once the platform is running in cloud mode. -->
        <template v-if="mode && mode.phase === 'post-cloud'">
          <section v-show="activeTab === 'content'" class="space-y-4">
            <ContentModules :reload-token="contentReload" @changed="onContentChanged" />
          </section>
        </template>
      </div>
    </main>

    <!-- Outward links to the BYODt portal and its guide. Shown in both states — useful to a
         prospective operator at the sign-in screen as well as after signing in. -->
    <footer class="relative z-10 mx-auto max-w-6xl px-6 pb-10 text-center text-xs text-dt-text-muted">
      <a :href="PORTAL_URL" target="_blank" rel="noopener noreferrer" class="hover:text-dt-text">BYODt Portal ↗</a>
      <span class="mx-2">·</span>
      <a :href="GUIDE_URL" target="_blank" rel="noopener noreferrer" class="hover:text-dt-text">Guide ↗</a>
    </footer>
  </div>
</template>
