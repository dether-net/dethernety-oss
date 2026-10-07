/**
 * MITRE links with their edge justification, on the create and read paths of
 * DtCountermeasure and DtExposure.
 *
 * Stubs `dtUtils.performQuery` / `performMutation` to capture the shapes sent and
 * inject responses. What those shapes do to a real graph is asserted by the dt-ws
 * integration spec mitre-technique-links.e2e-spec.ts; change one, revisit the other.
 */

import { describe, it, expect, vi } from 'vitest'
import * as Apollo from '@apollo/client'

import { DtCountermeasure } from '../dt-countermeasure.js'
import { DtExposure } from '../../dt-exposure/dt-exposure.js'
import { COUNTERMEASURE_TECHNIQUE_LINK_FIELDS } from '../../interfaces/core-types-interface.js'
import type { Countermeasure, Exposure } from '../../interfaces/core-types-interface.js'

function harness<T extends object>(instance: T) {
  const performMutation = vi.fn().mockResolvedValue({ id: 'new' })
  const performQuery = vi.fn()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(instance as any).dtUtils.performMutation = performMutation
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(instance as any).dtUtils.performQuery = performQuery
  return { performMutation, performQuery }
}

const CM: Countermeasure = {
  id: '',
  name: 'MFA',
  description: 'd',
  type: 't',
  category: 'c',
  score: 1,
  references: '',
  addressedExposures: [],
  tags: [],
  mitigations: [{ id: 'mit-own', name: '', description: '', attack_id: 'M1032' }],
}

const connection = (...edges: Array<[string, string | null]>) => ({
  edges: edges.map(([id, justification]) => ({ node: { id }, properties: { justification } })),
})

describe('DtCountermeasure technique links', () => {
  it('sends each link as a connect with its justification on the edge, and none for a bare link', async () => {
    const dt = new DtCountermeasure({} as Apollo.ApolloClient)
    const { performMutation } = harness(dt)

    await dt.createCountermeasure({
      controlId: 'ctl-1',
      countermeasure: CM,
      techniqueLinks: {
        evicts: [{ id: 'tech-1', justification: 'kills the session' }],
        respondsTo: [{ id: 'tech-2', justification: null }],
      },
    })

    const input = performMutation.mock.calls[0][0].variables.input[0]
    expect(input.evicts).toEqual({
      connect: [{ where: { node: { id: { eq: 'tech-1' } } }, edge: { justification: 'kills the session' } }],
    })
    expect(input.respondsTo).toEqual({ connect: [{ where: { node: { id: { eq: 'tech-2' } } } }] })
    // A field not given in techniqueLinks keeps the countermeasure's own list.
    expect(input.mitigations).toEqual({ connect: [{ where: { node: { id: { eq: 'mit-own' } } } }] })
    expect(input).not.toHaveProperty('defendedTechniques')
    expect(input.control).toEqual({ connect: { where: { node: { id: { eq: 'ctl-1' } } } } })
  })

  it('lets a field in techniqueLinks replace the countermeasure list for that field', async () => {
    const dt = new DtCountermeasure({} as Apollo.ApolloClient)
    const { performMutation } = harness(dt)

    await dt.createCountermeasure({
      controlId: 'ctl-1',
      countermeasure: CM,
      techniqueLinks: { mitigations: [{ id: 'mit-src', justification: 'j' }] },
    })

    expect(performMutation.mock.calls[0][0].variables.input[0].mitigations).toEqual({
      connect: [{ where: { node: { id: { eq: 'mit-src' } } }, edge: { justification: 'j' } }],
    })
  })

  it('reads every link field with its justification', async () => {
    const dt = new DtCountermeasure({} as Apollo.ApolloClient)
    const { performQuery } = harness(dt)
    const row = Object.fromEntries(
      COUNTERMEASURE_TECHNIQUE_LINK_FIELDS.map(field => [`${field}Connection`, connection([`${field}-1`, 'why'], [`${field}-2`, null])]),
    )
    performQuery.mockResolvedValueOnce({ countermeasures: [row] })

    const links = await dt.getCountermeasureTechniqueLinks({ countermeasureId: 'cm-1' })

    expect(performQuery.mock.calls[0][0].variables).toEqual({ countermeasureId: 'cm-1' })
    expect(Object.keys(links!)).toEqual([...COUNTERMEASURE_TECHNIQUE_LINK_FIELDS])
    expect(links!.restores).toEqual([
      { id: 'restores-1', justification: 'why' },
      { id: 'restores-2', justification: null },
    ])
  })

  it('returns null for a countermeasure that does not exist', async () => {
    const dt = new DtCountermeasure({} as Apollo.ApolloClient)
    const { performQuery } = harness(dt)
    performQuery.mockResolvedValueOnce({ countermeasures: [] })

    expect(await dt.getCountermeasureTechniqueLinks({ countermeasureId: 'gone' })).toBeNull()
  })
})

