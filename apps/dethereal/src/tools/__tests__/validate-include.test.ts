/**
 * One validate call that also returns the gates and the zoning: each part exactly as its own action returns it, a part
 * that cannot be computed named as unavailable while the rest still comes, and include refused off its scope.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateModelTool } from '../validate-model.tool.js'
import { gateModel, writeGateModel } from '../../utils/__tests__/fixtures/gate-model.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'

vi.setConfig({ testTimeout: 30_000 })

const context = { debug: false, settlement: 'off' as const }
let root: string
let dir: string

beforeAll(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dethereal-validate-include-')))
  initProjectRoot({ env: { DETHEREAL_PROJECT_ROOT: root } })
  dir = path.join(root, 'model')
  await writeGateModel(dir, gateModel())
})
afterAll(async () => {
  resetProjectRoot()
  await fs.rm(root, { recursive: true, force: true })
})

const call = (input: Record<string, unknown>) => validateModelTool.run(input, context) as Promise<{ success: boolean; data?: any; error?: string }>

describe('validate with include', () => {
  it('returns validate, the gates and the zoning, each as its own action does', async () => {
    const [combined, alone, gates, zoning] = await Promise.all([
      call({ action: 'validate', directory_path: dir, include: ['gates', 'zoning'] }),
      call({ action: 'validate', directory_path: dir }),
      call({ action: 'gates', directory_path: dir }),
      call({ action: 'zoning', directory_path: dir }),
    ])
    expect(combined.success, combined.error).toBe(true)
    const { gates: g, zoning: z, ...validate } = combined.data
    expect(validate).toEqual(alone.data)
    expect(g).toEqual(gates.data)
    expect(z).toEqual(zoning.data)
  })

  it('gives the gates its detail and the zoning its assets, and only the parts asked for', async () => {
    const [combined, gates, zoning] = await Promise.all([
      call({ action: 'validate', directory_path: dir, include: ['gates', 'zoning'], detail: 'summary', assets: 'skeleton' }),
      call({ action: 'gates', directory_path: dir, detail: 'summary' }),
      call({ action: 'zoning', directory_path: dir, assets: 'skeleton' }),
    ])
    expect(combined.data.gates).toEqual(gates.data)
    expect(combined.data.zoning).toEqual(zoning.data)
    const onlyZoning = await call({ action: 'validate', directory_path: dir, include: ['zoning'] })
    expect(onlyZoning.data).not.toHaveProperty('gates')
    expect(onlyZoning.data).toHaveProperty('zoning')
  })

  it('names a part it cannot compute, and still gives the rest', async () => {
    const spy = vi.spyOn(validateModelTool as unknown as { computeZoning: () => Promise<unknown> }, 'computeZoning').mockRejectedValueOnce(new Error('no zoning here'))
    try {
      const r = await call({ action: 'validate', directory_path: dir, include: ['gates', 'zoning'] })
      expect(r.success, r.error).toBe(true)
      expect(r.data).toHaveProperty('valid')
      expect(r.data).toHaveProperty('gates')
      expect(r.data).not.toHaveProperty('zoning')
      expect(r.data.zoning_unavailable).toEqual({ code: 'zoning_failed', message: 'no zoning here' })
    } finally {
      spy.mockRestore()
    }
  })

  it('refuses include off its scope: another action, or inline data', async () => {
    for (const input of [
      { action: 'gates', directory_path: dir, include: ['zoning'] },
      { action: 'quality', directory_path: dir, include: ['gates'] },
      { action: 'validate', data: '{}', file_type: 'manifest', include: ['gates'] },
    ]) {
      const r = await call(input)
      expect(r.success, JSON.stringify(input)).toBe(false)
      expect(r.data).toEqual({ codes: ['include_scope'] })
    }
  })
})
