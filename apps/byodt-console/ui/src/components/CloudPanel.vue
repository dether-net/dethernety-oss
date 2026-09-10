<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api, ApiError, SessionExpired, type ModeView } from '@/api'
import { consoleRedirectUri } from '@/auth'
import { DEPLOYMENT_URL } from '@/links'
import { ADMIN_ONLY } from '@/messages'

const props = withDefaults(
  defineProps<{
    mode: ModeView
    // Whether this operator administers the deployment's team, as the content panel last learned it.
    //
    // UNDEFINED IS "COULD NOT ASK" AND MUST NOT GATE — the rule every other consumer of this answer
    // follows. Only an explicit false stops the control, and even then the daemon re-asks on the request
    // itself: nothing here is the authorization, only what the interface offers.
    admin?: boolean
  }>(),
  // WITHDEFAULTS EXISTS HERE FOR ONE REASON, and a test caught it. Vue applies BOOLEAN CASTING to a prop it
  // infers as Boolean, so an absent `admin` arrives as `false` rather than `undefined` — silently
  // collapsing the three-valued answer into the one value that is allowed to disable a control. Every
  // parent that had not yet been taught to pass it would have disabled disconnect for everybody.
  //
  // It is the same hazard the daemon guards on the wire and the catalog panel guards in its computed,
  // arriving through the framework rather than through the data. An explicit undefined default turns the
  // casting off.
  { admin: undefined },
)
const emit = defineEmits<{ (e: 'changed'): void; (e: 'sign-in-required'): void }>()

const recipe = ref('')
// The platform's front-door OIDC callback: origin + /auth/callback. The console shares the front door's
// origin (served under /console/ on the same host and port), so this is fixed — no port to correct and
// nothing for the operator to confirm. It is the PLATFORM's OIDC_REDIRECT_URI, sent with the recipe on
// apply; the console's own PKCE callback is consoleRedirectUri(). Both are listed in step 1 to register.
const redirectUri = window.location.origin + '/auth/callback'
const message = ref('')
const busy = ref(false)
// The access list gets its OWN message ref rather than sharing the one above. Until this panel grew a
// second control the two could never be on screen together, so one ref was right; now a failed access
// change and a disconnect receipt can coexist, and sharing would silently wipe whichever spoke first.
const allowlist = ref('')
const allowlistMessage = ref('')
const allowlistBusy = ref(false)

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
    // CLEAR THE IN-FLIGHT LABEL BEFORE EVERY EARLY RETURN. "Applying…" is the only feedback this control
    // has, so a return that leaves it on screen leaves the operator watching a message that will never
    // resolve. The session-expired path is about to hand them the sign-in card; it must not hand them a
    // stale progress line with it.
    if (e instanceof SessionExpired) {
      message.value = ''
      return
    }
    // NO 412 BRANCH HERE, and its absence is deliberate. Connect is the one deployment-changing route the
    // gate does not wrap — the paste path has no authenticated subject — so it cannot answer 412, and a
    // branch for it would be dead code implying this route is gated when the whole design turns on it not
    // being. The two routes below do carry it.
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

// REFUSE AT THE CLICK, NEVER AFTER THE CONFIRMATION. Disconnect is the irreversible one — it removes every
// cloud-provided module and, at the next platform start, the classes those modules declare and every link
// they are in. Letting a member read four bullet points about that, accept them, and only then be told they
// were never permitted turns a non-event into something people escalate: their recollection is "I asked for
// permanent destruction and something went wrong". It also inverts the rule the rest of this console
// follows — controls are disabled and explained, and the destructive one is the one that most needs it.
const notAdmin = computed(() => props.admin === false)

// THE PASTED LIST SURVIVES THE SIGN-IN REDIRECT, and without this it did not.
//
// A 412 is answered by ACTING: the parent performs a full-page navigation to the identity provider. That is
// the right response to a missing credential, and it was inherited from panels whose gated controls are
// BUTTONS — a mount, an install, a disconnect carry nothing the operator composed. This one holds a list
// they assembled, and the redirect threw it away silently: they returned to a reloaded console, empty box,
// no message, which reads as "it worked and signed me in again".
//
// sessionStorage because it is the same store the sign-in exchange already uses to cross that redirect, and
// because this must NOT outlive the tab: a stale draft restored days later would be a list composed against
// a roster that has moved. Every access is guarded — a private window or blocked site data throws rather
// than returning null, and losing the draft is worse than a broken panel only if the panel still works.
const ALLOWLIST_DRAFT_KEY = 'byodt.console.allowlist.draft'

function stashAllowlistDraft(value: string) {
  try {
    sessionStorage.setItem(ALLOWLIST_DRAFT_KEY, value)
  } catch {
    // No session storage. The draft is lost, which is what happened before this existed.
  }
}