describe('DtExposure technique links', () => {
  const EXPOSURE: Exposure = { id: '', name: 'e', description: 'd', category: 'c', score: 1 } as Exposure

  it('sends attackTechniqueLinks with their justification in place of attackTechniqueIds', async () => {
    const dt = new DtExposure({} as Apollo.ApolloClient)
    const { performMutation } = harness(dt)

    await dt.createExposure({
      exposure: EXPOSURE,
      elementId: 'el-1',
      attackTechniqueIds: ['ignored'],
      attackTechniqueLinks: [{ id: 'tech-1', justification: 'j' }, { id: 'tech-2' }],
    })

    expect(performMutation.mock.calls[0][0].variables.input.exploitedBy).toEqual({
      connect: [
        { where: { node: { id: { eq: 'tech-1' } } }, edge: { justification: 'j' } },
        { where: { node: { id: { eq: 'tech-2' } } } },
      ],
    })
  })

  it('still connects attackTechniqueIds when no links are given', async () => {
    const dt = new DtExposure({} as Apollo.ApolloClient)
    const { performMutation } = harness(dt)

    await dt.createExposure({ exposure: EXPOSURE, elementId: 'el-1', attackTechniqueIds: ['tech-1'] })

    expect(performMutation.mock.calls[0][0].variables.input.exploitedBy).toEqual({
      connect: [{ where: { node: { id: { eq: 'tech-1' } } } }],
    })
  })

  it('reads the exploitedBy and exploitedByAtlas links with their justification', async () => {
    const dt = new DtExposure({} as Apollo.ApolloClient)
    const { performQuery } = harness(dt)
    performQuery.mockResolvedValueOnce({
      exposures: [{ exploitedByConnection: connection(['tech-1', 'j']), exploitedByAtlasConnection: connection(['atlas-1', null]) }],
    })

    expect(await dt.getExposureTechniqueLinks({ exposureId: 'exp-1' })).toEqual({
      exploitedBy: [{ id: 'tech-1', justification: 'j' }],
      exploitedByAtlas: [{ id: 'atlas-1', justification: null }],
    })
  })

  it('sends atlasTechniqueLinks as exploitedByAtlas connects, and omits the field without them', async () => {
    const dt = new DtExposure({} as Apollo.ApolloClient)
    const { performMutation } = harness(dt)

    await dt.createExposure({
      exposure: EXPOSURE, elementId: 'el-1', attackTechniqueIds: [],
      atlasTechniqueLinks: [{ id: 'atlas-1', justification: 'j' }],
    })
    await dt.createExposure({ exposure: EXPOSURE, elementId: 'el-1', attackTechniqueIds: [] })

    expect(performMutation.mock.calls[0][0].variables.input.exploitedByAtlas).toEqual({
      connect: [{ where: { node: { id: { eq: 'atlas-1' } } }, edge: { justification: 'j' } }],
    })
    expect(performMutation.mock.calls[1][0].variables.input).not.toHaveProperty('exploitedByAtlas')
  })
})

