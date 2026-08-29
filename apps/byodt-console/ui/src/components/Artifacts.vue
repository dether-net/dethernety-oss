<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  api,
  cloudCredential,
  SessionExpired,
  type CatalogArtifact,
  type CatalogPackage,
  type InstalledArtifact,
} from '@/api'
import { DEPLOYMENT_URL } from '@/links'

// The entitled-artifact panel. An artifact is not a content mount: a mount writes a stub that fetches its
// content per request, while an artifact is signed bytes verified and placed on this deployment. It sits
// inside the content panel rather than beside it because both read one inventory response and both mean the
// same restart — so the parent owns the fetch and the restart banner, and this owns the rows.
//
// It renders what it is given and emits what it cannot do itself: 'changed' after any action (the parent
// reloads and raises the banner) and 'sign-in-required' when there is no access token to act with.
const props = defineProps<{
  packages: CatalogPackage[]
  installed: InstalledArtifact[]
  removalNotice: string
  // This deployment can never obtain a content credential — its configured scope does not include one, as
  // the daemon reports on the catalog read. Passed down because the SPA cannot see it: a deployment without
  // the scope still receives a perfectly good token for the scopes it did request, so the token in hand
  // looks exactly like a working one and every retry looks transient.
  subscriptionUnavailable?: boolean
}>()
const emit = defineEmits<{ (e: 'changed'): void; (e: 'sign-in-required'): void }>()

// Mirrors the daemon's artifact version pattern exactly, leading-zero and width bounds included. A looser
// one here would send a version the daemon answers 400 to, and the operator would read a rejection where
// they should have read a hint.
const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/

// Only this kind is installed onto a deployment. Public protocol vocabulary, not a name.
const CODE_MODULE = 'code-module'
const APPLICATION = 'application'

const message = ref('')
const busyKey = ref('')
// The version typed into a row's "install a specific version" field, keyed by artifact.
const typed = ref<Record<string, string>>({})
// A confirmation the operator has to accept before anything happens. Inline rather than a native dialog:
// there is not one anywhere in this SPA, and a blocking dialog is the wrong shape for a consequence this
// long. Exactly one can be open at a time.
const pending = ref<
  | { kind: 'downgrade'; artifactKey: string; version: string; installedVersion: string }
  | { kind: 'remove'; artifactKey: string; name: string }
  | undefined
>()

// compareVersion is the daemon's comparison, in the browser. Numeric and not lexical, so 1.10.0 is newer
// than 1.9.0; readability is the same pattern an install request must satisfy, so an unreadable value on
// either side answers false rather than comparing wrong.
//
// It exists here because the catalog response is per-package by design and BOTH sides fold it — the daemon
// to judge currency, this panel to decide what the Install button sends. Two folds of one rule have to
// agree, or the badge and the button describe different versions.
function compareVersion(a: string, b: string): number | undefined {
  if (!VERSION.test(a) || !VERSION.test(b)) return undefined
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  }
  return 0
}

// One artifact granted by several packages is ONE row, and the fold has to match the daemon's on every
// case or the two disagree about what is installable:
//   - a readable latest beats a non-empty unreadable one, which beats an absent one;
//   - among readable, strictly greater replaces, so a tie keeps the first;
//   - the WHOLE entry travels with the winner — kind, name, target, description — because the daemon reads
//     those off the same winning entry.
// Entitlement folds separately and by its own rule: entitled if ANY granting package is, undetermined only
// if all of them are.
type Row = {
  key: string
  entry?: CatalogArtifact
  installed?: InstalledArtifact
  entitled?: boolean
}

function better(a: CatalogArtifact, b: CatalogArtifact): boolean {
  const aReadable = VERSION.test(a.latest ?? '')
  const bReadable = VERSION.test(b.latest ?? '')
  if (aReadable && !bReadable) return true
  if (aReadable && bReadable) return (compareVersion(a.latest as string, b.latest as string) ?? 0) > 0
  if (!aReadable && !bReadable) return !b.latest && !!a.latest
  return false
}

