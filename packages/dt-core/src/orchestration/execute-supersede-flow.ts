/**
 * Supersede orchestration helper.
 *
 * Composes the two backend mutations behind a Supersede operation:
 *   1. createExposure  — clone the SYSTEM exposure into a USER copy
 *   2. disposeExposure — mark the SYSTEM original as SUPERSEDED
 *
 * Pure helper: no Vue / Pinia dependency. The picker save path
 * passes a `DtExposure` instance in via args so this function stays unit-testable
 * with a mocked DtExposure.
 *
 * If step 2 returns `success: false`, the USER copy still exists — the caller
 * is expected to surface the partial-failure to the user with a Retry action.
 * This function does NOT roll back step 1: the USER copy is a
 * legitimate authoring artefact even when its disposition follow-up failed.
 *
 * IMPORTANT — the single-quote-wrapped name in the disposition reason is
 * load-bearing: the USER-copy-delete companion matches by
 * `dispositionReason CONTAINS "'<userCopyName>'"` (with the quotes). If you
 * change the quoting here, update `DtExposure.flipSupersededStaleByName` at
 * the same time — the two sites have to agree byte-for-byte.
 */

import type { DtExposure } from '../dt-exposure/dt-exposure.js'
import type { DispositionMutationResult, Exposure } from '../interfaces/core-types-interface.js'

export interface ExecuteSupersedeFlowArgs {
  systemExposureId: string
  systemExposure: Exposure
  elementId: string
  cloneNameSuffix?: string
  dtExposure: DtExposure
}

export interface ExecuteSupersedeFlowResult {
  userCopy: Exposure
  systemDispositionResult: DispositionMutationResult
}

export async function executeSupersedeFlow(
  args: ExecuteSupersedeFlowArgs,
): Promise<ExecuteSupersedeFlowResult> {
  const cloneName = `${args.systemExposure.name}${args.cloneNameSuffix ?? ' (custom)'}`

  // Description annotation: lets the user correlate the USER copy back to its
  // source even if they later rename it. Sentinel '(custom of ...)' is plaintext
  // — no structured backreference exists in v1.
  const sourceNote = `(custom of '${args.systemExposure.name}')`
  const cloneDescription = args.systemExposure.description
    ? `${args.systemExposure.description}\n\n${sourceNote}`
    : sourceNote

  // Step 1 — create the USER copy. createExposure throws on transport / network
  // failure; step 2 is not reached in that case (no rollback needed since step 1
  // never produced a node).
  //
  // Strip the SYSTEM id before passing through — server assigns a fresh id to
  // the new USER node. Using object-rest-with-ignored-binding avoids TS's
  // strict-property-init complaint about `id: undefined`.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { id: _omitId, ...sourceFields } = args.systemExposure
  const userCopy = await args.dtExposure.createExposure({
    exposure: {
      ...sourceFields,
      // createExposure's `exposure: Exposure` param expects an `id` field; the
      // wrapper ignores it on create (the server assigns one) but the type system
      // doesn't know that. An empty placeholder satisfies the type — overwritten
      // by the resolver.
      id: '',
      name: cloneName,
      description: cloneDescription,
    },
    elementId: args.elementId,
    attackTechniqueIds: (args.systemExposure.exploitedBy ?? []).map(t => t.id),
  })

  // Step 2 — dispose the SYSTEM original as SUPERSEDED. The single-quote wrapping
  // around cloneName is the USER-copy-delete companion match anchor.
  const systemDispositionResult = await args.dtExposure.disposeExposure({
    exposureId: args.systemExposureId,
    kind: 'SUPERSEDED',
    reason: `Superseded by user-authored exposure '${cloneName}'`,
  })

  return { userCopy, systemDispositionResult }
}
