import { describe, it, expect } from 'vitest'
import type { Folder } from '@dethernety/dt-core'
import { collapseTrail, folderAncestors } from '../breadcrumbs'

const folder = (id: string, name: string, parent?: string): Folder =>
  ({ id, name, parentFolder: parent ? { id: parent } : undefined })
const names = (trail: Folder[]) => trail.map(f => f.name)

describe('folderAncestors', () => {
  const folders = [folder('a', 'A'), folder('b', 'B', 'a'), folder('c', 'C', 'b')]

  it('lists the folders from the top down to the given one', () => {
    expect(names(folderAncestors('c', folders))).toEqual(['A', 'B', 'C'])
  })

  it('is empty at the root', () => {
    expect(folderAncestors(undefined, folders)).toEqual([])
  })

  it('ends at a folder it does not know, and stops at a parent cycle', () => {
    expect(folderAncestors('gone', folders)).toEqual([])
    expect(names(folderAncestors('c', [folder('c', 'C', 'missing')]))).toEqual(['C'])
    expect(names(folderAncestors('x', [folder('x', 'X', 'y'), folder('y', 'Y', 'x')]))).toEqual(['Y', 'X'])
  })
})

describe('collapseTrail', () => {
  it('keeps a trail of up to four crumbs as it is', () => {
    expect(collapseTrail(['H', 'a', 'b', 'c'])).toEqual({ shown: ['H', 'a', 'b', 'c'], hidden: [] })
  })

  it('shows Home, an ellipsis and the last two of a longer trail, and hides the rest', () => {
    expect(collapseTrail(['H', 'a', 'b', 'c', 'd'])).toEqual({ shown: ['H', null, 'c', 'd'], hidden: ['a', 'b'] })
  })
})