const rows = computed<Row[]>(() => {
  const byKey = new Map<string, Row>()
  for (const pkg of props.packages) {
    for (const a of pkg.artifacts ?? []) {
      const row = byKey.get(a.key)
      if (!row) {
        byKey.set(a.key, { key: a.key, entry: a, entitled: pkg.entitled })
        continue
      }
      if (row.entry && better(a, row.entry)) row.entry = a
      if (pkg.entitled === true) row.entitled = true
      else if (row.entitled !== true && pkg.entitled === false) row.entitled = false
    }
  }
  // The union, not the catalog fold. The parent empties its package list when the catalog is unreachable,
  // and an installed artifact that vanished then would take its Remove control with it — exactly when
  // removal is the operator's only remedy.
  for (const inst of props.installed) {
    const row = byKey.get(inst.artifactKey)
    if (row) row.installed = inst
    else byKey.set(inst.artifactKey, { key: inst.artifactKey, installed: inst })
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key))
})

function displayName(row: Row): string {
  return row.installed?.name || row.entry?.name || row.key
}

// One source of truth per row, in one direction: an installed artifact's kind comes from the daemon's own
// resolution, and the catalog fold is the fallback. Two catalog reads taken at two moments must not be able
// to render two different answers about the same artifact.
function kindOf(row: Row): string {
  return row.installed?.kind || row.entry?.kind || ''
}

function isApplication(row: Row): boolean {
  return kindOf(row) === APPLICATION
}

// Anything that is not a module has no Install control — INCLUDING an empty kind, which is reachable
// whenever the catalog could not be reached for something already installed. Treating empty as installable
// would put an Install button on the one kind whose whole point is that it is not installed here.
function installable(row: Row): boolean {
  return kindOf(row) === CODE_MODULE && row.entitled !== false
}

// The version the primary button sends, or '' when there is nothing to offer. `latest` is a catalog string
// the operator never typed and the fold propagates an unreadable one deliberately, so it is validated with
// the same pattern the typed field uses.
//
// And it is compared against what is installed, because offering it unconditionally offered two things the
// daemon cannot accept. In the two states artifactCurrency reports as `unknown` — installed ABOVE the
// catalog's latest, and an installed version this console cannot read — the daemon withholds latestVersion
// precisely so that nothing prompts a move backwards; rebuilding the prompt from the raw catalog entry
// undid that, and the click could only earn a 409. An unreadable comparison is treated the same way, since
// the daemon refuses that install on its own terms too.
function offered(row: Row): string {
  if (row.installed?.currency === 'unavailable') return ''
  const latest = row.entry?.latest ?? ''
  if (!VERSION.test(latest)) return ''
  const current = row.installed?.version
  if (current === undefined) return latest
  const cmp = compareVersion(latest, current)
  return cmp === 0 || cmp === 1 ? latest : ''
}

// Three labels because there are three true things to say. Re-installing the identical version is the
// documented repair path and the daemon allows it, so the control stays — it was the word "Update" that was
// false about it, on every up-to-date row of every healthy deployment.
function offerLabel(row: Row): string {
  if (!row.installed) return 'Install'
  return compareVersion(offered(row), row.installed.version) === 0 ? 'Reinstall' : 'Update'
}

function currencyLabel(inst: InstalledArtifact): string {
  if (inst.currency === 'current') return 'up to date'
  if (inst.currency === 'outdated') return `newer available${inst.latestVersion ? ` (${inst.latestVersion})` : ''}`
  if (inst.currency === 'unavailable') return 'no longer published'
  return 'update unknown'
}

function currencyClass(inst: InstalledArtifact): string {
  if (inst.currency === 'current') return 'bg-dt-secondary/15 text-dt-accent'
  if (inst.currency === 'outdated') return 'bg-dt-tertiary/15 text-dt-tertiary'
  return 'bg-white/5 text-dt-text-muted'
}

// run wraps one action: it clears the prior message, records the result, emits 'changed' so the parent
// reloads and raises the restart reminder, and always releases the busy key. A SessionExpired is swallowed
// here; the App-level poll drives the sign-in redirect.
async function run(key: string, fn: () => Promise<{ message: string }>, fallback: string) {
  busyKey.value = key
  message.value = ''
  pending.value = undefined
  try {
    const r = await fn()
    message.value = r.message
    emit('changed')
  } catch (e) {
    if (e instanceof SessionExpired) return
    message.value = e instanceof Error ? e.message : fallback
  } finally {
    busyKey.value = ''
  }
}

