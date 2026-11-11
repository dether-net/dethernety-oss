/**
 * The downstream items against a real platform export of the synthetic key
 * model (scrubbed of platform ids): the key model pushed to a local platform
 * and exported through the server's own tools, exposures included.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { attackPaths, downstreamItems, exposureSet } from '../score/rubric.js'
import type { PlatformExport } from '../platform-export.js'
import { key } from './fixtures/clean-run.js'

const EXPORT: PlatformExport = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/platform-export/key-model.json'), 'utf8'))
const clone = (): PlatformExport => JSON.parse(JSON.stringify(EXPORT))
const item = (items: ReturnType<typeof downstreamItems>, id: string) => items.find((i) => i.id === id)!

describe('the downstream items on a real export of the key model', () => {
  it('matches every exposure of the export to a key element, and finds the paths to the crown jewel', () => {
    const total = Object.values(EXPORT.exposures).flat().length
    expect(total).toBe(317)
    expect(exposureSet(EXPORT, key).size).toBe(total)
    expect([...attackPaths(EXPORT, key)].sort()).toEqual(['x-customer->c-orders-db', 'x-engineer->c-orders-db', 'x-payvendor->c-orders-db'])
  })

  it('passes a run whose platform model is the key model', () => {
    const items = downstreamItems(clone(), EXPORT, key)
    expect(item(items, 'downstream.exposures')).toMatchObject({ pass: true, hits: 317, n: 317 })
    expect(item(items, 'downstream.attack_paths')).toMatchObject({ pass: true, tally: { ok: 3, n: 3 } })
  })

  it('fails a run whose platform model lost the bastion: a path is gone and its exposures with it', () => {
    const run = clone()
    let bastion: string | undefined
    const walk = (b: any) => {
      for (const c of b.components ?? []) if (/bastion/i.test(c.name)) bastion = c.id
      for (const n of b.boundaries ?? []) walk(n)
    }
    walk((run.files['structure.json'] as any).defaultBoundary)
    expect(bastion).toBeDefined()
    // The platform model without the bastion's flows and exposures.
    const flows = run.files['dataflows.json'] as any
    flows.dataFlows = flows.dataFlows.filter((f: any) => f.source?.id !== bastion && f.target?.id !== bastion)
    delete run.exposures[bastion!]
    const items = downstreamItems(run, EXPORT, key)
    expect(item(items, 'downstream.attack_paths')).toMatchObject({ pass: false, refs: ['x-engineer->c-orders-db'] })
    expect(item(items, 'downstream.exposures').hits).toBeLessThan(317)
  })

  it('leaves out an element modelled under another class the key accepts, and only such an element', () => {
    const reclass = (run: PlatformExport, flowId: string, classId: string, exposure: string) => {
      const f = (run.files['dataflows.json'] as any).dataFlows.find((x: any) => x.id === flowId)
      f.classData = { ...f.classData, id: classId }
      run.exposures[flowId] = [{ name: exposure }] as never
    }
    // The routed API request (f-gateway-orders) as an API Call, which the key accepts: another class's exposures.
    const api = clone()
    reclass(api, 'p-009', '01170208-db8f-4c1b-8e29-636bf6d220b8', 'Cleartext transport / TLS strip')
    expect(item(downstreamItems(api, EXPORT, key), 'downstream.exposures')).toMatchObject({ pass: true, hits: 307, n: 307, detail: expect.stringMatching(/left out, modelled under another class the key accepts: f-gateway-orders$/) })
    // The admin database session (f-bastion-db) as Secure Remote Access, which the key does not accept: a miss.
    const remote = clone()
    reclass(remote, 'p-007', '5f88d821-1513-4c08-b9ed-7ea0aed3ac86', 'Remote session hijacking')
    const r = item(downstreamItems(remote, EXPORT, key), 'downstream.exposures')
    expect(r).toMatchObject({ hits: 309, n: 318 })
    expect(r.detail).not.toMatch(/left out/)
  })

  it('fails both items without an export', () => {
    for (const items of [downstreamItems(null, EXPORT, key), downstreamItems(clone(), null, key)]) {
      expect(items.map((i) => i.pass)).toEqual([false, false])
    }
  })
})
