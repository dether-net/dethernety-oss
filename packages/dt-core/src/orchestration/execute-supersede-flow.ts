/**
 * Supersede orchestration helper.
 *
 * Composes the two backend mutations behind a Supersede operation:
 *   1. createExposure  — clone the SYSTEM exposure into a USER copy, with every
 *      technique that exploits it (ATT&CK and ATLAS) and each EXPLOITED_BY edge's
 *      justification
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
 * Three options, all off by default (and then nothing above changes):
 *   - `techniqueLinks` replaces the read of the original's links: the copy gets exactly these (a link
 *     named twice is sent once, with its first justification). The read also proved the original exists;
 *     with this option the caller vouches for that. Before the original is disposed, the copy is checked:
 *     it must have an id and carry every requested link, each in its own framework. If not,
 *     `SupersedeCloneError` is thrown (with the copy's id, when it has one) and the original is left
 *     undisposed.
 *   - `cloneContent` sets the content fields createExposure does not write on the copy, between create and
 *     dispose. A failure there does not stop the dispose: it is returned as `contentWarning`.
 *   - `copyName` names the copy instead of the original's name with the suffix; the description's
 *     "(custom of …)" note still names the original.
 * With any of them, a dispose that throws is rethrown as `SupersedeDisposeError`, carrying the copy's id: the
 * copy exists, and whether the original was marked is unknown.
 *
 * IMPORTANT — the single-quote-wrapped name in the disposition reason is
 * load-bearing: the USER-copy-delete companion matches by
 * `dispositionReason CONTAINS "'<userCopyName>'"` (with the quotes). If you
 * change the quoting here, update `DtExposure.flipSupersededStaleByName` at
 * the same time — the two sites have to agree byte-for-byte.
 */

import type { DtExposure } from '../dt-exposure/dt-exposure.js'
import type { DispositionMutationResult, Exposure, ExposureContent, ExposureTechniqueLinks, TechniqueLink } from '../interfaces/core-types-interface.js'

export interface ExecuteSupersedeFlowArgs {
  systemExposureId: string
  systemExposure: Exposure
  elementId: string
  cloneNameSuffix?: string
  dtExposure: DtExposure
  /** The copy's technique links, used instead of the original's; the copy is checked against them. */
  techniqueLinks?: ExposureTechniqueLinks
  /** Content fields to set on the copy before the original is disposed. */
  cloneContent?: ExposureContent
  /** The copy's name, instead of the original's name with the suffix. */
  copyName?: string
}

export interface ExecuteSupersedeFlowResult {
  userCopy: Exposure
  systemDispositionResult: DispositionMutationResult
  /** Set only when `cloneContent` was given and setting it failed; the dispose still ran. */
  contentWarning?: string
}

/** Links with each id once, the first one's justification kept. */
function uniqueLinks(links: TechniqueLink[]): TechniqueLink[] {
  const seen = new Set<string>()
  return links.filter((l) => (seen.has(l.id) ? false : (seen.add(l.id), true)))
}

/** The copy does not match what was requested; the original was not disposed. */
export class SupersedeCloneError extends Error {
  constructor(message: string, readonly cloneId: string | null) {
    super(message)
    this.name = 'SupersedeCloneError'
  }
}

/** The copy was created, and the dispose of the original threw: whether the original was marked is unknown. */
export class SupersedeDisposeError extends Error {
  /** `contentWarning`: set when the copy's content could not be set either. */
  constructor(message: string, readonly cloneId: string, readonly contentWarning?: string) {
    super(message)
    this.name = 'SupersedeDisposeError'
  }
}

export async function executeSupersedeFlow(
  args: ExecuteSupersedeFlowArgs,
): Promise<ExecuteSupersedeFlowResult> {
  const cloneName = args.copyName ?? `${args.systemExposure.name}${args.cloneNameSuffix ?? ' (custom)'}`

  // Description annotation: lets the user correlate the USER copy back to its
  // source even if they later rename it. Sentinel '(custom of ...)' is plaintext
  // — no structured backreference exists in v1.
  const sourceNote = `(custom of '${args.systemExposure.name}')`
  const cloneDescription = args.systemExposure.description
    ? `${args.systemExposure.description}\n\n${sourceNote}`
    : sourceNote

  // Every technique that exploits the original, ATT&CK and ATLAS, with each edge's justification — or,
  // when given, the links the copy is to have instead.
  const links = args.techniqueLinks
    ? { exploitedBy: uniqueLinks(args.techniqueLinks.exploitedBy ?? []), exploitedByAtlas: uniqueLinks(args.techniqueLinks.exploitedByAtlas ?? []) }
    : await args.dtExposure.getExposureTechniqueLinks({ exposureId: args.systemExposureId })
  if (!links) {
    throw new Error('Supersede failed: the exposure to supersede was not found')
  }

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
    attackTechniqueLinks: links.exploitedBy,
    atlasTechniqueLinks: links.exploitedByAtlas,
  })

  const withOptions = args.techniqueLinks !== undefined || args.cloneContent !== undefined || args.copyName !== undefined
  if (withOptions) {
    if (!userCopy?.id) {
      throw new SupersedeCloneError('Supersede stopped: the copy was created without an id; the original was not disposed', null)
    }
  }
  if (args.techniqueLinks) {
    const attack = new Set((userCopy.exploitedBy ?? []).map((t) => t.id))
    const atlas = new Set((userCopy.exploitedByAtlas ?? []).map((t) => t.id))
    const missing = [
      ...links.exploitedBy.filter((l) => !attack.has(l.id)),
      ...links.exploitedByAtlas.filter((l) => !atlas.has(l.id)),
    ].map((l) => l.id)
    if (missing.length) {
      throw new SupersedeCloneError(
        `Supersede stopped: the copy ${userCopy.id} is missing technique link(s) ${missing.join(', ')}; the original was not disposed`,
        userCopy.id,
      )
    }
  }
  let contentWarning: string | undefined
  if (args.cloneContent) {
    try {
      await args.dtExposure.setExposureContent({ exposureId: userCopy.id, content: args.cloneContent })
    } catch (error) {
      contentWarning = `the copy's content could not be set: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  // Step 2 — dispose the SYSTEM original as SUPERSEDED. The single-quote wrapping
  // around cloneName is the USER-copy-delete companion match anchor.
  const dispose = () => args.dtExposure.disposeExposure({
    exposureId: args.systemExposureId,
    kind: 'SUPERSEDED',
    reason: `Superseded by user-authored exposure '${cloneName}'`,
  })
  let systemDispositionResult: DispositionMutationResult
  if (withOptions) {
    try {
      systemDispositionResult = await dispose()
    } catch (error) {
      throw new SupersedeDisposeError(`Supersede incomplete: the copy ${userCopy.id} was created, and marking the original failed: ${error instanceof Error ? error.message : String(error)}`, userCopy.id, contentWarning)
    }
  } else {
    systemDispositionResult = await dispose()
  }

  return contentWarning === undefined ? { userCopy, systemDispositionResult } : { userCopy, systemDispositionResult, contentWarning }
}
