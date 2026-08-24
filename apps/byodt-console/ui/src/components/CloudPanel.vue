<script setup lang="ts">
import { ref, computed } from 'vue'
import { api, SessionExpired, type ModeView } from '@/api'
import { consoleRedirectUri } from '@/auth'
import { DEPLOYMENT_URL } from '@/links'

const props = defineProps<{ mode: ModeView }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const recipe = ref('')
// The platform's front-door OIDC callback: origin + /auth/callback. The console shares the front door's
// origin (served under /console/ on the same host and port), so this is fixed — no port to correct and
// nothing for the operator to confirm. It is the PLATFORM's OIDC_REDIRECT_URI, sent with the recipe on
// apply; the console's own PKCE callback is consoleRedirectUri(). Both are listed in step 1 to register.
const redirectUri = window.location.origin + '/auth/callback'
const message = ref('')
const busy = ref(false)

// The two callbacks cloud sign-in uses — the platform's front door and this console's own — one per
// line, in the shape the account's "Callback URLs" field takes (one per line). Both must be registered
// with the identity provider (exact match); if either is not, sign-in is rejected at the provider
// before returning, so this is the surface where that failure is diagnosable. The platform value is the
// fixed front-door callback (origin + /auth/callback), so what you register matches what the recipe applies.
const callbacksText = computed(() => [redirectUri, consoleRedirectUri()].join('\n'))
const callbacksEl = ref<HTMLTextAreaElement | null>(null)
const copied = ref(false)
const copyHint = ref('Copied.')
async function copyCallbacks() {
  try {
    await navigator.clipboard.writeText(callbacksText.value)
    copied.value = true
    copyHint.value = 'Copied.'
  } catch {
    // No clipboard permission, or an insecure context: select the text so it can be copied by hand —
    // and SAY so, because a silent selection looks identical to a button that does nothing.
    callbacksEl.value?.select()
    copied.value = true
    copyHint.value = 'Selected — press ⌘C (Ctrl+C) to copy.'
  }
}

async function apply() {
  busy.value = true
  message.value = 'Applying…'
  try {
    const r = await api.cloudApply(recipe.value, redirectUri)
    message.value = r.message
    recipe.value = ''
    emit('changed')
  } catch (e) {
    if (e instanceof SessionExpired) return
    message.value = e instanceof Error ? e.message : 'failed'
  } finally {
    busy.value = false
  }
}

// Disconnect asks first. Inline rather than a native dialog, matching Artifacts.vue: there is not one
// anywhere in this SPA, and what a disconnect does takes more than a sentence to say.
//
// The card names the CONSEQUENCE, not just the action, because the consequence is the decision. A
// disconnect removes every cloud-provided module — the console deletes files and issues no database
// command — and the platform then drops from the graph any module it no longer finds on disk, together
// with the classes that module declared and every link to them. Reconnecting restores the classes but not
// the links, so this is not an undo, and saying so afterwards would be saying it too late.
//
// The wording tracks artifactRemovalConsequence, which the artifact panel already shows before a single
// removal. Same event, same sentence: one confirmation should not describe it more gently than the other.
const confirming = ref(false)

function askDisconnect() {
  message.value = ''
  confirming.value = true
}

function cancelDisconnect() {
  confirming.value = false
}

