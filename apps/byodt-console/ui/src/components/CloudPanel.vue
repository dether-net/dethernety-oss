<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { api, ApiError, SessionExpired, type ModeView, type RosterMember } from '@/api'
import { consoleRedirectUri } from '@/auth'
import { DEPLOYMENT_URL } from '@/links'
import { ADMIN_ONLY } from '@/messages'
import Banner from '@/components/Banner.vue'

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
const emit = defineEmits<{
  (e: 'changed'): void
  (e: 'sign-in-required'): void
  // How many accounts on this deployment's list no longer belong to a team member, whenever the card has
  // just learned it — and undefined whenever it no longer knows. Lifted to the parent so the deployment's
  // status can say so on the overview, where an administrator lands, rather than only behind the Cloud
  // tab. It is computed from the roster fetched in this tab and nothing else: the daemon holds no such
  // count, the mode file carries none, and a reload starts from undefined.
  (e: 'departed', count: number | undefined): void
}>()

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

// WHO MAY SIGN IN — the team's members with a tick beside each, and the identifiers the deployment admits
// that belong to nobody on the team any more.
//
// Both lists are fetched when the card is shown and held in this component's memory for exactly as long
// as it is. NEITHER IS WRITTEN ANYWHERE. The deployment side keeps no addresses — not on its disk, not in
// its configuration, not in the daemon's log, and not in this browser's storage, which outlives the request
// that fetched them. The draft that survives the sign-in redirect carries the ticks, which are identifiers,
// and the roster is fetched again on return (see the stash below).
const roster = ref<RosterMember[]>([])
const admitted = ref<string[]>([])
// The selection, by identifier. Seeded from the admitted list when the roster arrives — the ticks show
// who may sign in TODAY, derived here by comparing the two lists — and changed only by the operator, or by
// a draft restored across the redirect.
const ticks = ref<Set<string>>(new Set())

// What the card can show, as one value with one arm per remedy — the rule the content panel's subscription
// sentence follows, and for the same reason: a component with fewer arms than there are states is how one
// of them becomes a loop.
//
//   loading      the first fetch is in flight. Nothing is claimed.
//   ready        both reads answered; the members, the ticks and the departed are on screen.
//   not-admin    403. This operator does not administer the team, so nothing of it is shown.
//   signed-out   412. This tab holds no cloud credential to fetch with — the ordinary state of a reloaded
//                tab. A sign-in is OFFERED and never forced: a card that redirected on mount would send
//                every reloaded console to the identity provider before the operator had asked anything.
//   no-team      409. The deployment can never fetch its roster: its recipe names no team, or its
//                configuration cannot make the check. Permanent, so a new recipe rather than a retry. The
//                paste box is the fallback here and ONLY here — every other arm refuses the write for the
//                same reason it refused the read, so a box there would be an invitation to a refusal.
//   unavailable  everything else: the service down, a document the daemon did not recognise, a refusal for
//                this sign-in. The daemon's sentence, and a retry.
//
// The card shows an empty team in no arm. A fetch that failed is a reason, printed; a fetch that succeeded
// lists the members it was given, and the daemon never answers an unrecognised document as an empty team,
// because an empty team reads as everyone having left.
type RosterOutcome =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'not-admin' }
  | { kind: 'signed-out' }
  | { kind: 'no-team'; detail: string }
  | { kind: 'unavailable'; detail: string }
const outcome = ref<RosterOutcome>({ kind: 'loading' })
// A refresh while the list is already on screen. The list stays up while it runs — a Refresh that blanked
// the card for a round trip would look like the roster being lost.
const refreshing = ref(false)
// Which fetch is current, so a slow answer issued before a write cannot land after the fast one issued
// after it and put the old list back over the new one.
let rosterGen = 0

const rosterSubs = computed(() => new Set(roster.value.map((m) => m.sub)))

// Every admitted identifier that belongs to nobody on the team. BY IDENTIFIER, because the address of
// someone who has left is kept nowhere — not by this deployment and not by the service that answered the
// roster — so there is nothing else to show. That is a property of the design to state in the interface,
// not a limitation to apologise for.
const departed = computed(() => admitted.value.filter((s) => !rosterSubs.value.has(s)))

