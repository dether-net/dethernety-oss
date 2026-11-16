/**
 * executeSupersedeFlow's two options. Without them the flow makes exactly the calls it always made, in the
 * same order and with the same arguments (the golden below); with them, the copy gets the given links and
 * content, and a copy that does not match is stopped before the original is disposed.
 */

import { describe, it, expect, vi } from 'vitest'

import { executeSupersedeFlow, SupersedeCloneError, SupersedeDisposeError } from '../execute-supersede-flow.js'
import type { DtExposure } from '../../dt-exposure/dt-exposure.js'
import type { Exposure } from '../../interfaces/core-types-interface.js'

const LINKS = {
  exploitedBy: [{ id: 'tech-1', justification: 'found in the image' }, { id: 'tech-2', justification: null }],
  exploitedByAtlas: [{ id: 'atlas-1', justification: 'prompt reaches the model' }],
}

const SYSTEM_EXPOSURE: Exposure = {
  id: 'sys-exp-1',
  name: 'Hardcoded credentials',
  description: 'Module-instantiated finding.',
  type: '1',
  category: 'Configuration',
  score: 7,
  attackVector: 'LOCAL',
  createdBy: 'SYSTEM',
}

/** A DtExposure whose every call is recorded, in order, with its arguments. */
function recording(copy: Partial<Exposure> | null = { id: 'user-exp-1' }, opts: { contentFails?: boolean; disposeThrows?: boolean } = {}) {
  const calls: Array<[string, unknown]> = []
  const dtExposure = {
    getExposureTechniqueLinks: vi.fn(async (a: unknown) => (calls.push(['getExposureTechniqueLinks', a]), LINKS)),
    createExposure: vi.fn(async (a: unknown) => (calls.push(['createExposure', a]), copy)),
    setExposureContent: vi.fn(async (a: unknown) => {
      calls.push(['setExposureContent', a])
      if (opts.contentFails) throw new Error('update refused')
      return { id: 'user-exp-1' }
    }),
    disposeExposure: vi.fn(async (a: unknown) => {
      calls.push(['disposeExposure', a])
      if (opts.disposeThrows) throw new Error('network down')
      return { success: true }
    }),
  } as unknown as DtExposure
  return { dtExposure, calls }
}

describe('executeSupersedeFlow without the options', () => {
  it('makes the same calls, in the same order, with the same arguments, and returns the same shape', async () => {
    const { dtExposure, calls } = recording({ id: 'user-exp-1', name: 'Hardcoded credentials (custom)' })
    const result = await executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure })
    expect(calls).toEqual([
      ['getExposureTechniqueLinks', { exposureId: 'sys-exp-1' }],
      ['createExposure', {
        exposure: {
          name: 'Hardcoded credentials (custom)',
          description: "Module-instantiated finding.\n\n(custom of 'Hardcoded credentials')",
          type: '1',
          category: 'Configuration',
          score: 7,
          attackVector: 'LOCAL',
          createdBy: 'SYSTEM',
          id: '',
        },
        elementId: 'elem-1',
        attackTechniqueLinks: LINKS.exploitedBy,
        atlasTechniqueLinks: LINKS.exploitedByAtlas,
      }],
      ['disposeExposure', { exposureId: 'sys-exp-1', kind: 'SUPERSEDED', reason: "Superseded by user-authored exposure 'Hardcoded credentials (custom)'" }],
    ])
    expect(Object.keys(result).sort()).toEqual(['systemDispositionResult', 'userCopy'])
  })

  it('still disposes when the copy comes back without an id (no check without the options)', async () => {
    const { dtExposure, calls } = recording({})
    await executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure })
    expect(calls.map(([name]) => name)).toEqual(['getExposureTechniqueLinks', 'createExposure', 'disposeExposure'])
  })
})

