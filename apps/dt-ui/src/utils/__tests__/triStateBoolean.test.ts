/**
 * The three-state boolean control: Yes, No and Not answered. A stored true or false shows as Yes or No and anything
 * else as Not answered; choosing Not answered stores nothing, so the answer can be taken back. It outranks the
 * stock checkbox and toggle renderers for every boolean control, and no other control.
 */
import { describe, expect, it } from 'vitest'
import { and, isBooleanControl, optionIs, rankWith } from '@jsonforms/core'
import { triStateBooleanTester, triStateOf, valueOfTriState } from '../triStateBoolean'

const ctx = { rootSchema: {}, config: {} } as any
const control = (type: string, options?: object) => ({ type: 'Control', scope: '#/properties/x', ...(options ? { options } : {}) })
const schema = (type: string) => ({ type: 'object', properties: { x: { type } } })

describe('the three-state boolean control', () => {
  it('shows a stored true as Yes, false as No, and anything else as Not answered', () => {
    expect([true, false, undefined, null, 'true'].map(triStateOf)).toEqual(['yes', 'no', 'unanswered', 'unanswered', 'unanswered'])
  })

  it('stores Yes as true, No as false, and nothing for Not answered or no choice', () => {
    expect(['yes', 'no', 'unanswered', undefined].map(valueOfTriState)).toEqual([true, false, undefined, undefined])
  })

  it('outranks the stock checkbox (1) and toggle (3) for a boolean control, and leaves other controls alone', () => {
    const stockToggle = rankWith(3, and(isBooleanControl, optionIs('toggle', true)))
    expect(triStateBooleanTester(control('boolean') as any, schema('boolean') as any, ctx)).toBe(4)
    expect(triStateBooleanTester(control('boolean', { toggle: true }) as any, schema('boolean') as any, ctx)).toBeGreaterThan(stockToggle(control('boolean', { toggle: true }) as any, schema('boolean') as any, ctx))
    expect(triStateBooleanTester(control('string') as any, schema('string') as any, ctx)).toBe(-1)
  })
})
