/**
 * Test helpers shared by the acceptance tests.
 */
import fs from 'node:fs'
import type { TranscriptEvent } from '../transcripts/types.js'

/**
 * A transcript event builder with its own sequence counter. Every event is the
 * main session's; `risingTs` stamps each one a second after the last.
 */
export function eventBuilder(options: { risingTs?: boolean } = {}) {
  let seq = 0
  const ev = (e: Partial<TranscriptEvent> & Pick<TranscriptEvent, 'kind'>): TranscriptEvent =>
    ({ ts: options.risingTs ? `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z` : '2026-01-01T00:00:00Z', actor: 'main', actorId: 's', harness: 'claude', seq: seq++, ...e }) as TranscriptEvent
  return { ev, reset: () => { seq = 0 } }
}

/** Rewrite a JSON file in place. */
export function editJson(file: string, edit: (v: any) => void): void {
  const v = JSON.parse(fs.readFileSync(file, 'utf8'))
  edit(v)
  fs.writeFileSync(file, JSON.stringify(v, null, 2))
}