const departedSummary = computed(() => {
  const n = departed.value.length
  return n === 1
    ? '1 person who has left the team can still sign in.'
    : `${n} people who have left the team can still sign in.`
})

// THE OPERATOR'S OWN ROW CANNOT BE UNTICKED. The daemon refuses any list that leaves the submitter out,
// because applying it would lock them out at the next platform start — and its refusal names them by
// identifier, which is the one thing an operator does not know about themselves. Read on the card, that
// sentence was a puzzle: an operator who unticked their own row to see what would happen was told to
// re-paste a list they had never pasted. So the row is kept ticked and its box is disabled, and the
// refusal is reached only from the paste box, where its sentence fits.
//
// Matched by identifier, which the mode read carries for exactly this: the roster names rows by
// identifier, and an address match could miss (an account need carry no address). The address is the
// fallback for a daemon that does not yet say. The daemon's refusal is still the guard; this is the
// interface not offering a choice the guard will refuse.
const yourSub = computed(() => props.mode.user?.sub ?? '')
const yourEmail = computed(() => (props.mode.user?.email ?? '').trim().toLowerCase())
function isYou(m: RosterMember): boolean {
  if (yourSub.value !== '') return m.sub === yourSub.value
  return yourEmail.value !== '' && m.email.trim().toLowerCase() === yourEmail.value
}

// The ticks, with the operator's own row always among them when it is on the roster. Applied wherever the
// ticks are set from outside the operator's hand — the seed from the admitted list, and a draft restored
// across the redirect — so a draft written before this rule existed cannot bring a self-excluding
// selection back.
function withYou(subs: Iterable<string>, members: RosterMember[]): Set<string> {
  const next = new Set(subs)
  const self = members.find(isYou)
  if (self) next.add(self.sub)
  return next
}

function setTick(sub: string, on: boolean) {
  // Belt and braces under the disabled box: a change event for the operator's own row is not a choice
  // the card offers.
  if (!on && roster.value.some((m) => m.sub === sub && isYou(m))) return
  const next = new Set(ticks.value)
  if (on) next.add(sub)
  else next.delete(sub)
  ticks.value = next
}

// A change to who may sign in is written to the mode layer and read by the platform once, when it
// starts — so like a mount, it is inert until the platform is recreated. The daemon's receipt says so, but
// a receipt is read once and scrolls away, and nothing in the mode view can reflect it (the platform does
// not report which list it started with). So this is the modules tab's sticky session reminder, for the
// same reason: the console cannot observe the operator running the command, so once a change needs the
// restart the banner stays until the page is reloaded.
const restartNeeded = ref(false)

// THE DRAFT SURVIVES THE SIGN-IN REDIRECT, and without this it did not.
//
// A 412 is answered by ACTING: the parent performs a full-page navigation to the identity provider. That is
// the right response to a missing credential, and it was inherited from panels whose gated controls are
// BUTTONS — a mount, an install, a disconnect carry nothing the operator composed. This one holds a
// selection they assembled, and the redirect threw it away silently: they returned to a reloaded console,
// nothing selected, no message, which reads as "it worked and signed me in again".
//
// sessionStorage because it is the same store the sign-in exchange already uses to cross that redirect, and
// because this must NOT outlive the tab: a stale draft restored days later would be a selection composed
// against a roster that has moved. Every access is guarded — a private window or blocked site data throws
// rather than returning null, and losing the draft is worse than a broken panel only if the panel still
// works.
//
// AND IT CARRIES IDENTIFIERS ONLY, NEVER THE ROSTER. The card shows the team's members by address, and the
// address is the one thing the deployment side must never keep. Browser storage is keeping: it outlives the
// request, the tab's memory and — for anything but sessionStorage — the tab. So the draft is the ticks, or
// the list the operator pasted, and on return the roster is fetched again and the ticks are laid over it.
// The test for this reads the stored value back and looks for an address in it.
const ALLOWLIST_DRAFT_KEY = 'byodt.console.allowlist.draft'

type AllowlistDraft = { ticks: string[] } | { paste: string }

