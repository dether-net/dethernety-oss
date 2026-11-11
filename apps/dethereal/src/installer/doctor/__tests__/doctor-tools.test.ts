/**
 * The doctor's tool check: a server lists the whole manifest, or, with the settlement off, exactly the manifest
 * without the settlement's tools. Any other list fails.
 */
import { describe, it, expect } from 'vitest'
import { probeChecks } from '../index.js'
import { manifestToolNames } from '../../../tools/manifest.js'
import { shippedToolNames } from '../../../utils/settlement-switch.js'

const toolsCheck = (tools: string[]) =>
  probeChecks('claude (user)', { started: true, tools }, manifestToolNames()).find((c) => c.label === 'tools')

describe('the doctor\'s tool check', () => {
  it('accepts the whole manifest', () => {
    expect(toolsCheck([...manifestToolNames()].reverse())).toMatchObject({ status: 'ok' })
  })

  it('accepts the manifest without the settlement\'s tools, as a server with the settlement off lists it', () => {
    expect(shippedToolNames().length).toBeLessThan(manifestToolNames().length)
    expect(toolsCheck(shippedToolNames())).toMatchObject({ status: 'ok' })
  })

  it('fails any other subset, and a list with a tool too many', () => {
    expect(toolsCheck(shippedToolNames().filter((t) => t !== 'model_state_prune'))).toMatchObject({ status: 'fail' })
    expect(toolsCheck(manifestToolNames().filter((t) => t !== 'model_state_prune'))).toMatchObject({ status: 'fail' })
    expect(toolsCheck([...manifestToolNames(), 'extra_tool'])).toMatchObject({ status: 'fail' })
  })
})
