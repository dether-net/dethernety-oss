import { describe, it, expect } from 'vitest'
import {
  defaultNavState,
  setView,
  gotoFilteredView,
  drillTo,
  popDrill,
  applyFilter,
  removeFilter,
  toggleFilter,
  clearFilters,
  VIEWS,
} from '../lib/reportNavigation.js'

const HIGH = { key: 'band', type: 'band', value: 'high', label: 'high' }
const MED = { key: 'band', type: 'band', value: 'medium', label: 'medium' }
const LIVE = { key: 'live', type: 'live', value: true, label: 'open only' }
const PROV_USER = { key: 'provenance', type: 'provenance', value: 'USER', label: 'source: User' }
const TYPE_COMP = { key: 'type', type: 'type', value: 'Component', label: 'type: Component' }

describe('defaultNavState', () => {
  it('lands on the Posture Summary, no drill, no filters', () => {
    expect(defaultNavState()).toEqual({ activeView: 'posture', drill: null, filters: [] })
  })
  it('the segmented-control views (coverage + reachability now lit)', () => {
    expect(VIEWS).toEqual(['posture', 'coverage', 'reachability', 'boundary', 'residual'])
  })
})

describe('setView', () => {
  it('switches view and clears drill + filters (a fresh manual tab)', () => {
    const s = { activeView: 'posture', drill: { elementId: 'c1', fromView: 'posture' }, filters: [HIGH] }
    expect(setView(s, 'boundary')).toEqual({ activeView: 'boundary', drill: null, filters: [] })
  })
  it('switches to the coverage / reachability views (now tabs)', () => {
    const s = { activeView: 'posture', drill: { elementId: 'c1', fromView: 'posture' }, filters: [HIGH] }
    expect(setView(s, 'coverage')).toEqual({ activeView: 'coverage', drill: null, filters: [] })
    expect(setView(s, 'reachability')).toEqual({ activeView: 'reachability', drill: null, filters: [] })
  })
  it('is a no-op for an unknown view (defensive)', () => {
    const s = defaultNavState()
    expect(setView(s, 'profile')).toBe(s) // the Component Profile is a drill target, not a tab
    expect(setView(s, 'bogus')).toBe(s)
  })
})

describe('gotoFilteredView (Posture Summary deep-link)', () => {
  it('sets view + a single filter, clears drill', () => {
    const s = { activeView: 'posture', drill: { elementId: 'c1', fromView: 'posture' }, filters: [] }
    expect(gotoFilteredView(s, 'residual', HIGH)).toEqual({
      activeView: 'residual',
      drill: null,
      filters: [HIGH],
    })
  })
  it('with no filter clears filters', () => {
    expect(gotoFilteredView(defaultNavState(), 'residual', null).filters).toEqual([])
  })
  it('unknown view ⇒ no-op', () => {
    const s = defaultNavState()
    expect(gotoFilteredView(s, 'profile', HIGH)).toBe(s) // the Component Profile is a drill target, not a tab
  })
})

describe('drillTo / popDrill', () => {
  it('drills into the Component Profile, recording the view to return to, preserving filters', () => {
    const s = { activeView: 'residual', drill: null, filters: [HIGH] }
    const d = drillTo(s, 'c1', 'residual')
    expect(d.drill).toEqual({ elementId: 'c1', fromView: 'residual' })
    expect(d.activeView).toBe('residual')
    expect(d.filters).toEqual([HIGH]) // untouched on the way in
  })
  it('a drill from within a drill keeps the ORIGINAL fromView (neighbour chain)', () => {
    let s = drillTo({ activeView: 'residual', drill: null, filters: [] }, 'c1', 'residual')
    s = drillTo(s, 'c2', 'profile') // neighbour → neighbour; fromView arg ignored
    expect(s.drill).toEqual({ elementId: 'c2', fromView: 'residual' })
  })
  it('defaults fromView to the active view when not given a valid one', () => {
    const s = drillTo({ activeView: 'boundary', drill: null, filters: [] }, 'b1', 'bogus')
    expect(s.drill.fromView).toBe('boundary')
  })
  it('popDrill restores the origin view + leaves filters intact', () => {
    const s = drillTo({ activeView: 'residual', drill: null, filters: [HIGH] }, 'c1', 'residual')
    const back = popDrill(s)
    expect(back).toEqual({ activeView: 'residual', drill: null, filters: [HIGH] })
  })
  it('popDrill is a no-op when not drilling', () => {
    const s = defaultNavState()
    expect(popDrill(s)).toBe(s)
  })
  it('drillTo with no elementId is a no-op', () => {
    const s = defaultNavState()
    expect(drillTo(s, '', 'posture')).toBe(s)
  })
})