async function confirmDisconnect() {
  confirming.value = false
  busy.value = true
  message.value = 'Reverting…'
  try {
    const r = await api.cloudDisable()
    message.value = r.message
    emit('changed')
  } catch (e) {
    if (e instanceof SessionExpired) return
    message.value = e instanceof Error ? e.message : 'failed'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="dt-card p-6 text-sm">
    <!-- Entry point: the operator fetches their login recipe from the account portal, registers the
         callbacks (step 1), then pastes the recipe (step 2). The link leads to where the recipe is
         issued; it stays visible in every state as the way back to the portal. -->
    <p class="mb-6">
      <a
        :href="DEPLOYMENT_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="text-sm text-dt-accent hover:underline"
      >Get your deployment recipe ↗</a>
    </p>

    <!-- 1 · Access and callbacks — the two callbacks the account needs registered. Read-only + Copy:
         the operator copies these and pastes them into the account's Callback URLs field. Kept first,
         and always shown, because it is a prerequisite for cloud sign-in independent of connect state. -->
    <section aria-label="Access and callbacks" data-section="callbacks">
      <h3 class="mb-2 font-heading text-sm text-dt-text">
        <span class="text-dt-text-muted">1 ·</span> Access and callbacks
      </h3>
      <p class="mb-2 text-dt-text-muted">
        Register these two callback URLs with your account — copy them and paste into the portal's
        <span class="text-dt-text">Callback URLs</span> field (one per line). Both must match exactly,
        or cloud sign-in is rejected at the identity provider.
      </p>
      <textarea
        ref="callbacksEl"
        class="w-full rounded border border-dt-border bg-dt-background px-2 py-1 font-mono text-xs text-dt-text"
        rows="2"
        readonly
        :value="callbacksText"
        aria-label="callback URLs"
        data-testid="callbacks"
      ></textarea>
      <div class="mt-2 flex items-center gap-3">
        <button
          type="button"
          class="rounded bg-dt-secondary px-3 py-1.5 font-heading text-sm text-dt-surface"
          @click="copyCallbacks"
        >
          Copy
        </button>
        <span v-if="copied" class="text-xs text-dt-text-muted" aria-live="polite">{{ copyHint }}</span>
      </div>
      <p class="mt-2 text-xs text-dt-text-muted">
        First line is the platform's sign-in, second is this console's own. Local development addresses
        are always accepted and are not listed here.
      </p>
    </section>

    <hr class="my-6 border-dt-border" />

    <!-- 2 · Configuration — connect (paste the login recipe), or the connected / pending-restart
         states. Numbered and titled so the two steps read as an obvious sequence. -->
    <section aria-label="Configuration" data-section="configuration">
      <h3 class="mb-2 font-heading text-sm text-dt-text">
        <span class="text-dt-text-muted">2 ·</span> Configuration
      </h3>

      <!-- A cloud file exists: offer disconnect. -->
      <template v-if="props.mode.cloudFileWritten">
        <p class="text-dt-text-muted">
          This deployment is configured for the cloud. Disconnect rewrites the configuration back to the
          pure open-source values and removes the modules the cloud provided; the change is applied by
          recreating the stack.
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            :disabled="busy || confirming"
            class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
            @click="askDisconnect"
          >
            Disconnect from cloud
          </button>
        </div>

        <!-- The confirmation. What a disconnect costs is said HERE, before the operator accepts — not
             afterwards, when it is no longer a decision. The same position, and the same sentence, the
             artifact panel's own removal confirmation uses. -->
        <div
          v-if="confirming"
          class="mt-3 rounded-md border border-dt-tertiary/40 bg-dt-tertiary/5 px-3 py-2"
          data-cloud-disconnect-confirm
        >
          <p class="text-sm font-medium">Disconnect this deployment from the cloud?</p>
          <ul class="mt-1 list-disc space-y-1 pl-5 text-xs text-dt-text-muted">
            <li>
              The configuration reverts to the pure open-source values, and takes effect when you recreate
              the stack.
            </li>
            <li>
              Every cloud-provided module is removed — mounted modules, installed artifacts and the
              knowledge-graph connection.
            </li>
            <li data-cloud-disconnect-graph>
              At the next platform restart this deletes the classes those modules provide, together with
              every link to them, including existing analyses' links. Reconnecting and mounting them again
              brings the classes back but not those links.
            </li>
            <li>Anything you authored outside those classes is kept.</li>
          </ul>
          <div class="mt-2 flex items-center gap-2">
            <button
              type="button"
              :disabled="busy"
              class="rounded-lg border border-dt-quinary/60 px-3 py-1.5 text-sm text-dt-quinary hover:bg-white/5 disabled:opacity-50"
              data-cloud-disconnect-accept
              @click="confirmDisconnect()"
            >
              Disconnect
            </button>
            <button
              type="button"
              class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted"
              data-cloud-disconnect-cancel
              @click="cancelDisconnect()"
            >
              Cancel
            </button>
          </div>
        </div>
      </template>

      <!-- A change is written but not yet applied and there is no cloud file to disconnect — the
           disconnect restart window. Offer neither paste nor disconnect; the recreate is what's owed. -->
      <template v-else-if="props.mode.restartPending">
        <p class="text-dt-text-muted">
          A configuration change is written and takes effect when you recreate the stack
          (<code class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-dt-text">byodt restart</code>). Reconnecting is available once the
          platform has restarted.
        </p>
      </template>

      <!-- No cloud file and nothing pending: offer the paste form. -->
      <template v-else>
        <p class="text-dt-text-muted">
          Paste the deployment login recipe from your account portal to connect this deployment to the
          cloud. The console writes it into the platform's configuration; apply it by recreating the
          stack.
        </p>
        <form class="mt-3 space-y-2" @submit.prevent="apply">
          <textarea
            v-model="recipe"
            rows="8"
            placeholder="OIDC_ISSUER=…&#10;OIDC_CLIENT_ID=…&#10;…"
            aria-label="deployment login recipe"
            class="w-full rounded border border-dt-border bg-dt-background px-3 py-2 font-mono text-xs text-dt-text"
          ></textarea>
          <button
            type="submit"
            :disabled="busy || recipe.length === 0"
            class="rounded-lg bg-dt-secondary px-3 py-1.5 font-heading text-sm text-dt-surface hover:bg-dt-secondary/80 disabled:opacity-50"
          >
            Apply cloud configuration
          </button>
        </form>
      </template>

      <p v-if="message" class="mt-2 text-dt-text-muted">{{ message }}</p>
    </section>
  </div>
</template>