function stashAllowlistDraft(draft: AllowlistDraft) {
  try {
    sessionStorage.setItem(ALLOWLIST_DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // No session storage. The draft is lost, which is what happened before this existed.
  }
}

// Read and CONSUME the draft, so it is restored once and never again on some later visit against a moved
// roster. Anything that is not the shape written above is discarded rather than guessed at.
function takeAllowlistDraft(): AllowlistDraft | null {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(ALLOWLIST_DRAFT_KEY)
    sessionStorage.removeItem(ALLOWLIST_DRAFT_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null
    if ('ticks' in parsed && Array.isArray(parsed.ticks) && parsed.ticks.every((t) => typeof t === 'string')) {
      return { ticks: parsed.ticks as string[] }
    }
    if ('paste' in parsed && typeof parsed.paste === 'string') return { paste: parsed.paste }
  } catch {
    // Not this component's writing.
  }
  return null
}

// Ticks restored from a draft, waiting for the roster they are laid over.
let restoredTicks: Set<string> | null = null

async function loadRoster() {
  const gen = ++rosterGen
  if (outcome.value.kind === 'ready') refreshing.value = true
  else outcome.value = { kind: 'loading' }
  try {
    const [r, a] = await Promise.all([api.roster(), api.allowlist()])
    if (gen !== rosterGen) return
    roster.value = r.members
    admitted.value = a.subjects
    // Restored ticks are laid over the roster just fetched, never the other way round: an identifier that
    // is no longer on the team cannot be ticked, whatever a draft says, and a departed identifier is shown
    // in its own list rather than as an unticked member.
    const onTeam = new Set(r.members.map((m) => m.sub))
    const seed = restoredTicks ?? new Set(a.subjects)
    restoredTicks = null
    ticks.value = withYou([...seed].filter((s) => onTeam.has(s)), r.members)
    outcome.value = { kind: 'ready' }
    emit('departed', departed.value.length)
  } catch (e) {
    if (gen !== rosterGen) return
    // Whatever was on screen is gone with the answer that put it there: a stale list under a refusal would
    // be the card claiming to know something it has just been told it does not.
    roster.value = []
    admitted.value = []
    ticks.value = new Set()
    emit('departed', undefined)
    // A session expiry is the app's to handle, and it is already doing so. The 401 that raised it never
    // comes from the gate — the daemon answers "not an administrator" as 403 precisely so that a refusal
    // does not sign the operator out of their own console.
    if (e instanceof SessionExpired) return
    if (e instanceof ApiError && e.status === 403) {
      outcome.value = { kind: 'not-admin' }
    } else if (e instanceof ApiError && e.status === 412) {
      outcome.value = { kind: 'signed-out' }
    } else if (e instanceof ApiError && e.status === 409) {
      outcome.value = { kind: 'no-team', detail: e.message }
    } else {
      outcome.value = { kind: 'unavailable', detail: e instanceof Error ? e.message : 'Could not fetch the team.' }
    }
  } finally {
    if (gen === rosterGen) refreshing.value = false
  }
}

// Fetched when the card is shown and again whenever the deployment becomes connected; forgotten the moment
// it is not. cloudFileWritten is watched as a value rather than the mode object, which the poll replaces
// every few seconds.
onMounted(() => {
  const draft = takeAllowlistDraft()
  if (draft) {
    if ('paste' in draft) allowlist.value = draft.paste
    else restoredTicks = new Set(draft.ticks)
    // SAY WHAT DID NOT HAPPEN. Restoring the selection silently is better than losing it and still not
    // enough: the operator pressed Apply and the deployment did not change, and nothing else on the page
    // says so.
    allowlistMessage.value =
      'You were signed in again before this could be applied, so nothing was changed. What you had chosen is below — check it and apply again.'
  }
  if (props.mode.cloudFileWritten) void loadRoster()
})

watch(
  () => props.mode.cloudFileWritten,
  (written) => {
    if (written) {
      void loadRoster()
      return
    }
    rosterGen++
    refreshing.value = false
    roster.value = []
    admitted.value = []
    ticks.value = new Set()
    outcome.value = { kind: 'loading' }
    // A disconnect owes its own restart, and the mode view says so; the list this reminder was about is
    // gone with the file.
    restartNeeded.value = false
    emit('departed', undefined)
  },
)

// ONE WRITER FOR EVERY CONTROL ON THIS CARD, and it is the route the paste box always submitted to. The card
// composes the value — the ticks, or the admitted list less those who have left, or the paste — and the
// daemon re-runs every guard on it exactly as it does on a paste: empty refused, the cap, the printable
// check, and the refusal of a list that would lock the submitter out. Nothing new writes the access list.
//
// `draft` is what a 412 stashes across the redirect: the operator's selection, or their paste. It is passed
// in rather than derived here because only the caller knows which of the two the operator composed.
async function submitAllowlist(value: string, draft: AllowlistDraft) {
  allowlistBusy.value = true
  allowlistMessage.value = 'Applying…'
  try {
    const r = await api.changeAllowlist(value)
    // The count first: it is what tells the operator their selection was read as three people rather
    // than one — and on the paste path it is the only check they have.
    allowlistMessage.value = `${r.subjects} ${r.subjects === 1 ? 'account' : 'accounts'} written. ${r.message}`
    allowlist.value = ''
    restartNeeded.value = true // the list is written; it applies on the next platform recreate
    // The list has moved, so what the ticks show as "today" has moved with it. Fetch both again rather than
    // pretend to know what was written; this is also where an identifier just removed disappears from the
    // departed list. The receipt above stays on screen through the refresh.
    if (outcome.value.kind === 'ready') void loadRoster()
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
      stashAllowlistDraft(draft)
      emit('sign-in-required')
      allowlistMessage.value = ''
      return
    }
    allowlistMessage.value = e instanceof Error ? e.message : 'Could not change the access list.'
  } finally {
    allowlistBusy.value = false
  }
}

