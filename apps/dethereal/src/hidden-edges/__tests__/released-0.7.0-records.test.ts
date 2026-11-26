/**
 * A decisions file written today, read by the reader Dethereal 0.7.0 shipped (a frozen copy): a release, a decision
 * 0.7.0 does not know, is counted as invalid and passed over, the rest of the file is read, and the edge it releases
 * stays accepted for that version, as its documentation says. Today's reader lets the release stand.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { candidateId } from '../contract.js'
import { DECISIONS_FILE, isSigner, readDecisions, signDecision, signerFor, standing } from '../records.js'
import { readDecisions as readDecisions070, standing as standing070 } from './released-0.7.0/records.js'
import { syncedModel } from './fixture.js'

const realHome = process.env.HOME
let tmp: string
beforeEach(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'he-released-')))
  process.env.HOME = path.join(tmp, 'home')
  fs.mkdirSync(process.env.HOME)
  fs.mkdirSync(path.join(tmp, 'repo'))
  initProjectRoot({ cwd: path.join(tmp, 'repo'), env: {} })
})
afterEach(() => {
  resetProjectRoot()
  process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('a release, read by Dethereal 0.7.0', () => {
  it('is counted invalid and passed over; the rest is read, and the edge stays accepted there; today it is released', async () => {
    const dir = await syncedModel(path.join(tmp, 'repo'), 'm')
    const signer = await signerFor(dir, true)
    if (!isSigner(signer)) throw new Error(`no signer: ${signer.code}`)
    const id = candidateId('remote-service', 'A', 'B')
    const other = candidateId('remote-service', 'B', 'A')
    const base = { kind: 'remote-service', technique_ids: ['T1021'], exposure_ids: ['e1'] }
    const accepted = signDecision(signer, { ...base, id, source: 'A', target: 'B', verb: 'accepted', flow_id: 'he-flow-1', at: '2026-11-20T00:00:00.000Z' })
    const rejected = signDecision(signer, { ...base, id: other, source: 'B', target: 'A', verb: 'rejected', flow_id: null, at: '2026-11-20T00:00:00.000Z' })
    const released = signDecision(signer, { ...base, id, source: 'A', target: 'B', verb: 'released', flow_id: null, at: '2026-11-21T00:00:00.000Z' })
    expect(released.mac).toBeNull()
    fs.writeFileSync(path.join(dir, '.dethereal', DECISIONS_FILE), JSON.stringify({ version: 1, decisions: [accepted, rejected, released] }, null, 2))

    const old = await readDecisions070(dir, signer as never)
    expect(old.status).toBe('ok')
    if (old.status !== 'ok') return
    expect(old.invalid).toBe(1)
    expect(old.decisions.map((d) => [d.id, d.verb])).toEqual([[id, 'accepted'], [other, 'rejected']])
    expect(standing070(old.decisions).get(id)).toMatchObject({ verb: 'accepted', verified: true })

    const now = await readDecisions(dir, signer)
    expect(now.status === 'ok' && now.invalid).toBe(0)
    if (now.status !== 'ok') return
    expect(standing(now.decisions).has(id)).toBe(false)
    expect(standing(now.decisions).get(other)).toMatchObject({ verb: 'rejected' })
  })
})
