import { describe, it, expect } from 'vitest'
import { unwrapAnalysisClass } from '../dt-analysis.js'

describe('unwrapAnalysisClass', () => {
  it('unwraps the class and its module relation, keeping every field', () => {
    const raw = [{ id: 'c1', name: 'Report', type: 't', module: [{ id: 'm1', name: 'report-module' }] }] as any
    expect(unwrapAnalysisClass(raw)).toEqual({ id: 'c1', name: 'Report', type: 't', module: { id: 'm1', name: 'report-module' } })
  })

  it('keeps an already single module, and a class without one', () => {
    expect(unwrapAnalysisClass({ id: 'c1', module: { id: 'm1', name: 'x' } } as any).module).toEqual({ id: 'm1', name: 'x' })
    expect(unwrapAnalysisClass([{ id: 'c1' }] as any)).toEqual({ id: 'c1' })
  })

  it('gives an empty class for an empty or missing relation', () => {
    expect(unwrapAnalysisClass([])).toEqual({ id: '' })
    expect(unwrapAnalysisClass(null)).toEqual({ id: '' })
  })
})