// The ticks, as the list. Nobody ticked is submitted rather than refused here, so the operator reads the
// daemon's sentence about what an empty list would mean instead of a disabled button with no explanation.
function applyTicks() {
  const chosen = [...ticks.value]
  void submitAllowlist(chosen.join('\n'), { ticks: chosen })
}

// The admitted list less everyone who has left — and NOT the ticks. This keeps everyone still on the team
// exactly as they were, including any ticks the operator has changed but not applied, which it leaves as
// they are: the draft it stashes on a redirect is the operator's selection, so nothing composed is lost.
function removeDeparted() {
  const keep = admitted.value.filter((s) => rosterSubs.value.has(s))
  void submitAllowlist(keep.join('\n'), { ticks: [...ticks.value] })
}

// The paste path — the fallback on a deployment whose roster cannot be fetched. Sent verbatim: every
// separator rule belongs to the daemon, because the daemon is what has to agree with the platform about
// what the value means.
function applyAllowlist() {
  void submitAllowlist(allowlist.value, { paste: allowlist.value })
}

// The role, whichever way the card learned it: the content panel's answer handed down as a prop, or the
// gate's own 403 on the fetch. Either shows the sentence and disables what remains; neither hides anything.
const adminOnly = computed(() => notAdmin.value || outcome.value.kind === 'not-admin')

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
         states. Numbered and titled so the steps read as an obvious sequence. -->
    <section aria-label="Configuration" data-section="configuration">
      <h3 class="mb-2 font-heading text-sm text-dt-text">
        <span class="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-dt-accent text-xs text-dt-accent" aria-hidden="true" data-step="2">2</span> Configuration
      </h3>

      <!-- A cloud file exists: this step is done, and says so. What follows it is step 3; what undoes it
           is at the foot of the page. -->
      <p v-if="props.mode.cloudFileWritten" class="text-dt-text-muted" data-cloud-configured>
        This deployment is configured for the cloud. Who may sign in to it is chosen in step 3 below;
        disconnecting, which reverts this configuration, is at the foot of this page.
      </p>

      <!-- A change is written but not yet applied and there is no cloud file to disconnect — the
           disconnect restart window. Offer neither paste nor disconnect; the recreate is what's owed. -->
      <p v-else-if="props.mode.restartPending" class="text-dt-text-muted">
        A configuration change is written and takes effect when you recreate the stack
        (<code class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-dt-text">byodt restart</code>). Reconnecting is available once the
        platform has restarted.
      </p>

      <!-- No cloud file and nothing pending: offer the paste form. -->
      <template v-else>
        <p class="text-dt-text-muted">
          Paste the deployment login recipe from your account portal to connect this deployment to the
          cloud. The console writes it into the platform's configuration; apply it by recreating the
          stack.
        </p>
        <!-- SAID BEFORE THE APPLY, NOT AFTER. The recipe lists every member of the team, because the portal
             does not know who works on which client — and reconnecting does the same, discarding any
             selection made since. An operator who learns that after loading a client's data has already
             let the whole team at it. -->
        <p class="mt-2 text-dt-text-muted" data-cloud-connect-everyone>
          Every member of your team will be able to sign in. If this deployment will hold a client's data,
          narrow who can sign in before you load it.
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

    <!-- The connected deployment: who may sign in, then — last, and unnumbered — disconnect. -->
    <template v-if="props.mode.cloudFileWritten">
      <hr class="my-6 border-dt-border" />

      <!--
           3 · WHO MAY SIGN IN — its own step, after configuration and before nothing. It cannot come
           earlier: the roster is fetched for a connected deployment that names its team, so there is
           nothing here to do until step 2 is done. The numeral pairs with the portal's third step, where
           the team is assembled — the portal decides who is on the team, this decides which of them this
           deployment admits — and the pairing is agreed by convention, not shared code (see step 1).

           ABOVE DISCONNECT, and the order is the argument rather than the layout. Until this existed the
           connected state offered exactly one control and it was the destructive one, so an operator
           looking for "change who has access" found Disconnect — which removes every cloud module and, at
           the next platform start, the classes they declare and every link those classes are in. That is
           the journey this section exists to end. Disconnect is the last thing on the page.
      -->
      <section aria-label="Who may sign in" data-section="allowlist">
        <h3 class="mb-2 font-heading text-sm text-dt-text">
          <span class="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-dt-accent text-xs text-dt-accent" aria-hidden="true" data-step="3">3</span> Who may sign in
        </h3>

        <!-- The change is inert until the platform re-reads its configuration, and the receipt below
             saying so is read once. This is the modules tab's reminder, in the same shape, and it stays
             for the session: whoever was just removed can still sign in until the command is run. -->
        <Banner
          v-if="restartNeeded"
          tone="warn"
          title="Restart required to apply your changes"
          class="mb-3"
          data-cloud-restart-required
        >
          Changes to who may sign in take effect when you recreate the platform:
          <code class="ml-1 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-dt-text">byodt restart platform</code>.
          Until then, anyone you removed can still sign in.
        </Banner>

        <!-- WHEN IT TAKES EFFECT, STATED BEFORE THE LIST AND NOT UNDER THE BUTTON. It was a footnote below
             the submit control, which is the position a reader skips — and it is the sentence that stops
             an operator concluding the console failed and reaching for Disconnect instead.

             The sentence is the daemon's, carried on the mode read, so this panel holds no copy that
             could drift from the one the change itself returns. It is HIDDEN once a receipt is showing,
             because the receipt repeats it verbatim and two identical grey blocks stacked is how the
             count in front of it stops being noticed. It is shown only in the two arms that offer a
             control: a sentence about when a change takes effect, above a card that cannot make one,
             would read as a promise. -->
        <p
          v-if="props.mode.allowlistNotice && !allowlistMessage && (outcome.kind === 'ready' || outcome.kind === 'no-team')"
          data-cloud-allowlist-notice
          class="mb-2 text-xs text-dt-text-muted"
        >
          {{ props.mode.allowlistNotice }}
        </p>

        <!-- READY: the members, the ticks, and whoever has left. -->
        <template v-if="outcome.kind === 'ready'">
          <p class="mb-2 text-dt-text-muted">
            Every current member of your team, with a tick beside those who may sign in to this
            deployment today. Tick the colleagues who work on this client and untick the rest, then
            apply. Your own row stays ticked. Selecting is not inviting: adding and removing people,
            and changing roles, stay in the portal.
          </p>
          <!-- Fetched, never stored: the addresses are held in this tab's memory while the card is open
               and nowhere else. The daemon that relayed them keeps none either. -->
          <ul v-if="roster.length" class="space-y-1" data-cloud-roster>
            <li v-for="m in roster" :key="m.sub" :data-cloud-roster-member="m.sub">
              <!-- The operator's own row is ticked and cannot be unticked: the one list the daemon will
                   always refuse is one that leaves the submitter out. The reason is on the box itself. -->
              <label
                class="flex cursor-pointer items-center gap-2 text-dt-text"
                :title="isYou(m) ? 'Your own access stays: a list that left you out would lock you out of this deployment.' : undefined"
              >
                <input
                  type="checkbox"
                  :checked="ticks.has(m.sub)"
                  :disabled="allowlistBusy || adminOnly || isYou(m)"
                  :aria-label="m.email || m.sub"
                  @change="setTick(m.sub, ($event.target as HTMLInputElement).checked)"
                />
                <span v-if="m.email">{{ m.email }}</span>
                <!-- An account can carry no address. The identifier is what there is, and saying so
                     is better than a row that looks like a rendering fault. -->
                <template v-else>
                  <code class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs">{{ m.sub }}</code>
                  <span class="text-xs text-dt-text-muted">no address on file</span>
                </template>
                <span v-if="isYou(m)" class="text-xs text-dt-text-muted" data-cloud-roster-you>(you)</span>
              </label>
            </li>
          </ul>
          <!-- Cannot happen — the operator reading this is on the team — and it is said rather than
               rendered as an empty list, because an empty list here means "everyone has left". -->
          <p v-else class="text-dt-text-muted" data-cloud-roster-empty>
            The content service listed nobody on this team, which cannot be right — you are on it.
            Refresh to try again.
          </p>

          <!-- DEPARTED, IN THE FAULT TONE, BY IDENTIFIER. Each account on this deployment's list that no
               longer belongs to a team member — listed individually, because each is a person who can
               still read this client's models. -->
          <div
            v-if="departed.length"
            class="mt-3 rounded-md border border-dt-quinary/40 bg-dt-quinary/5 px-3 py-2"
            data-cloud-departed
          >
            <p class="text-sm font-medium text-dt-quinary" data-cloud-departed-summary>
              {{ departedSummary }}
            </p>
            <ul class="mt-1 space-y-1">
              <li v-for="s in departed" :key="s" :data-cloud-departed-member="s" class="text-sm text-dt-quinary">
                <code class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs">{{ s }}</code>
                <span class="ml-2">no longer on the team</span>
              </li>
            </ul>
            <p class="mt-1 text-xs text-dt-text-muted">
              Shown by account identifier: the address of someone who has left is kept nowhere. Leaving
              the team ended their subscription, not their sign-in here — until you remove them. Applying
              any selection removes them too, since they cannot be ticked; this button removes them and
              changes nothing else.
            </p>
            <div class="mt-2">
              <button
                type="button"
                :disabled="allowlistBusy || adminOnly"
                :title="adminOnly ? ADMIN_ONLY : undefined"
                data-cloud-remove-departed
                class="rounded-lg border border-dt-quinary/60 px-3 py-1.5 text-sm text-dt-quinary hover:bg-white/5 disabled:opacity-50"
                @click="removeDeparted"
              >
                Remove people who have left
              </button>
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              :disabled="allowlistBusy || adminOnly"
              :title="adminOnly ? ADMIN_ONLY : undefined"
              data-cloud-allowlist-apply
              class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
              @click="applyTicks"
            >
              {{ allowlistBusy ? 'Applying…' : 'Apply' }}
            </button>
            <!-- A colleague who joined since the card was fetched appears only on a fetch. -->
            <button
              type="button"
              :disabled="allowlistBusy || refreshing"
              data-cloud-roster-refresh
              class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
              @click="loadRoster"
            >
              {{ refreshing ? 'Refreshing…' : 'Refresh' }}
            </button>
          </div>
        </template>

        <p v-else-if="outcome.kind === 'loading'" class="text-dt-text-muted" data-cloud-roster-loading>
          Fetching your team's members…
        </p>

        <!-- SIGNED OUT OF THE CLOUD, IN THIS TAB. Offered, not forced — see the outcome's comment. The
             button performs the same redirect the sign-in card does, and on return the card fetches on
             its own. -->
        <div v-else-if="outcome.kind === 'signed-out'" data-cloud-roster-signed-out>
          <p class="text-dt-text-muted">
            Who may sign in has not been fetched: this tab no longer holds your cloud sign-in, and
            reloading the page is what clears it. Signing in again gives this tab what it needs. Nothing
            about the deployment has changed.
          </p>
          <button
            type="button"
            class="mt-2 rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5"
            data-cloud-roster-sign-in
            @click="emit('sign-in-required')"
          >
            Sign in to the cloud
          </button>
        </div>

        <!-- NO TEAM: the deployment can never fetch its roster, and the daemon's sentence says why and what
             fixes it. The paste box is the fallback, offered here and nowhere else, and it is offered
             BENEATH the reason rather than instead of it: a box on its own would be the card pretending
             nothing were wrong. -->
        <template v-else-if="outcome.kind === 'no-team'">
          <p
            class="mb-3 rounded-r-md border-l-4 border-dt-tertiary bg-dt-tertiary/10 px-3 py-2 text-sm text-dt-text-muted"
            data-cloud-roster-no-team
          >
            {{ outcome.detail }}
          </p>
          <!-- THE SOURCE IS THE RECIPE'S OWN LINE. This once said "from your account portal's Who may sign
               in card": the portal kept a separate copyable list for exactly this box, and stopped keeping
               it once this card could show the team itself. What remains on the portal is the recipe, and
               the recipe carries the list as one of its lines. -->
          <p class="mb-2 text-dt-text-muted" data-cloud-paste-source>
            Until then, paste the value of the
            <code class="rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-dt-text">DEPLOYMENT_ALLOWLIST</code>
            line from a freshly generated deployment recipe on your account portal. This
            <span class="text-dt-text">replaces</span> the list — anyone not in the box loses access to this
            deployment. One account per line, or separated by commas.
          </p>
          <!-- True of this arm and only this arm: the same refusal that stops the roster stops the list
               read, so an operator composing a replacement has to get the value from the place that can
               name people, which is the portal's recipe. Saying so is what stops them typing from memory
               and dropping colleagues they could not see. -->
          <p class="mb-2 text-xs text-dt-text-muted">
            On this deployment the console cannot show you the current list, so copy the whole list
            rather than editing from memory.
          </p>
          <textarea
            v-model="allowlist"
            class="w-full rounded border border-dt-border bg-dt-background px-2 py-1 font-mono text-xs text-dt-text"
            rows="3"
            :disabled="allowlistBusy || adminOnly"
            aria-label="access list"
            data-cloud-allowlist-input
          ></textarea>
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              :disabled="allowlistBusy || adminOnly || allowlist.trim() === ''"
              :title="adminOnly ? ADMIN_ONLY : undefined"
              data-cloud-allowlist-apply
              class="rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5 disabled:opacity-50"
              @click="applyAllowlist"
            >
              {{ allowlistBusy ? 'Applying…' : 'Apply access list' }}
            </button>
          </div>
        </template>

        <!-- UNAVAILABLE: the daemon's sentence, and the retry it names. Named rather than left as the
             else arm: a member's 403 is the one remaining outcome, and it is answered by the sentence
             below, not by a retry that would fail the same way. -->
        <div v-else-if="outcome.kind === 'unavailable'" data-cloud-roster-unavailable>
          <p class="rounded-r-md border-l-4 border-dt-border bg-white/5 px-3 py-2 text-sm text-dt-text-muted">
            {{ outcome.detail }}
          </p>
          <button
            type="button"
            class="mt-2 rounded-lg border border-dt-border px-3 py-1.5 text-sm text-dt-text hover:border-dt-text-muted hover:bg-white/5"
            data-cloud-roster-refresh
            @click="loadRoster"
          >
            Try again
          </button>
        </div>

        <!-- The same rule disconnect follows: a control that is disabled says why, beside itself — and a
             member, for whom there is no list to disable, reads the same sentence where it would be. -->
        <div
          v-if="adminOnly"
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

      <!-- DISCONNECT, LAST AND UNNUMBERED. It is not a step of setting the deployment up — it is the
           undoing of step 2 — and a destructive control belongs at the foot of the page, after everything
           an operator might have come here to do instead. -->
      <section aria-label="Disconnect" data-section="disconnect">
        <h3 class="mb-2 font-heading text-sm text-dt-text">Disconnect</h3>
        <p class="text-dt-text-muted">
          Disconnect rewrites the configuration back to the pure open-source values and removes the
          modules the cloud provided; the change is applied by recreating the stack.
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
      </section>
    </template>
  </div>
</template>