describe('update flows write only the links that changed', () => {
  const where = (id: string) => ({ where: { node: { id: { eq: id } } } })

  it('updateExposure disconnects removed ids, connects added ids, and leaves kept links alone', async () => {
    const dt = new DtExposure({} as Apollo.ApolloClient)
    const { performMutation, performQuery } = harness(dt)
    performQuery.mockResolvedValueOnce({
      exposures: [{
        exploitedByConnection: connection(['tech-kept', 'module reason'], ['tech-gone', null]),
        exploitedByAtlasConnection: connection(['atlas-kept', 'why']),
      }],
    })

    await dt.updateExposure({
      exposureId: 'exp-1',
      exposure: { id: 'exp-1', name: 'e' } as Exposure,
      attackTechniqueIds: ['tech-kept', 'tech-new'],
    })

    const input = performMutation.mock.calls[0][0].variables.input
    expect(input.exploitedBy).toEqual({ connect: [where('tech-new')], disconnect: [where('tech-gone')] })
    // atlasTechniqueIds not given: the ATLAS links are not written at all.
    expect(input).not.toHaveProperty('exploitedByAtlas')
  })

  it('updateExposure writes nothing for an unchanged list, and diffs atlasTechniqueIds when given', async () => {
    const dt = new DtExposure({} as Apollo.ApolloClient)
    const { performMutation, performQuery } = harness(dt)
    performQuery.mockResolvedValueOnce({
      exposures: [{ exploitedByConnection: connection(['tech-1', 'j']), exploitedByAtlasConnection: connection(['atlas-1', 'j']) }],
    })

    await dt.updateExposure({
      exposureId: 'exp-1',
      exposure: { id: 'exp-1', name: 'e' } as Exposure,
      attackTechniqueIds: ['tech-1'],
      atlasTechniqueIds: [],
    })

    const input = performMutation.mock.calls[0][0].variables.input
    expect(input).not.toHaveProperty('exploitedBy')
    expect(input.exploitedByAtlas).toEqual({ disconnect: [where('atlas-1')] })
  })

  it('updateCountermeasure diffs mitigations, defendedTechniques and mitigationsAtlas; an absent list is untouched', async () => {
    const dt = new DtCountermeasure({} as Apollo.ApolloClient)
    const { performMutation, performQuery } = harness(dt)
    const row = Object.fromEntries(COUNTERMEASURE_TECHNIQUE_LINK_FIELDS.map(field => [`${field}Connection`, connection()]))
    row.mitigationsConnection = connection(['mit-kept', 'policy reason'], ['mit-gone', null])
    row.defendedTechniquesConnection = connection(['def-1', null])
    row.mitigationsAtlasConnection = connection(['atlasm-1', 'why'])
    performQuery.mockResolvedValueOnce({ countermeasures: [row] })

    await dt.updateCountermeasure({
      countermeasureId: 'cm-1',
      countermeasure: { ...CM, mitigations: [{ id: 'mit-kept' }, { id: 'mit-new' }] as any, defendedTechniques: undefined },
    })

    const input = performMutation.mock.calls[0][0].variables.input
    expect(input.mitigations).toEqual({ connect: [where('mit-new')], disconnect: [where('mit-gone')] })
    expect(input).not.toHaveProperty('defendedTechniques')
    expect(input).not.toHaveProperty('mitigationsAtlas')
    expect(input.name).toEqual({ set: 'MFA' })
  })

  it('concurrent updateCountermeasure calls on one countermeasure connect a new link once', async () => {
    const dt = new DtCountermeasure({} as Apollo.ApolloClient)
    const { performMutation, performQuery } = harness(dt)
    // A tiny graph: the read returns the current links, the write applies the delta after a tick.
    const linked = new Set<string>()
    performQuery.mockImplementation(async () => ({
      countermeasures: [{ mitigationsConnection: connection(...[...linked].map(id => [id, null] as [string, null])) }],
    }))
    performMutation.mockImplementation(async ({ variables }: any) => {
      await new Promise(resolve => setTimeout(resolve, 5))
      for (const c of variables.input.mitigations?.connect ?? []) linked.add(c.where.node.id.eq)
      return { id: 'cm-1' }
    })
    const save = (name: string) =>
      dt.updateCountermeasure({ countermeasureId: 'cm-1', countermeasure: { ...CM, name, mitigations: [{ id: 'mit-new' }] as any } })

    await Promise.all([save('first'), save('second')])

    const connects = performMutation.mock.calls.flatMap(([arg]: any) => arg.variables.input.mitigations?.connect ?? [])
    expect(connects).toEqual([where('mit-new')])
  })

  it('updateCountermeasure reads only the link fields it writes', async () => {
    const dt = new DtCountermeasure({} as Apollo.ApolloClient)
    const { performQuery } = harness(dt)
    performQuery.mockResolvedValueOnce({ countermeasures: [{}] })

    await dt.updateCountermeasure({ countermeasureId: 'cm-1', countermeasure: { ...CM, mitigations: [] } })

    const body = performQuery.mock.calls[0][0].query.loc.source.body as string
    const selected = [...body.matchAll(/(\w+)Connection/g)].map(m => m[1]).sort()
    expect(selected).toEqual(['defendedTechniques', 'mitigations', 'mitigationsAtlas'])
  })

  it('updateCountermeasure fails before writing when the countermeasure is gone', async () => {
    const dt = new DtCountermeasure({} as Apollo.ApolloClient)
    const { performMutation, performQuery } = harness(dt)
    performQuery.mockResolvedValueOnce({ countermeasures: [] })

    await expect(dt.updateCountermeasure({ countermeasureId: 'gone', countermeasure: CM })).rejects.toThrow(/not found/)
    expect(performMutation).not.toHaveBeenCalled()
  })
})
