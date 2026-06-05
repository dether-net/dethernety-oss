// frontend/lib/reportNavigation.js — the in-component navigation reducer.
//
// The report is a single mounted component, NOT a router (tech §2.1): ⑤③④ are
// views of one SPA reached by a segmented control, ⑥ is a drill TARGET overlaid
// on the active view. Navigation/filter state is module-local and surfaced as
// removable breadcrumb chips so a drill never silently hides scope (ux §2.1).
//
// These are PURE state transitions (no Vue, no network) — unit-tested with
// fixtures. The shell holds the state in a `reactive()` and calls these to
// transition; same split as deriveLifecycle (pure) + useThreatReportState
// (reactive holder).

// The view set. ① coverage (the MITRE Coverage & Gaps matrix) consumes the shared
// coverage module. ② reachability is still pending — deliberately absent from this
// list (no dead "coming soon" tabs); 'profile' (⑥) is a drill target, not a
// segmented-control view.
export const VIEWS = ['posture', 'coverage', 'boundary', 'residual']

export const VIEW_LABELS = {
  posture: 'Posture',
  coverage: 'Coverage & Gaps',
  boundary: 'Boundary Crossings',
  residual: 'Residual Risk',
  profile: 'Component Profile',
}

const isView = (v) => VIEWS.includes(v)

/** Initial state: lands on ⑤ Posture Summary (the default view, tech §3), no
 *  drill, no filters. */
export function defaultNavState() {
  return { activeView: 'posture', drill: null, filters: [] }
}

/**
 * Switch to a segmented-control view (a manual tab click). A fresh view: clears
 * any active drill AND any filters — a manual tab switch is an unfiltered view,
 * never carrying a prior view's filter chip silently. Unknown view ⇒ no-op
 * (defensive). The deep-link path (a ⑤ stat → a filtered view) uses
 * `gotoFilteredView` instead, so the two never conflict.
 */
export function setView(state, view) {
  if (!isView(view)) return state
  return { ...state, activeView: view, drill: null, filters: [] }
}

/**
 * Deep-link from a ⑤ stat to a view WITH a single filter chip applied (e.g. a
 * HIGH-band tile → ④ filtered to high). P1 carries at most one filter, so this
 * replaces the filter set wholesale. Clears any drill. Unknown view ⇒ no-op.
 * @param {object} filter { key, type:'band'|'live', value, label }
 */
export function gotoFilteredView(state, view, filter) {
  if (!isView(view)) return state
  return { ...state, activeView: view, drill: null, filters: filter ? [filter] : [] }
}

/**
 * Drill into ⑥ for an element, overlaying the active view. The underlying view
 * (and its filters) are preserved so popDrill returns to exactly where the drill
 * began. A drill FROM within a drill (a ⑥ neighbour → another ⑥) keeps the
 * ORIGINAL fromView, so the breadcrumb's back step returns to the list view, not
 * to an intermediate profile.
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

/** Leave ⑥, restoring the view the drill began from (and its filters, untouched
 *  on the way in). No-op when not drilling. */
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
