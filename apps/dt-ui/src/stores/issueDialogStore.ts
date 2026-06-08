/**
 * issueDialogStore — a single, app-level home for the finding→issue flow (the
 * `IssueSelector` menu + `IssueDialog` create path) so that callers which are NOT
 * co-located with those components — most importantly module-loaded analysis/report
 * surfaces rendered in `analysisresults.vue`, which have no access to the issue
 * components or flowStore — can still trigger the real, full issue workflow.
 *
 * One `<FindingIssueDialog>` is mounted once in `layouts/default.vue`, bound to this
 * store. Any caller — host component or module (via `useHostContext().services
 * .openFindingIssueSelector`) — calls `open(args)` and awaits the returned promise,
 * which resolves with `{ created }` / `{ copied }` on completion or `null` on cancel.
 *
 * Mirrors `dispositionDialogStore`: this store only marshals open/close state and the
 * finding context (the issue name/description/element ids are derived from it). The
 * mounted component owns the write path (the platform's `issueStore.createIssue` /
 * `addElementsToIssue` via the unchanged `IssueDialog`, and `setIssueDataClipboard`
 * for the board copy) — so the report's issue workflow cannot drift from the dt-ui
 * exposures tab's, and no extra scope is widened (creation is still bounded by the
 * platform's session-scoped, authenticated mutations).
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

// The finding the issue is raised from. Only `id` is required; `name`/`description`
// enrich the pre-filled issue text (matching the exposures tab).
export interface IssueFindingRef {
  id: string
  name?: string | null
  description?: string | null
}

export interface OpenFindingIssueArgs {
  finding: IssueFindingRef
  // The host element the finding sits on, and the model/analysis it belongs to —
  // attached to the created issue (mirrors the exposures tab's element-ids).
  elementId: string
  modelId: string
  // Human label of the element, for the "<Finding> Issue on <label>" issue name.
  elementLabel?: string
}

// What `open()` resolves with: a created issue, a board copy, or null on cancel.
export type FindingIssueResult = { created: true } | { copied: true } | null

export const useIssueDialogStore = defineStore('issueDialog', () => {
  const show = ref(false)
  const finding = ref<IssueFindingRef | null>(null)
  const elementId = ref('')
  const modelId = ref('')
  const elementLabel = ref('')
  let resolver: ((result: FindingIssueResult) => void) | null = null

  /**
   * Open the shared finding→issue picker. Resolves with the outcome on create/copy,
   * or null on cancel/close. A new open() supersedes any pending one (resolving the
   * prior as cancelled).
   */
  const open = (args: OpenFindingIssueArgs): Promise<FindingIssueResult> => {
    if (resolver) {
      resolver(null)
      resolver = null
    }
    finding.value = args.finding
    elementId.value = args.elementId
    modelId.value = args.modelId
    elementLabel.value = args.elementLabel ?? ''
    show.value = true
    return new Promise((resolve) => {
      resolver = resolve
    })
  }

  // Settle + close (wired to the mounted component's outcomes in layouts/default.vue).
  const close = (result: FindingIssueResult = null) => {
    show.value = false
    if (resolver) {
      resolver(result)
      resolver = null
    }
  }

  return { show, finding, elementId, modelId, elementLabel, open, close }
})
