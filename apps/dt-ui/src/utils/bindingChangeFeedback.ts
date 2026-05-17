/**
 * Pure helpers for class-change snackbar feedback.
 *
 * Branching order:
 *  1. result.errorCode set → error toast with sanitised errorMessage
 *  2. all-zero deltas (identity short-circuit on the server) → suppress entirely
 *  3. otherwise → success toast with delta-receipt copy
 *
 * Intentionally pure (no Vue / Vuetify imports) so calling components apply
 * the returned `{message, color}` to their existing `<v-snackbar>` ref.
 * Unit-tested in `__tests__/bindingChangeFeedback.test.ts`.
 */

import type {
  ChangeElementBindingResult,
  ElementBindingDeltas,
  ElementBindingErrorCode,
} from '@dethernety/dt-core'

export type SnackbarColor = 'success' | 'error'

/**
 * Friendly fallback messages keyed by `ElementBindingErrorCode`. Used when
 * the backend returned an error code but no localised `errorMessage` to
 * render. Each string speaks to an analyst, not a developer — no jargon, no
 * stack-trace allusions, no blame on the user.
 *
 * The backend's own `errorMessage` (when present) still wins; this map is
 * the floor — without it, the worst case is a code-tagged generic message,
 * which is analyst-unfriendly.
 */
export const FRIENDLY_ERROR_MESSAGES: Record<ElementBindingErrorCode, string> = {
  VALIDATION_ERROR: 'The class change request was invalid. Please refresh and try again.',
  ELEMENT_NOT_FOUND: "The element you're editing no longer exists. Refresh to continue.",
  CLASS_NOT_FOUND: 'The selected class is no longer available. Pick a different class.',
  MODEL_NOT_FOUND: 'The selected model is no longer available. Refresh the model list and try again.',
  ORPHAN_CLASS_REFUSED: "This class has no module attached and can't be assigned.",
  REPRESENTED_MODEL_NOT_ALLOWED: 'Only Components and Security Boundaries can represent a model. Remove the model link or change the element type.',
  MODULE_ERROR: 'The class module is temporarily unavailable. Please retry in a moment.',
  DATABASE_ERROR: 'A database error prevented the class change. Please retry; if it persists, contact support.',
}

/**
 * Structural discriminator for the snackbar payload — lets callers branch on
 * payload kind without string-matching on the rendered copy. Use this
 * (e.g. `payload.kind === 'delta'`) instead of substring tests against the
 * `message` field, which would break under copy or locale changes.
 */
export type SnackbarKind = 'identity' | 'delta' | 'error'

export interface SnackbarPayload {
  show: true
  message: string
  color: SnackbarColor
  kind: SnackbarKind
}

/** What kind of finding to mention in the receipt copy. */
export type FindingKind = 'exposures' | 'countermeasures'

/**
 * Transition context the calling component already has in hand: the kind of
 * findings tied to the element (exposures vs. countermeasures), and an
 * optional model name for the `class → representedModel` template.
 */
export interface TransitionContext {
  kind: FindingKind
  /** Optional — used only by the mixed `class → representedModel` template. */
  modelName?: string
  /** Discriminator for the `representedModel → none` copy template. */
  transition?: 'class-change' | 'class-to-model' | 'model-removed'
}

export function isAllZeroDeltas(deltas: ElementBindingDeltas): boolean {
  return (
    deltas.deletedDerivedExposures === 0 &&
    deltas.instantiatedDerivedExposures === 0 &&
    deltas.preservedCustomExposures === 0 &&
    deltas.deletedDerivedCountermeasures === 0 &&
    deltas.instantiatedDerivedCountermeasures === 0 &&
    deltas.preservedCustomCountermeasures === 0
  )
}

/**
 * Phrase like `1 auto-generated exposure` or `3 auto-generated exposures`,
 * `0 auto-generated countermeasures`. Trailing-s nouns only — fine for our
 * two cases.
 */
function nPhrase(count: number, plural: 'exposures' | 'countermeasures', adjective?: string): string {
  const noun = count === 1 ? plural.replace(/s$/, '') : plural
  const adj = adjective ? `${adjective} ` : ''
  return `${count} ${adj}${noun}`
}

/**
 * Build the receipt copy based on the transition kind. Copy conventions:
 *  - "auto-generated" + "of yours" instead of "derived" + "user-authored"
 *  - singular/plural at N=1 vs N>1
 *  - model name is left unquoted; the calling component owns visual emphasis
 *    if it wants to render it (snackbar copy stays plain text)
 */
export function formatDeltaCopy(
  deltas: ElementBindingDeltas,
  ctx: TransitionContext,
): string {
  const isCm = ctx.kind === 'countermeasures'
  const plural: 'exposures' | 'countermeasures' = isCm ? 'countermeasures' : 'exposures'
  const deleted = isCm ? deltas.deletedDerivedCountermeasures : deltas.deletedDerivedExposures
  const instantiated = isCm
    ? deltas.instantiatedDerivedCountermeasures
    : deltas.instantiatedDerivedExposures
  const preserved = isCm
    ? deltas.preservedCustomCountermeasures
    : deltas.preservedCustomExposures

  if (ctx.transition === 'model-removed') {
    return preserved > 0
      ? `Model link removed. ${nPhrase(preserved, plural)} of yours kept.`
      : 'Model link removed. This element no longer represents any model.'
  }

  if (ctx.transition === 'class-to-model' && ctx.modelName) {
    return `Class removed; this element is now linked to the ${ctx.modelName} model. ${nPhrase(deleted, plural, 'auto-generated')} deleted; ${nPhrase(preserved, plural)} of yours kept.`
  }

  // Default: class → class (or class → none / none → class — same shape works).
  return `Class changed. ${nPhrase(deleted, plural, 'auto-generated')} replaced by ${instantiated} new. ${nPhrase(preserved, plural)} of yours kept.`
}

/**
 * The main helper. Returns the snackbar payload the calling component should
 * push into its local `<v-snackbar>` ref, or `null` when the caller should
 * own the toast (network failure / temp-node-queued / store-level error).
 *
 * Identity-transition (all-zero deltas) returns a neutral confirmation
 * rather than null — security-ux-designer review F5: silently suppressing
 * the post-save signal leaves the user wondering whether anything happened.
 */
export function emitBindingChangeFeedback(
  result: ChangeElementBindingResult | null,
  ctx: TransitionContext,
): SnackbarPayload | null {
  if (!result) {
    return null
  }

  if (result.errorCode) {
    return {
      show: true,
      color: 'error',
      kind: 'error',
      message:
        result.errorMessage ??
        FRIENDLY_ERROR_MESSAGES[result.errorCode] ??
        `Class change failed (${result.errorCode}).`,
    }
  }

  if (isAllZeroDeltas(result.deltas)) {
    return {
      show: true,
      color: 'success',
      kind: 'identity',
      message: 'No changes to apply.',
    }
  }

  return {
    show: true,
    color: 'success',
    kind: 'delta',
    message: formatDeltaCopy(result.deltas, ctx),
  }
}
