import { describe, it, expect } from 'vitest'
import type { ContentIndex, Folder } from '@dethernety/dt-core'
import { pathText, searchContent } from '../browserSearch'

const folder = (id: string, name: string, parent?: string): Folder =>
  ({ id, name, parentFolder: parent ? { id: parent } : undefined })
const folders = [folder('pay', 'Payments'), folder('pci', 'PCI scope', 'pay'), folder('ops', 'Ops')]

const index: ContentIndex = {
  models: [
    { id: 'm-shop', name: 'Shop', folderId: 'pay' },
    { id: 'm-card', name: 'Card vault', folderId: 'pci' },
    { id: 'm-root', name: 'Web shop', folderId: undefined },
    { id: 'm-blank', name: '' },
  ],
  controls: [
    { id: 'c-shop', name: 'Shop', folderId: 'ops' },
    { id: 'c-waf', name: 'Café WAF', folderId: 'pci' },
  ],
}
const ids = (q: string) => searchContent(q, index, folders).map(r => r.id)

describe('searchContent', () => {
  it('finds nothing for an empty or blank query', () => {
    expect(searchContent('', index, folders)).toEqual([])
    expect(searchContent('  ', index, folders)).toEqual([])
  })

  it('searches every folder, ranks as the canvas search does, and puts models before controls in a tie', () => {
    // "shop": Shop (whole name: the model, then the control), Web shop (a word's start)
    expect(ids('shop')).toEqual(['m-shop', 'c-shop', 'm-root'])
  })

  it('ignores case and accents', () => {
    expect(ids('CAFE')).toEqual(['c-waf'])
  })

  it('reports each result\'s kind, folder and path from Home', () => {
    expect(searchContent('card', index, folders)).toEqual([
      { id: 'm-card', kind: 'model', name: 'Card vault', folderId: 'pci', path: ['Home', 'Payments', 'PCI scope'] },
    ])
    expect(searchContent('web', index, folders)[0]).toMatchObject({ folderId: undefined, path: ['Home'] })
    expect(searchContent('waf', index, folders)[0]).toMatchObject({ kind: 'control', path: ['Home', 'Payments', 'PCI scope'] })
  })

  it('ends the path at a folder it does not know, and stops at a parent cycle', () => {
    const odd = [folder('a', 'A', 'b'), folder('b', 'B', 'a')]
    const idx: ContentIndex = { models: [{ id: 'x', name: 'X', folderId: 'a' }, { id: 'y', name: 'Y', folderId: 'gone' }], controls: [] }
    expect(searchContent('x', idx, odd)[0].path).toEqual(['Home', 'B', 'A'])
    expect(searchContent('y', idx, odd)[0].path).toEqual(['Home'])
  })
})

describe('pathText', () => {
  it('writes a path of up to four names in full', () => {
    expect(pathText(['Home', 'A', 'B', 'C'])).toBe('Home / A / B / C')
  })

  it('shortens a deeper one as the header trail does, unless asked for all of it', () => {
    const deep = ['Home', 'A', 'B', 'C', 'D']
    expect(pathText(deep)).toBe('Home / … / C / D')
    expect(pathText(deep, true)).toBe('Home / A / B / C / D')
  })
})
