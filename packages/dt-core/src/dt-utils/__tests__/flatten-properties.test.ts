/**
 * The keys flattenProperties writes for answers with groups, lists, lists of groups and lists of lists. The fixture is
 * shared: the platform's attribute save checks the same keys are in their plain form, so a change to what is written
 * here fails both.
 */

import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

import { DtUtils } from '../dt-utils.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/flattened-answers.json', import.meta.url), 'utf8'))

describe('DtUtils.flattenProperties', () => {
  it('writes the fixture keys, and they rebuild to the same answers', () => {
    expect(DtUtils.flattenProperties(fixture.answers)).toEqual(fixture.flat)
    expect(DtUtils.unflattenProperties(fixture.flat)).toEqual(fixture.answers)
  })
})