describe('executeSupersedeFlow with techniqueLinks', () => {
  const wanted = { exploitedBy: [{ id: 'tech-1', justification: 'found in the image' }, { id: 'tech-9' }], exploitedByAtlas: [] }

  it('gives the copy exactly the given links, without reading the original\'s', async () => {
    const { dtExposure, calls } = recording({ id: 'user-exp-1', exploitedBy: [{ id: 'tech-1' }, { id: 'tech-9' }] as Exposure['exploitedBy'] })
    await executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure, techniqueLinks: wanted })
    expect(calls.map(([name]) => name)).toEqual(['createExposure', 'disposeExposure'])
    const create = calls[0][1] as { attackTechniqueLinks: unknown; atlasTechniqueLinks: unknown }
    expect(create.attackTechniqueLinks).toEqual(wanted.exploitedBy)
    expect(create.atlasTechniqueLinks).toEqual([])
  })

  it('stops before the dispose when the copy is missing a requested link', async () => {
    const { dtExposure, calls } = recording({ id: 'user-exp-1', exploitedBy: [{ id: 'tech-1' }] as Exposure['exploitedBy'] })
    const run = executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure, techniqueLinks: wanted })
    await expect(run).rejects.toBeInstanceOf(SupersedeCloneError)
    await expect(run).rejects.toMatchObject({ cloneId: 'user-exp-1', message: expect.stringContaining('tech-9') })
    expect(calls.map(([name]) => name)).toEqual(['createExposure'])
  })

  it('checks each framework against its own links, ATLAS included', async () => {
    const both = { exploitedBy: [{ id: 'tech-1' }], exploitedByAtlas: [{ id: 'atlas-1', justification: 'prompt reaches the model' }] }
    const ok = recording({ id: 'user-exp-1', exploitedBy: [{ id: 'tech-1' }], exploitedByAtlas: [{ id: 'atlas-1' }] } as Partial<Exposure>)
    await executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure: ok.dtExposure, techniqueLinks: both })
    expect((ok.calls[0][1] as { atlasTechniqueLinks: unknown }).atlasTechniqueLinks).toEqual(both.exploitedByAtlas)
    expect(ok.calls.map(([name]) => name)).toEqual(['createExposure', 'disposeExposure'])
    // The ATLAS id carried as an ATT&CK link is not the requested ATLAS link.
    const wrongSide = recording({ id: 'user-exp-1', exploitedBy: [{ id: 'tech-1' }, { id: 'atlas-1' }] } as Partial<Exposure>)
    await expect(
      executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure: wrongSide.dtExposure, techniqueLinks: both }),
    ).rejects.toMatchObject({ name: 'SupersedeCloneError', message: expect.stringContaining('atlas-1') })
    expect(wrongSide.calls.map(([name]) => name)).toEqual(['createExposure'])
  })

  it('sends a link named twice once, with its first justification', async () => {
    const twice = { exploitedBy: [{ id: 'tech-1', justification: 'first' }, { id: 'tech-1', justification: 'second' }], exploitedByAtlas: [] }
    const { dtExposure, calls } = recording({ id: 'user-exp-1', exploitedBy: [{ id: 'tech-1' }] } as Partial<Exposure>)
    await executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure, techniqueLinks: twice })
    expect((calls[0][1] as { attackTechniqueLinks: unknown }).attackTechniqueLinks).toEqual([{ id: 'tech-1', justification: 'first' }])
  })

  it('stops before the dispose when the copy has no id', async () => {
    const { dtExposure, calls } = recording({})
    await expect(
      executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure, techniqueLinks: wanted }),
    ).rejects.toMatchObject({ name: 'SupersedeCloneError', cloneId: null })
    expect(calls.map(([name]) => name)).toEqual(['createExposure'])
  })
})