function install(key: string, version: string, allowDowngrade = false) {
  // Three states, three arms — api.ts enumerates them and says telling the last two apart is the
  // difference between a recovery and a loop. Both early returns clear `pending` first: this is reachable
  // from confirmDowngrade, only run() clears it, and a return that skips run() would leave the accept card
  // open above a sentence about something else.
  // Before the token states, because it outranks them: no sign-in this deployment can perform will help,
  // so offering one is the loop rather than the recovery — the same reason the no-content-scope arm below
  // does not offer one either. The token in hand is genuine, so nothing below could tell.
  if (props.subscriptionUnavailable) {
    pending.value = undefined
    message.value =
      'This deployment cannot obtain a credential for the content service: its configuration does not carry the permission an install needs. Regenerate the deployment recipe and reconnect, then try again.'
    return
  }
  const cred = cloudCredential()
  if (cred === 'signed-out') {
    // A reloaded tab is signed in with a live session and no tokens at all — both are memory-only and set
    // only in the sign-in callback — which is exactly the state the restart prompt invites. Ask for a
    // sign-in rather than sending a request that can only be refused.
    pending.value = undefined
    emit('sign-in-required')
    return
  }
  if (cred === 'no-content-scope') {
    // Signed in, but the token exchange returned no access token. Signing in again returns the same empty
    // token forever, so a redirect here is the loop rather than the recovery.
    pending.value = undefined
    message.value =
      'This deployment is signed in but its sign-in returned no credential for the content service. Regenerate the deployment recipe and reconnect this deployment, then try again.'
    return
  }
  return run(
    key,
    () => api.installArtifact(allowDowngrade ? { artifactKey: key, version, allowDowngrade } : { artifactKey: key, version }),
    'could not install the artifact',
  )
}

// The typed-version install. The confirmation fires on the COMPARISON and not merely on something being
// installed: allowDowngrade is the one input that turns the daemon's guard off, so attaching it to every
// typed install would disable the check that stops a withdrawn version from walking this deployment
// backwards. An equal version is the documented repair path and is not a downgrade; an unreadable installed
// version is refused by the daemon on its own terms, which is the true thing to tell the operator.
function installTyped(row: Row) {
  const version = (typed.value[row.key] ?? '').trim()
  if (!VERSION.test(version)) {
    message.value = 'Enter a version as MAJOR.MINOR.PATCH, for example 1.2.0.'
    return
  }
  const current = row.installed?.version ?? ''
  if (current && compareVersion(version, current) === -1) {
    pending.value = { kind: 'downgrade', artifactKey: row.key, version, installedVersion: current }
    return
  }
  return install(row.key, version)
}

function confirmDowngrade() {
  const p = pending.value
  if (p?.kind !== 'downgrade') return
  return install(p.artifactKey, p.version, true)
}

function confirmRemove() {
  const p = pending.value
  if (p?.kind !== 'remove') return
  return run(p.artifactKey, () => api.removeArtifact(p.artifactKey), 'could not remove the artifact')
}

function askRemove(row: Row) {
  message.value = ''
  pending.value = { kind: 'remove', artifactKey: row.key, name: displayName(row) }
}
</script>

