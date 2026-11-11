/**
 * The one read of a model directory a push makes: the split model and its local
 * scope, as the object the gate judges and the push sends.
 */

import type { SplitModel } from '@dethernety/dt-core'
import { readModelDirectory, readScope, type AttributeReadIssue } from './directory-utils.js'
import { safeErrorMessage } from './gates.js'
import { StateFileError } from './state-store.js'

export type PushPayload =
  | { splitModel: SplitModel; readIssues: AttributeReadIssue[]; error?: undefined }
  | { error: string }

/**
 * Read the model directory once, with the local scope set on the manifest
 * (`.dethereal/scope.json` is its on-disk home; `readModelDirectory` does not read
 * it). A model or scope that cannot be read refuses the push. Attribute files that
 * could not be used are listed in `readIssues`: they are absent from the payload.
 */
export async function readPushPayload(dirPath: string): Promise<PushPayload> {
  const readIssues: AttributeReadIssue[] = []
  let splitModel: SplitModel
  try {
    splitModel = await readModelDirectory(dirPath, readIssues)
  } catch (err) {
    return { error: `Push refused: the model could not be read (${safeErrorMessage(err)}).` }
  }
  try {
    splitModel.manifest.model.scope = (await readScope(dirPath)) ?? undefined
  } catch (error) {
    const code = error instanceof StateFileError ? error.code : 'unreadable'
    return { error: `.dethereal/scope.json could not be read (${code}); fix or remove it, then push again` }
  }
  return { splitModel, readIssues }
}
