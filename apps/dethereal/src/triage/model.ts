/**
 * The platform model a model directory names: its sync record's model id, when the record was made against the
 * platform this server is configured for. Every triage tool names its model this way, so all of them read and
 * write the same one.
 */
import { getPlatformUrl, originOf } from '../config.js'
import { readSyncJson } from '../utils/sync-utils.js'

/** Why a directory names no platform model this server may use. */
export class TriageModelError extends Error {
  constructor(readonly code: 'not_synced' | 'other_platform', message: string) {
    super(message)
    this.name = 'TriageModelError'
  }
}

/** The platform model id of the model directory `dir` (already confined by the caller). */
export async function platformModelOf(dir: string): Promise<string> {
  const sync = await readSyncJson(dir)
  const modelId = typeof sync?.platform_model_id === 'string' ? sync.platform_model_id : ''
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(modelId)) {
    throw new TriageModelError('not_synced', 'this model has not been pushed to the platform, or its sync record names no model: push it first')
  }
  const recorded = typeof sync?.platform_url === 'string' ? originOf(sync.platform_url) : ''
  const configured = originOf(getPlatformUrl().url)
  if (!recorded || recorded === 'invalid URL' || recorded !== configured) {
    throw new TriageModelError('other_platform', `this model was synced with ${recorded || 'an unknown platform'}, not the configured ${configured}`)
  }
  return modelId
}