<template>
  <div v-if="rows.length" class="mb-4" data-artifacts>
    <p class="font-medium">Artifacts</p>
    <p class="mt-0.5 text-xs text-dt-text-muted">
      Signed components installed onto this deployment, verified against their publisher before anything is
      placed.
    </p>

    <ul class="mt-2 space-y-1">
      <li
        v-for="row in rows"
        :key="row.key"
        data-artifact-row
        :data-artifact-installable="installable(row) ? 'true' : 'false'"
        class="rounded-md border border-dt-border px-3 py-1.5"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="min-w-0">
            <p>
              <span class="font-medium">{{ displayName(row) }}</span>
              <span v-if="row.installed" class="ml-1 text-xs text-dt-text-muted">{{ row.installed.version }}</span>
            </p>
            <p v-if="row.entry?.description" class="mt-0.5 text-xs text-dt-text-muted">{{ row.entry.description }}</p>
          </div>

          <div class="flex shrink-0 flex-wrap items-center gap-2">
            <span
              v-if="row.installed"
              class="rounded-full px-2 py-0.5 text-xs"
              :class="currencyClass(row.installed)"
              data-artifact-currency
            >{{ currencyLabel(row.installed) }}</span>
            <span
              v-if="row.entitled === false"
              class="rounded-full bg-white/5 px-2 py-0.5 text-xs text-dt-text-muted"
              data-artifact-not-subscribed
            >Not subscribed</span>

            <!-- An application is used where its operator runs it; there is nothing on this deployment to
                 install it into, so the row offers the portal instead of a control that cannot work. -->
            <a
              v-if="isApplication(row)"
              :href="DEPLOYMENT_URL"
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs text-dt-accent hover:underline"
              data-artifact-portal-link
            >Use it from the portal ↗</a>

            <button
              v-if="installable(row) && offered(row)"
              type="button"
              :disabled="busyKey === row.key"
              class="rounded-lg bg-dt-secondary px-3 py-1.5 font-heading text-sm text-dt-surface hover:bg-dt-secondary/80 disabled:opacity-50"
              data-artifact-install
              @click="install(row.key, offered(row))"
            >
              {{ offerLabel(row) }} {{ offered(row) }}
            </button>

            <button
              v-if="row.installed"
              type="button"
              :disabled="busyKey === row.key"
              class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
              data-artifact-remove
              @click="askRemove(row)"
            >
              Remove
            </button>
          </div>
        </div>

        <!-- A typed version rather than a menu: the catalog names one version per artifact, so there is no
             list to choose from, and installing an earlier one is something the operator asks for by name. -->
        <div v-if="installable(row)" class="mt-1.5 flex flex-wrap items-center gap-2">
          <label :for="`v-${row.key}`" class="text-xs text-dt-text-muted">Install a specific version</label>
          <input
            :id="`v-${row.key}`"
            v-model="typed[row.key]"
            type="text"
            inputmode="numeric"
            placeholder="1.2.0"
            class="w-28 rounded-md border border-dt-border bg-transparent px-2 py-1 font-mono text-xs text-dt-text"
            :data-artifact-version-input="row.key"
          />
          <button
            type="button"
            :disabled="busyKey === row.key"
            class="rounded-lg border border-dt-border px-3 py-1 text-xs text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
            data-artifact-install-typed
            @click="installTyped(row)"
          >
            Install version
          </button>
        </div>
      </li>
    </ul>

    <!-- The downgrade confirmation. It names BOTH versions, and it is the only thing that lets the request
         carry the flag the daemon needs to allow an earlier version at all. -->
    <div
      v-if="pending?.kind === 'downgrade'"
      class="mt-2 rounded-md border border-dt-tertiary/40 bg-dt-tertiary/5 px-3 py-2"
      data-artifact-downgrade-confirm
    >
      <p class="text-sm">
        Version <span class="font-mono">{{ pending.version }}</span> is older than the installed
        <span class="font-mono">{{ pending.installedVersion }}</span
        >. Installing it moves this deployment backwards.
      </p>
      <div class="mt-2 flex items-center gap-2">
        <button
          type="button"
          class="rounded-lg bg-dt-secondary px-3 py-1.5 font-heading text-sm text-dt-surface hover:bg-dt-secondary/80"
          data-artifact-downgrade-accept
          @click="confirmDowngrade()"
        >
          Install {{ pending.version }} anyway
        </button>
        <button
          type="button"
          class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted"
          data-artifact-downgrade-cancel
          @click="pending = undefined"
        >
          Cancel
        </button>
      </div>
    </div>

    <!-- The removal confirmation. What removing does to the graph is said HERE, before the operator
         accepts — not afterwards, when it is no longer a decision. -->
    <div
      v-if="pending?.kind === 'remove'"
      class="mt-2 rounded-md border border-dt-tertiary/40 bg-dt-tertiary/5 px-3 py-2"
      data-artifact-remove-confirm
    >
      <p class="text-sm font-medium">Remove {{ pending.name }}?</p>
      <p v-if="removalNotice" class="mt-1 text-xs text-dt-text-muted" data-artifact-remove-consequence>
        {{ removalNotice }}
      </p>
      <div class="mt-2 flex items-center gap-2">
        <button
          type="button"
          class="rounded-lg border border-dt-quinary/60 px-3 py-1.5 text-sm text-dt-quinary hover:bg-white/5"
          data-artifact-remove-accept
          @click="confirmRemove()"
        >
          Remove
        </button>
        <button
          type="button"
          class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted"
          data-artifact-remove-cancel
          @click="pending = undefined"
        >
          Cancel
        </button>
      </div>
    </div>

    <p v-if="message" class="mt-2 text-xs text-dt-text-muted" data-artifact-message>{{ message }}</p>
  </div>
</template>
