import { describe, it, expect } from 'vitest'
import { VECTOR_SIMILARITY_FLOOR, similarityMeterLevel } from '../similarityMeter'

describe('similarityMeterLevel', () => {
  it('is anchored to the backend similarity floor, the threshold default', () => {
    expect(VECTOR_SIMILARITY_FLOOR).toBe(0.4)
    expect(similarityMeterLevel(VECTOR_SIMILARITY_FLOOR)).toBe(1)
  })

  it.each([
    [null, 0],
    [undefined, 0],
    [0.39, 0],
    [0.4, 1],
    [0.54, 1],
    [0.55, 2],
    [0.69, 2],
    [0.7, 3],
    [1, 3],
  ])('%s → %s dot(s)', (score, dots) => {
    expect(similarityMeterLevel(score as number | null | undefined)).toBe(dots)
  })
})
