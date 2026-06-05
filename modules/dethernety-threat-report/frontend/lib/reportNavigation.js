// frontend/lib/reportNavigation.js — the in-component navigation reducer.
//
// The report is a single mounted component, NOT a router: Posture Summary,
// Boundary Crossings, and Residual Risk are views of one SPA reached by a
// segmented control, and Component Profile is a drill TARGET overlaid on the
// active view. Navigation/filter state is module-local and surfaced as removable
// breadcrumb chips so a drill never silently hides scope.
//
// These are PURE state transitions (no Vue, no network) — unit-tested with
// fixtures. The shell holds the state in a `reactive()` and calls these to
// transition; same split as deriveLifecycle (pure) + useThreatReportState
// (reactive holder).

// The view set. Coverage & Gaps (the MITRE coverage matrix) consumes the shared
// coverage module. Reachability (the flow-route / crown-jewel reachability
// engine) is computed client-side over the snapshot — no separate fetch.
// 'profile' (Component Profile) is a drill target, not a segmented-control view.
export const VIEWS = ['posture', 'coverage', 'reachability', 'boundary', 'residual']

export const VIEW_LABELS = {
  posture: 'Posture',
  coverage: 'Coverage & Gaps',
  reachability: 'Reachability',
  boundary: 'Boundary Crossings',
  residual: 'Residual Risk',
  profile: 'Component Profile',
}

const isView = (v) => VIEWS.includes(v)

/** Initial state: lands on Posture Summary (the default view), no drill, no
 *  filters. */
export function defaultNavState() {
  return { activeView: 'posture', drill: null, filters: [] }
}

/**
 * Switch to a segmented-control view (a manual tab click). A fresh view: clears
 * any active drill AND any filters — a manual tab switch is an unfiltered view,
 * never carrying a prior view's filter chip silently. Unknown view ⇒ no-op
 * (defensive). The deep-link path (a Posture Summary stat → a filtered view)
 * uses `gotoFilteredView` instead, so the two never conflict.
 */
export function setView(state, view) {
  if (!isView(view)) return state
  return { ...state, activeView: view, drill: null, filters: [] }
}

/**
 * Deep-link from a Posture Summary stat to a view WITH a single filter chip
 * applied (e.g. a HIGH-band tile → Residual Risk filtered to high). At most one
 * filter is carried, so this replaces the filter set wholesale. Clears any
 * drill. Unknown view ⇒ no-op.
 * @param {object} filter { key, type:'band'|'live', value, label }
 */
export function gotoFilteredView(state, view, filter) {
  if (!isView(view)) return state
  return { ...state, activeView: view, drill: null, filters: filter ? [filter] : [] }
}

/**
 * Drill into Component Profile for an element, overlaying the active view. The
 * underlying view (and its filters) are preserved so popDrill returns to exactly
 * where the drill began. A drill FROM within a drill (a profile neighbour →
 * another profile) keeps the ORIGINAL fromView, so the breadcrumb's back step
 * returns to the list view, not to an intermediate profile.
 */
export function drillTo(state, elementId, fromView) {
  if (!elementId) return state
  const returnView = state.drill
    ? state.drill.fromView
    : isView(fromView)
      ? fromView
      : state.activeView
  return { ...state, drill: { elementId, fromView: returnView } }
}

/** Leave Component Profile, restoring the view the drill began from (and its
 *  filters, untouched on the way in). No-op when not drilling. */
export function popDrill(state) {
  if (!state.drill) return state
  return { ...state, activeView: state.drill.fromView, drill: null }
}

/** Add/replace a filter chip, deduped by `key` (so re-applying the same band is
 *  idempotent, and a new value of the same key replaces the old one). */
export function applyFilter(state, filter) {
  if (!filter || !filter.key) return state
  const others = state.filters.filter((f) => f.key !== filter.key)
  return { ...state, filters: [...others, filter] }
}

/** Remove a filter chip by key (the breadcrumb chip ✕). */
export function removeFilter(state, key) {
  if (!state.filters.some((f) => f.key === key)) return state
  return { ...state, filters: state.filters.filter((f) => f.key !== key) }
}

/**
 * Toggle a facet filter (the in-view Residual Risk filter bar). Single-select PER
 * KEY: a second click on the SAME key+value removes it (toggle off); a different
 * value of the same key replaces it; different keys accumulate (AND-combined).
 * Keeps the one filter model shared with the Posture Summary deep-link + the
 * removable breadcrumb chips.
 * @param {object} filter { key, type, value, label }
 */
export function toggleFilter(state, filter) {
  if (!filter || !filter.key) return state
  const existing = state.filters.find((f) => f.key === filter.key)
  if (existing && existing.value === filter.value) {
    // same facet clicked again → toggle it off
    return { ...state, filters: state.filters.filter((f) => f.key !== filter.key) }
  }
  // new value for this key (replace) or a brand-new key (add)
  const others = state.filters.filter((f) => f.key !== filter.key)
  return { ...state, filters: [...others, filter] }
}

/** Clear every filter chip (the in-view "clear" affordance), keeping the view. */
export function clearFilters(state) {
  if (!state.filters.length) return state
  return { ...state, filters: [] }
}