onMounted(() => {
  let draft: string | null = null
  try {
    draft = sessionStorage.getItem(ALLOWLIST_DRAFT_KEY)
    sessionStorage.removeItem(ALLOWLIST_DRAFT_KEY)
  } catch {
    return
  }
  if (!draft) return
  allowlist.value = draft
  // SAY WHAT DID NOT HAPPEN. Restoring the box silently is better than losing it and still not enough: the
  // operator pressed Apply and the deployment did not change, and nothing else on the page says so.
  allowlistMessage.value =
    'You were signed in again before this could be applied, so nothing was changed. Your list is below — check it and apply again.'
})

async function applyAllowlist() {
  allowlistBusy.value = true
  allowlistMessage.value = 'Applying…'
  try {
    const r = await api.changeAllowlist(allowlist.value)
    // The count first, because it is the only check the operator has that their paste was read the way
    // they meant it — the console cannot show them the list they replaced.
    allowlistMessage.value = `${r.subjects} ${r.subjects === 1 ? 'account' : 'accounts'} written. ${r.message}`
    allowlist.value = ''
  } catch (e) {
    // See apply(): an early return must not leave "Applying…" standing.
    if (e instanceof SessionExpired) {
      allowlistMessage.value = ''
      return
    }
    // 412 IS ANSWERED BY ACTING, NEVER BY REPORTING. The operator's access token is memory-only, so a
    // reloaded tab is signed in, shows their name, and holds nothing to ask the cloud with. Printing
    // "sign in again" in grey text, in a console whose only sign-in control is hidden while signed in, is
    // a dead end — the same one the content panel already answers this way.
    if (e instanceof ApiError && e.status === 412) {
      // Stash BEFORE emitting: the parent answers this by navigating away, and nothing after the emit is
      // guaranteed to run.
      stashAllowlistDraft(allowlist.value)
      emit('sign-in-required')
      allowlistMessage.value = ''
      return
    }
    allowlistMessage.value = e instanceof Error ? e.message : 'Could not change the access list.'
  } finally {
    allowlistBusy.value = false
  }
}

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
    // See apply(): an early return must not leave "Reverting…" standing.
    if (e instanceof SessionExpired) {
      message.value = ''
      return
    }
    // The gate answers 412 on disconnect too, and for the same reason: a reloaded tab holds no cloud
    // token. This branch was missing while disconnect was the only gated control on this panel, so that
    // refusal landed as grey text telling the operator to sign in, in a console whose only sign-in control
    // is hidden while they are signed in. The content panel has answered it correctly all along.
    if (e instanceof ApiError && e.status === 412) {
      emit('sign-in-required')
      message.value = ''
      return
    }
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

    <!--
         THE STEP BADGES. Both steps carry an ACCENT ring, and the ring is the point rather than the styling:
         each of these steps has a TWIN on the subscription portal's deployment page, which the operator has
         open beside this screen while they work. The badge is what lets them see the pairing at a glance
         instead of reading two headings and inferring it.

         AGREED BY CONVENTION, NOT SHARED CODE. The portal is a separate application; nothing here imports
         anything from it. What makes the badges match is that both palettes define the same `--color-dt-*`
         values, so an identical class list renders identically. If this changes, the portal's page has to
         change with it — the correspondence has no other enforcement.

         NO HUE PER NUMBER. The palette's warm tones (tertiary/quaternary/quinary) are the warning ladder
         here — see their own comments in `styles/main.css` — so colouring step 2 amber would render a
         routine step as a fault. The numeral separates the steps; the accent says "this one is mirrored".

         `aria-hidden`: the heading already names the step, and announcing a bare "1" first is noise.
    -->
    <!-- 1 · Access and callbacks — the two callbacks the account needs registered. Read-only + Copy:
         the operator copies these and pastes them into the account's Callback URLs field. Kept first,
         and always shown, because it is a prerequisite for cloud sign-in independent of connect state. -->
    <section aria-label="Access and callbacks" data-section="callbacks">
      <h3 class="mb-2 font-heading text-sm text-dt-text">
        <span class="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-dt-accent text-xs text-dt-accent" aria-hidden="true" data-step="1">1</span> Access and callbacks
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
      <!--
           THIS SENTENCE USED TO SAY "Local development addresses are always accepted and are not listed
           here", printed directly beneath a box containing two local development addresses. It was wrong
           twice over: the reader is looking at exactly the thing it says is not shown, and "always
           accepted" is not true of local addresses in general — only of the specific host, port and path
           combinations that are registered for you. Registering a URL that is already registered costs seconds;
           trusting this sentence and skipping it costs an evening, because the failure lands at the
           identity provider where the operator's own logs say nothing.
      -->
      <p class="mt-2 text-xs text-dt-text-muted">
        First line is the platform's sign-in, second is this console's own. Paste both into the portal and
        save — if they are already registered, saving them again changes nothing.
      </p>
    </section>

    <hr class="my-6 border-dt-border" />

    <!-- 2 · Configuration — connect (paste the login recipe), or the connected / pending-restart
         states. Numbered and titled so the two steps read as an obvious sequence. -->
    <section aria-label="Configuration" data-section="configuration">
      <h3 class="mb-2 font-heading text-sm text-dt-text">
        <span class="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-dt-accent text-xs text-dt-accent" aria-hidden="true" data-step="2">2</span> Configuration
      </h3>

      <!-- A cloud file exists: offer the access list, then disconnect. -->
      <template v-if="props.mode.cloudFileWritten">
        <!--
             WHO MAY SIGN IN COMES FIRST, ABOVE DISCONNECT, and the order is the argument rather than the
             layout. Until this existed the connected state offered exactly one control and it was the
             destructive one, so an operator looking for "change who has access" found Disconnect — which
             removes every cloud module and, at the next platform start, the classes they declare and every
             link those classes are in. That is the journey this section exists to end. It must not be the
             second thing on the page.

             NO STEP BADGE, deliberately. The numerals above pair with twins on the account portal's
             deployment page and are agreed by convention, not shared code (see the note on step 1), so
             numbering this would silently oblige a change over there. It is not part of the connect
             sequence; it is something you do afterwards, repeatedly.
        -->
        <section aria-label="Who may sign in" data-section="allowlist">
          <h4 class="mb-2 font-heading text-sm text-dt-text">Who may sign in</h4>
          <p class="mb-2 text-dt-text-muted">
            Paste the access list from your account portal's
            <span class="text-dt-text">Who may sign in</span> card. This
            <span class="text-dt-text">replaces</span> the list — anyone not in the box loses access to this
            deployment. One account per line, or separated by commas.
          </p>
          <!-- The one thing the daemon's own sentence cannot say, because it is about what the console
               CANNOT do rather than about what the change does: there is no way to show the current list.
               Nothing surfaces it — the ungated posture read is a fixed field projection precisely so the
               member ids never reach the wire — so an operator composing a replacement has to get the
               value from the place that can name people, which is the portal. Saying so here is what stops
               them typing from memory and dropping colleagues they could not see. -->
          <p class="mb-2 text-xs text-dt-text-muted">
            The console cannot show you the current list, so copy the whole list rather than editing from
            memory.
          </p>
          <!-- WHEN IT TAKES EFFECT, STATED BEFORE THE BOX AND NOT UNDER THE BUTTON. It was a footnote below
               the submit control, which is the position a reader skips — and it is the sentence that stops
               an operator concluding the console failed and reaching for Disconnect instead.

               The sentence is the daemon's, carried on the mode read, so this panel holds no copy that
               could drift from the one the change itself returns. It is HIDDEN once a receipt is showing,
               because the receipt repeats it verbatim and two identical grey blocks stacked is how the
               count in front of it stops being noticed. -->
          <p
            v-if="props.mode.allowlistNotice && !allowlistMessage"
            data-cloud-allowlist-notice
            class="mb-2 text-xs text-dt-text-muted"
          >
            {{ props.mode.allowlistNotice }}
          </p>
          <textarea
            v-model="allowlist"
            class="w-full rounded border border-dt-border bg-dt-background px-2 py-1 font-mono text-xs text-dt-text"
            rows="3"
            :disabled="allowlistBusy || notAdmin"
            aria-label="access list"
            data-cloud-allowlist-input
          ></textarea>
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              :disabled="allowlistBusy || notAdmin || allowlist.trim() === ''"
              :title="notAdmin ? ADMIN_ONLY : undefined"
              data-cloud-allowlist-apply
              class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
              @click="applyAllowlist"
            >
              {{ allowlistBusy ? 'Applying…' : 'Apply access list' }}
            </button>
          </div>
          <!-- The same rule disconnect follows: a control that is disabled says why, beside itself. -->
          <div
            v-if="notAdmin"
            data-cloud-allowlist-not-admin
            class="mt-3 rounded-r-md border-l-4 border-dt-border bg-white/5 px-3 py-2 text-sm text-dt-text-muted"
          >
            {{ ADMIN_ONLY }}
          </div>
          <p
            v-if="allowlistMessage"
            data-cloud-allowlist-message
            class="mt-3 rounded-r-md border-l-4 border-dt-border bg-white/5 px-3 py-2 text-sm text-dt-text-muted"
            aria-live="polite"
          >
            {{ allowlistMessage }}
          </p>
        </section>

        <hr class="my-6 border-dt-border" />

        <p class="text-dt-text-muted">
          This deployment is configured for the cloud. Disconnect rewrites the configuration back to the
          pure open-source values and removes the modules the cloud provided; the change is applied by
          recreating the stack.
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            :disabled="busy || confirming || notAdmin"
            :title="notAdmin ? ADMIN_ONLY : undefined"
            data-cloud-disconnect
            class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
            @click="askDisconnect"
          >
            Disconnect from cloud
          </button>
        </div>

        <!-- The sentence sits where the confirmation card would have opened, so the operator's eye lands
             where it was already going. A disabled destructive control with no explanation beside it is the
             failure this rule exists to prevent. -->
        <div
          v-if="notAdmin"
          data-cloud-disconnect-not-admin
          class="mt-3 rounded-r-md border-l-4 border-dt-border bg-white/5 px-3 py-2 text-sm text-dt-text-muted"
        >
          {{ ADMIN_ONLY }}
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
