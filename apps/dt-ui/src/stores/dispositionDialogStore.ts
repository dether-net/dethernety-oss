/**
 * dispositionDialogStore — a single, app-level home for the exposure/countermeasure
 * DispositionDialog so that callers which are NOT co-located with the dialog (most
 * importantly module-loaded analysis/report components rendered in
 * `analysisresults.vue`, which have no access to flowStore or dt-ui components) can
 * still trigger the real disposition flow.
 *
 * One `<DispositionDialog>` is mounted once in `layouts/default.vue`, bound to this
 * store. Any caller — host component or module (via `useHostContext().services
 * .openDispositionDialog`) — calls `open(args)` and awaits the returned promise,
 * which resolves with the mutation result on save/clear or `null` on cancel/close.
 *
 * The dialog itself owns the write path (flowStore.disposeExposure /
 * controlsStore.disposeCountermeasure) — this store only marshals open/close state
 * and the pending promise. It does not widen any scope: disposal is still bounded
 * by the platform's session-scoped, authenticated mutation.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { DispositionMutationResult } from '@dethernety/dt-core'
import {
  emptyDispositionDialogState,
  type DispositionDialogState,
  type DispositionableFinding,
  type FindingType,
} from '@/composables/useFindingDisposition'

export interface OpenDispositionArgs {
  finding: DispositionableFinding
  findingType?: FindingType // defaults to 'EXPOSURE'
}

export const useDispositionDialogStore = defineStore('dispositionDialog', () => {
  const state = ref<DispositionDialogState>(emptyDispositionDialogState())
  const findingType = ref<FindingType>('EXPOSURE')
  let resolver: ((result: DispositionMutationResult | null) => void) | null = null

  const settle = (result: DispositionMutationResult | null) => {
    state.value = { ...state.value, show: false }
    if (resolver) {
      resolver(result)
      resolver = null
    }
  }

  /**
   * Open the shared dialog for a finding. Resolves with the mutation result on
   * save/clear, or null on cancel/close. A new open() supersedes any pending one
   * (resolving the prior as cancelled).
   */
  const open = (args: OpenDispositionArgs): Promise<DispositionMutationResult | null> => {
    if (resolver) {
      resolver(null)
      resolver = null
    }
    const f = args.finding
    findingType.value = args.findingType ?? 'EXPOSURE'
    state.value = {
      show: true,
      findingId: f.id,
      findingName: f.name ?? '',
      initialKind: f.dispositionKind ?? null,
      initialReason: f.dispositionReason ?? '',
      isStale: Boolean(f.dispositionStale),
      lockKind: false,
      initialDispositionedBy: f.dispositionedBy ?? '',
      initialDispositionedAt: f.dispositionedAt ?? '',
    }
    return new Promise((resolve) => {
      resolver = resolve
    })
  }

  // Dialog event handlers (wired in layouts/default.vue).
  const onSaved = (result: DispositionMutationResult) => settle(result)
  const onCleared = (result: DispositionMutationResult) => settle(result)
  const onClose = () => settle(null)

  return { state, findingType, open, onSaved, onCleared, onClose }
})
