// src/composables/useHostContext.ts
import { useRouter, useRoute } from 'vue-router'
import { useAnalysisStore } from '@/stores/analysisStore'
import { useIssueStore } from '@/stores/issueStore'
import { useFlowStore } from '@/stores/flowStore'
import { useDispositionDialogStore, type OpenDispositionArgs } from '@/stores/dispositionDialogStore'
import { useIssueDialogStore, type FindingIssueResult } from '@/stores/issueDialogStore'
import { affirmReasonFor } from '@/composables/useFindingDisposition'
import { componentRegistry } from '@/services/ComponentRegistry'
import { getPageDisplayName } from '@/utils/dataFlowUtils'
import { DtUtils, type DispositionMutationResult } from '@dethernety/dt-core'
import apolloClient from '@/plugins/apolloClient'

// A finding reference as passed by callers (incl. module bundles over the host
// bridge). Only `.id` is required; `.name`/`.description` enrich the issue text and
// the not-found copy when present. The services map these onto the canonical
// flowStore mutations — they never hand the store itself to the caller. (Supersede
// derives the full attribute set, incl. exploited techniques, from the hydrated
// Exposure, so the thin ref carries no `exploitedBy`.)
interface FindingRef {
  id: string
  name?: string | null
  description?: string | null
}

import { 
  resolveComponent, 
  ref, 
  reactive, 
  computed, 
  watch, 
  getCurrentInstance,
  provide,
  inject,
  nextTick,
  onMounted,
  onUnmounted
} from 'vue'

export function useHostContext() {
  const router = useRouter()
  const route = useRoute()
  
  const analysisStore = useAnalysisStore()
  const issueStore = useIssueStore()
  const flowStore = useFlowStore()
  const dispositionDialogStore = useDispositionDialogStore()
  const issueDialogStore = useIssueDialogStore()

  const safeResolveComponent = (name: string) => {
    try {
      return resolveComponent(name)
    } catch (error) {
      console.warn(`Failed to resolve component: ${name}`, error)
      return null
    }
  }
  
  return {
    router,
    route,
    stores: {
      analysisStore,
      issueStore
    },
    services: {
      componentRegistry,
      // Open the platform's real disposition dialog from anywhere (incl. module
      // bundles). Resolves with the mutation result on save/clear, null on cancel.
      openDispositionDialog: (args: OpenDispositionArgs) => dispositionDialogStore.open(args),

      // Finding lifecycle actions — the SAME canonical flowStore→dt-core mutations
      // the dt-ui exposures tab calls, exposed as a narrow, session-scoped action
      // surface so module-loaded surfaces (e.g. the threat-report residual-risk
      // views) get identical behaviour that cannot drift from the platform's. The
      // store itself is never handed out; each service maps a finding ref onto one
      // authenticated mutation and returns its result envelope. The caller owns
      // feedback (snackbar/Undo) and refresh.

      // One-click affirm: confirm a finding is a real, live risk (kind AFFIRMED).
      affirmFinding: ({ finding }: { finding: FindingRef }): Promise<DispositionMutationResult> =>
        flowStore.disposeExposure({ exposureId: finding.id, kind: 'AFFIRMED', reason: affirmReasonFor('EXPOSURE') }),

      // Clear a disposition (Undo an affirm, or lift any disposition). Idempotent.
      clearFindingDisposition: ({ finding }: { finding: FindingRef }): Promise<DispositionMutationResult> =>
        flowStore.clearDisposition({ exposureId: finding.id }),

      // Supersede: create a USER-editable copy + mark the SYSTEM original SUPERSEDED.
      // Returns the partial-failure envelope so the caller can offer Retry. The caller
      // may pass only a thin finding ref (e.g. the report's residual-risk row has no
      // type/description/exploitedBy), so hydrate the full Exposure first — otherwise
      // createExposure receives an invalid input (a missing `type`) and the clone fails.
      supersedeFinding: async ({ finding, elementId }: { finding: FindingRef, elementId: string }) => {
        const exposure = await flowStore.getExposure({ exposureId: finding.id })
        // getExposure resolves undefined (it does not throw) when the row is gone —
        // a realistic race on a point-in-time report snapshot whose original was
        // deleted/superseded by another actor. Without this guard the undefined
        // flows into executeSupersedeFlow and derefs `.name`, surfacing a raw
        // "Cannot read properties of undefined" transport error instead of a clear
        // not-found. Fail with a readable domain error the caller already catches.
        if (!exposure) {
          throw new Error('The original finding no longer exists (it may have been deleted or superseded). Recreate the report to refresh.')
        }
        return flowStore.supersedeExposure({ exposureId: finding.id, elementId, exposure })
      },

      // Delete a (USER-authored) finding; the name drives the SYSTEM-supersede
      // companion flip in dt-core. Resolves true on success.
      deleteFinding: ({ finding }: { finding: FindingRef }): Promise<boolean> =>
        flowStore.deleteExposure({ exposureId: finding.id, exposureName: finding.name ?? undefined }),

      // Open the platform's full finding→issue workflow from anywhere (incl. module
      // bundles): the same menu as the exposures tab's IssueSelector — "Add to Issue
      // board" (copy + redirect) AND one entry per issue class that creates a real
      // issue attached to the element via the unchanged IssueDialog. The host owns all
      // issue logic (no drift); the module only triggers it. Resolves with the outcome
      // ({ created } / { copied }) or null on cancel.
      openFindingIssueSelector: async (
        { finding, elementId, modelId, elementLabel }:
        { finding: FindingRef, elementId: string, modelId: string, elementLabel?: string },
      ): Promise<FindingIssueResult> => {
        // Issue classes load app-wide in layouts/default.vue; ensure present as a
        // safety net before the picker offers the create path (board copy still works
        // even if this fails).
        if (!issueStore.issueClasses.length) {
          try { await issueStore.fetchIssueClasses({}) } catch { /* picker still offers board copy */ }
        }
        return issueDialogStore.open({ finding, elementId, modelId, elementLabel })
      }
    },
    vue: {
      ref,
      reactive,
      computed,
      watch,
      getCurrentInstance,
      provide,
      inject,
      nextTick,
      onMounted,
      onUnmounted,
      resolveComponent: safeResolveComponent
    },
    utils: {
      resolveComponent: safeResolveComponent,
      getPageDisplayName,
      dtUtils: new DtUtils(apolloClient)
    }
  }
}