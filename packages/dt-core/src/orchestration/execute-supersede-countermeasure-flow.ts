/**
 * Supersede orchestration helper for Countermeasures. Parallel to
 * executeSupersedeFlow (the Exposure side).
 *
 * Composes the two backend mutations behind a Supersede operation:
 *   1. createCountermeasure — clone the SYSTEM countermeasure into a USER copy,
 *      wired to the originating Control via HAS_COUNTERMEASURE (the load-bearing
 *      edge that keeps the clone visible in the ControlDialog sub-table). The
 *      class edge IS_COUNTERMEASURE_OF is intentionally NOT set, so the binding
 *      sweep treats the clone as USER-authored and preserves it.
 *   2. disposeCountermeasure — mark the SYSTEM original as SUPERSEDED.
 *
 * Pure helper: no Vue / Pinia dependency — a `DtCountermeasure` instance is
 * passed in so this stays unit-testable with a mock.
 *
 * If step 2 returns `success: false`, the USER copy still exists — the caller
 * surfaces the partial-failure with a Retry action (no rollback; the USER copy
 * is a legitimate authoring artefact).
 *
 * IMPORTANT — the single-quote-wrapped name in the disposition reason is
 * load-bearing: the USER-copy-delete companion matches by
 * `dispositionReason CONTAINS "'<userCopyName>'"` (with the quotes). If you
 * change the quoting here, update `DtCountermeasure.flipSupersededCountermeasureStaleByName`
 * at the same time — the two sites have to agree byte-for-byte.
 */

import type { DtCountermeasure } from '../dt-countermeasure/dt-countermeasure.js'
import type { DispositionMutationResult, Countermeasure } from '../interfaces/core-types-interface.js'

export interface ExecuteSupersedeCountermeasureFlowArgs {
  systemCountermeasureId: string
  systemCountermeasure: Countermeasure
  controlId: string
  cloneNameSuffix?: string
  dtCountermeasure: DtCountermeasure
}

export interface ExecuteSupersedeCountermeasureFlowResult {
  userCopy: Countermeasure
  systemDispositionResult: DispositionMutationResult
}

export async function executeSupersedeCountermeasureFlow(
  args: ExecuteSupersedeCountermeasureFlowArgs,
): Promise<ExecuteSupersedeCountermeasureFlowResult> {
  const cloneName = `${args.systemCountermeasure.name}${args.cloneNameSuffix ?? ' (custom)'}`

  // Description annotation mirrors the Exposure side — a plaintext backreference
  // so the user can correlate the USER copy to its source after a rename.
  const sourceNote = `(custom of '${args.systemCountermeasure.name}')`
  const cloneDescription = args.systemCountermeasure.description
    ? `${args.systemCountermeasure.description}\n\n${sourceNote}`
    : sourceNote

  // Step 1 — create the USER copy attached to the originating Control.
  // createCountermeasure throws on transport / network failure; step 2 is not
  // reached in that case (no rollback needed since step 1 produced no node).
  const userCopy = await args.dtCountermeasure.createCountermeasure({
    controlId: args.controlId,
    countermeasure: {
      ...args.systemCountermeasure,
      // createCountermeasure ignores `id` on create (server assigns one); the
      // empty placeholder satisfies the Countermeasure type.
      id: '',
      name: cloneName,
      description: cloneDescription,
    },
  })

  if (!userCopy) {
    throw new Error('Supersede failed: createCountermeasure returned null')
  }

  // Step 2 — dispose the SYSTEM original as SUPERSEDED. The single-quote wrapping
  // around cloneName is the USER-copy-delete companion match anchor.
  const systemDispositionResult = await args.dtCountermeasure.disposeCountermeasure({
    countermeasureId: args.systemCountermeasureId,
    kind: 'SUPERSEDED',
    reason: `Superseded by user-authored countermeasure '${cloneName}'`,
  })

  return { userCopy, systemDispositionResult }
}
