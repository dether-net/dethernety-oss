import { describe, it, expect } from 'vitest'
import type { Edge, Node } from '@vue-flow/core'
import { isSettingsTabShown, resolveEditorLink, SETTINGS_TABS } from '../editorLink'

const node = (id: string, type: string, parentNode = ''): Node =>
  ({ id, type, position: { x: 0, y: 0 }, data: { label: id }, parentNode }) as Node
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target }) as Edge

const ROOT = node('root', 'BOUNDARY')
const model = () => ({
  nodes: [node('web', 'PROCESS', 'dmz'), node('db', 'STORE', 'dmz'), node('dmz', 'BOUNDARY')],
  edges: [edge('f1', 'web', 'db')],
  defaultBoundary: ROOT,
  defaultBoundaryId: 'root',
})

describe('isSettingsTabShown', () => {
  it('shows every tab but Zoning for every element', () => {
    for (const item of [node('web', 'PROCESS'), node('dmz', 'BOUNDARY'), edge('f1', 'a', 'b'), ROOT]) {
      for (const tab of SETTINGS_TABS.filter(t => t !== 'zoning')) expect(isSettingsTabShown(tab, item, 'root')).toBe(true)
    }
  })

  it('shows Zoning only for a boundary that is not the default one', () => {
    expect(isSettingsTabShown('zoning', node('dmz', 'BOUNDARY'), 'root')).toBe(true)
    expect(isSettingsTabShown('zoning', ROOT, 'root')).toBe(false)
    expect(isSettingsTabShown('zoning', node('web', 'PROCESS'), 'root')).toBe(false)
    expect(isSettingsTabShown('zoning', edge('f1', 'a', 'b'), 'root')).toBe(false)
    expect(isSettingsTabShown('zoning', null, 'root')).toBe(false)
  })
})

describe('resolveEditorLink', () => {
  it('finds a component and frames it', () => {
    expect(resolveEditorLink({ element: 'web' }, model())).toMatchObject({ kind: 'node', focusNodeIds: ['web'], tab: null })
    expect(resolveEditorLink({ element: 'web' }, model())?.item.id).toBe('web')
  })

  it('finds a boundary', () => {
    expect(resolveEditorLink({ element: 'dmz' }, model())).toMatchObject({ kind: 'node', focusNodeIds: ['dmz'] })
  })

  it('finds a data flow and frames its two endpoints', () => {
    expect(resolveEditorLink({ element: 'f1' }, model())).toMatchObject({ kind: 'edge', focusNodeIds: ['web', 'db'] })
  })

  it('finds the default boundary through the loaded model’s id, with nothing extra to frame', () => {
    expect(resolveEditorLink({ element: 'root' }, model())).toMatchObject({ kind: 'default-boundary', focusNodeIds: [] })
  })

  it('never selects a root boundary left over from an earlier model', () => {
    // a failed load clears defaultBoundaryId but leaves the last root object in the store
    expect(resolveEditorLink({ element: 'root' }, { ...model(), defaultBoundaryId: '' })).toBeNull()
    expect(resolveEditorLink({ element: 'root' }, { ...model(), defaultBoundaryId: undefined })).toBeNull()
    expect(resolveEditorLink({ element: 'root' }, { ...model(), defaultBoundaryId: 'other-root' })).toBeNull()
  })

  it('keeps each of the six tabs the element shows', () => {
    for (const tab of SETTINGS_TABS) {
      expect(resolveEditorLink({ element: 'dmz', tab }, model())?.tab).toBe(tab)
      expect(resolveEditorLink({ element: 'web', tab }, model())?.tab).toBe(tab === 'zoning' ? null : tab)
    }
  })

  it('drops an unknown tab, and a tab the element does not show: the link then only selects', () => {
    expect(resolveEditorLink({ element: 'web', tab: 'history' }, model())).toMatchObject({ kind: 'node', tab: null })
    expect(resolveEditorLink({ element: 'web', tab: 'zoning' }, model())).toMatchObject({ kind: 'node', tab: null })
    expect(resolveEditorLink({ element: 'f1', tab: 'zoning' }, model())).toMatchObject({ kind: 'edge', tab: null })
    expect(resolveEditorLink({ element: 'root', tab: 'zoning' }, model())).toMatchObject({ kind: 'default-boundary', tab: null })
    expect(resolveEditorLink({ element: 'web', tab: 'General' }, model())?.tab).toBeNull()
  })

  it('resolves nothing for an id that is not in the loaded model', () => {
    for (const element of ['other-model-element', 'a-data-item', '', 'WEB', ' web']) {
      expect(resolveEditorLink({ element, tab: 'general' }, model())).toBeNull()
    }
    expect(resolveEditorLink({}, model())).toBeNull()
    expect(resolveEditorLink({ element: 'web' }, { nodes: [], edges: [], defaultBoundary: null, defaultBoundaryId: undefined })).toBeNull()
  })

  it('takes only one plain string per parameter', () => {
    expect(resolveEditorLink({ element: ['web', 'db'] }, model())).toBeNull()
    expect(resolveEditorLink({ element: null }, model())).toBeNull()
    expect(resolveEditorLink({ element: 42 }, model())).toBeNull()
    expect(resolveEditorLink({ element: 'web', tab: ['exposures'] }, model())?.tab).toBeNull()
    expect(resolveEditorLink({ element: 'web', tab: null }, model())?.tab).toBeNull()
  })

  it('treats hostile strings as plain ids that match nothing', () => {
    for (const element of ['"><img src=x onerror=alert(1)>', '__proto__', 'constructor', 'toString', '../../etc']) {
      expect(() => resolveEditorLink({ element, tab: '__proto__' }, model())).not.toThrow()
      expect(resolveEditorLink({ element, tab: '__proto__' }, model())).toBeNull()
    }
    for (const tab of ['__proto__', 'constructor', 'toString']) {
      expect(resolveEditorLink({ element: 'web', tab }, model())?.tab).toBeNull()
    }
  })
})