describe('executeSupersedeFlow with cloneContent', () => {
  const content = { references: 'https://example.com/advisory', mitigationSuggestions: ['rotate'], detectionMethods: ['audit log'], tags: ['secrets'], techniques: ['T1003'] }

  it('sets the content on the copy between create and dispose', async () => {
    const { dtExposure, calls } = recording()
    const result = await executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure, cloneContent: content })
    expect(calls.map(([name]) => name)).toEqual(['getExposureTechniqueLinks', 'createExposure', 'setExposureContent', 'disposeExposure'])
    expect(calls[2][1]).toEqual({ exposureId: 'user-exp-1', content })
    expect(result.contentWarning).toBeUndefined()
  })

  it('still disposes when the content cannot be set, and says so', async () => {
    const { dtExposure, calls } = recording({ id: 'user-exp-1' }, { contentFails: true })
    const result = await executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure, cloneContent: content })
    expect(calls.map(([name]) => name)).toEqual(['getExposureTechniqueLinks', 'createExposure', 'setExposureContent', 'disposeExposure'])
    expect(result.contentWarning).toMatch(/update refused/)
  })

  it('with both options, checks the links before it sets any content', async () => {
    const { dtExposure, calls } = recording({ id: 'user-exp-1', exploitedBy: [] } as Partial<Exposure>)
    await expect(
      executeSupersedeFlow({
        systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure,
        techniqueLinks: { exploitedBy: [{ id: 'tech-1' }], exploitedByAtlas: [] }, cloneContent: content,
      }),
    ).rejects.toBeInstanceOf(SupersedeCloneError)
    expect(calls.map(([name]) => name)).toEqual(['createExposure'])
  })

  it('does not set content on a copy without an id', async () => {
    const { dtExposure, calls } = recording({})
    await expect(
      executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure, cloneContent: content }),
    ).rejects.toBeInstanceOf(SupersedeCloneError)
    expect(calls.map(([name]) => name)).toEqual(['getExposureTechniqueLinks', 'createExposure'])
  })
})

describe('executeSupersedeFlow with copyName', () => {
  it('names the copy as given, while the note and the reason still name the original and the copy', async () => {
    const { dtExposure, calls } = recording()
    await executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure, copyName: 'Credentials in the image (custom)' })
    const created = (calls.find(([n]) => n === 'createExposure')![1] as { exposure: Exposure }).exposure
    expect(created.name).toBe('Credentials in the image (custom)')
    expect(created.description).toBe("Module-instantiated finding.\n\n(custom of 'Hardcoded credentials')")
    expect(calls.at(-1)![1]).toEqual({ exposureId: 'sys-exp-1', kind: 'SUPERSEDED', reason: "Superseded by user-authored exposure 'Credentials in the image (custom)'" })
  })
})

describe('a dispose that throws', () => {
  it('is rethrown with the copy\'s id when an option is given', async () => {
    for (const options of [{ techniqueLinks: { exploitedBy: [], exploitedByAtlas: [] } }, { cloneContent: { tags: ['x'] } }, { copyName: 'X (custom)' }]) {
      const { dtExposure } = recording({ id: 'user-exp-1', exploitedBy: [], exploitedByAtlas: [] } as Partial<Exposure>, { disposeThrows: true })
      const err = await executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure, ...options }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(SupersedeDisposeError)
      expect((err as SupersedeDisposeError).cloneId).toBe('user-exp-1')
      expect((err as Error).message).toMatch(/network down/)
    }
  })

  it('carries the content warning when the content could not be set either', async () => {
    const { dtExposure } = recording({ id: 'user-exp-1' }, { contentFails: true, disposeThrows: true })
    const err = await executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure, cloneContent: { tags: ['x'] } }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SupersedeDisposeError)
    expect((err as SupersedeDisposeError).contentWarning).toMatch(/update refused/)
  })

  it('passes through unchanged without the options', async () => {
    const { dtExposure } = recording({ id: 'user-exp-1' }, { disposeThrows: true })
    const err = await executeSupersedeFlow({ systemExposureId: 'sys-exp-1', systemExposure: SYSTEM_EXPOSURE, elementId: 'elem-1', dtExposure }).catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(SupersedeDisposeError)
    expect((err as Error).message).toBe('network down')
  })
})