describe('applyFilter / removeFilter', () => {
  it('adds a filter', () => {
    expect(applyFilter(defaultNavState(), HIGH).filters).toEqual([HIGH])
  })
  it('replaces a same-key filter (band high → band medium), not appends', () => {
    const s = applyFilter(defaultNavState(), HIGH)
    expect(applyFilter(s, MED).filters).toEqual([MED])
  })
  it('keeps distinct-key filters together', () => {
    let s = applyFilter(defaultNavState(), HIGH)
    s = applyFilter(s, LIVE)
    expect(s.filters).toHaveLength(2)
  })
  it('re-applying the identical key is idempotent in length', () => {
    let s = applyFilter(defaultNavState(), HIGH)
    s = applyFilter(s, { ...HIGH })
    expect(s.filters).toHaveLength(1)
  })
  it('removeFilter drops by key', () => {
    const s = applyFilter(defaultNavState(), HIGH)
    expect(removeFilter(s, 'band').filters).toEqual([])
  })
  it('removeFilter of an absent key is a no-op', () => {
    const s = applyFilter(defaultNavState(), HIGH)
    expect(removeFilter(s, 'live')).toBe(s)
  })
  it('applyFilter of a malformed filter (no key) is a no-op', () => {
    const s = defaultNavState()
    expect(applyFilter(s, { value: 'x' })).toBe(s)
  })
})

describe('toggleFilter (in-view facet bar)', () => {
  it('adds a facet when absent', () => {
    expect(toggleFilter(defaultNavState(), HIGH).filters).toEqual([HIGH])
  })
  it('removes the same key+value on a second click (toggle off)', () => {
    const s = toggleFilter(defaultNavState(), HIGH)
    expect(toggleFilter(s, { ...HIGH }).filters).toEqual([])
  })
  it('replaces a different value of the same key (single-select per facet)', () => {
    const s = toggleFilter(defaultNavState(), HIGH)
    expect(toggleFilter(s, MED).filters).toEqual([MED])
  })
  it('AND-combines distinct facet keys (band + provenance + type)', () => {
    let s = toggleFilter(defaultNavState(), HIGH)
    s = toggleFilter(s, PROV_USER)
    s = toggleFilter(s, TYPE_COMP)
    expect(s.filters.map((f) => f.key).sort()).toEqual(['band', 'provenance', 'type'])
  })
  it('toggling one facet off leaves the others intact', () => {
    let s = toggleFilter(defaultNavState(), HIGH)
    s = toggleFilter(s, TYPE_COMP)
    s = toggleFilter(s, { ...HIGH }) // band off
    expect(s.filters).toEqual([TYPE_COMP])
  })
  it('malformed filter (no key) is a no-op', () => {
    const s = defaultNavState()
    expect(toggleFilter(s, { value: 'x' })).toBe(s)
  })
})

describe('clearFilters', () => {
  it('drops every filter, keeping the view + drill', () => {
    let s = toggleFilter(defaultNavState(), HIGH)
    s = toggleFilter(s, TYPE_COMP)
    const c = clearFilters(s)
    expect(c.filters).toEqual([])
    expect(c.activeView).toBe(s.activeView)
  })
  it('is a no-op when there are no filters', () => {
    const s = defaultNavState()
    expect(clearFilters(s)).toBe(s)
  })
})
