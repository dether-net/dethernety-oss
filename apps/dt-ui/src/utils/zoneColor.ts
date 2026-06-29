import type { Zone, Plane } from '@dethernety/dt-core'
import type { EffectiveZone } from './effectiveZone'

// Canonical display order: internal tiers by exposure depth (outermost first), then the externals.
export const ZONE_ORDER: Zone[] = ['PUBLIC', 'EXPOSED', 'INTERNAL', 'RESTRICTED', 'UNTRUSTED', 'VENDOR']

// Diagram-pill SHORT word. The pill ALWAYS shows the word — colour is reinforcement only
// (the issueSeverity.ts lesson: never colour alone), so it stays colourblind-safe by construction.
export const ZONE_PILL_WORD: Record<Zone, string> = {
  PUBLIC: 'Public',
  EXPOSED: 'DMZ',
  INTERNAL: 'Internal',
  RESTRICTED: 'Restricted',
  UNTRUSTED: 'Untrusted',
  VENDOR: 'Vendor',
}

// Full select label — the plain-language name shown in the Zoning tab's zone dropdown and the
// pill tooltip. Defined here so the label source is one file.
export const ZONE_LABEL: Record<Zone, string> = {
  PUBLIC: 'Internet-facing',
  EXPOSED: 'Behind the front door (DMZ)',
  INTERNAL: 'Internal',
  RESTRICTED: 'Restricted',
  UNTRUSTED: 'Open internet',
  VENDOR: 'Trusted external',
}

// A violet→teal *exposure* ramp for the internal tiers, externals pulled out of the ramp. Deliberately
// uses NO green ("done") and reserves red/deep-orange/amber for severity. Vuetify 3.x
// resolves these Material tokens both as `<v-chip :color>` and `bg-<token>` utility classes.
export const ZONE_COLOR: Record<Zone, string> = {
  PUBLIC: 'deep-purple-lighten-1', // most exposed — warm-cool, not red/orange
  EXPOSED: 'indigo', // one step in
  INTERNAL: 'teal-darken-1', // the calm middle
  RESTRICTED: 'teal-darken-4', // deepest = darkest (depth inward)
  UNTRUSTED: 'blue-grey-darken-3', // "outside" — neutral, not alarm-red
  VENDOR: 'cyan-darken-2', // external-but-trusted, distinct
}

/**
 * The diagram-pill display decision (pure, so BoundaryNode stays a thin consumer):
 * - `default` (no zone declared anywhere in the chain) → **null**: render nothing, rather than clutter
 *   every untouched boundary with an "Internal" pill. The ghosted default is a tab convenience only.
 * - `declared` → solid pill.
 * - `inherited` → dimmed pill (the consumer applies the opacity).
 */
export function zonePill(
  ez: EffectiveZone | null | undefined,
): { word: string; color: string; inherited: boolean } | null {
  if (!ez || ez.source === 'default') return null
  return { word: ZONE_PILL_WORD[ez.zone], color: ZONE_COLOR[ez.zone], inherited: ez.source === 'inherited' }
}

// Per-option "reachable by" hint — the biggest no-docs lever. Also reused as the under-field
// consequence line in the Zoning tab. Concrete occupants in `restricted` (the internal-vs-restricted stumble).
export const ZONE_HINT: Record<Zone, string> = {
  PUBLIC: 'Reachable directly from the internet',
  EXPOSED: 'Reachable only through a public edge',
  INTERNAL: 'Reachable only from trusted zones — no untrusted ingress',
  RESTRICTED: 'CDE, secrets, domain controllers, regulated-data stores',
  UNTRUSTED: 'Anonymous, hostile — the open internet',
  VENDOR: 'Vetted vendor / partner',
}

// Role (`plane`) is a 4-state v-select: `undecided` ≠ `workload` (haven't-looked vs
// affirmatively-just-workload), so a blank `planes` array is its own option. Pure ↔ mapping keeps the
// Zoning tab a thin consumer (no plane logic in the component).
export type Role = 'UNDECIDED' | 'WORKLOAD' | 'MANAGEMENT' | 'BOTH'

export const ROLE_LABEL: Record<Role, string> = {
  UNDECIDED: 'Undecided',
  WORKLOAD: 'Workload',
  MANAGEMENT: 'Management (admin / control)',
  BOTH: 'Workload + Management',
}

export const ROLE_ORDER: Role[] = ['UNDECIDED', 'WORKLOAD', 'MANAGEMENT', 'BOTH']

export function roleToPlanes(r: Role): Plane[] {
  return r === 'WORKLOAD'
    ? ['WORKLOAD']
    : r === 'MANAGEMENT'
      ? ['MANAGEMENT']
      : r === 'BOTH'
        ? ['WORKLOAD', 'MANAGEMENT']
        : []
}

// Order-insensitive: `[M,W]` and `[W,M]` both resolve to BOTH (dt-core canonicalises on persist).
export function planesToRole(planes: Plane[] | null | undefined): Role {
  const w = !!planes?.includes('WORKLOAD')
  const m = !!planes?.includes('MANAGEMENT')
  return w && m ? 'BOTH' : m ? 'MANAGEMENT' : w ? 'WORKLOAD' : 'UNDECIDED'
}

// Grouped zone `v-select` items — "Your tiers" (exposure depth, outermost first) then "Outside" externals,
// each with its "reachable by" hint as the subtitle. One source shared by the Zoning tab and the bulk
// overview (both render a `#item` slot: subheaders → <v-list-subheader>, options → <v-list-item :subtitle>).
export type ZoneItem = { type?: 'subheader'; title: string; value?: Zone; subtitle?: string }
const ZONE_TIERS: Zone[] = ['PUBLIC', 'EXPOSED', 'INTERNAL', 'RESTRICTED']
const ZONE_OUTSIDE: Zone[] = ['UNTRUSTED', 'VENDOR']
export const ZONE_SELECT_ITEMS: ZoneItem[] = [
  { type: 'subheader', title: 'Your tiers' },
  ...ZONE_ORDER.filter(z => ZONE_TIERS.includes(z)).map(z => ({ title: ZONE_LABEL[z], value: z, subtitle: ZONE_HINT[z] })),
  { type: 'subheader', title: 'Outside' },
  ...ZONE_ORDER.filter(z => ZONE_OUTSIDE.includes(z)).map(z => ({ title: ZONE_LABEL[z], value: z, subtitle: ZONE_HINT[z] })),
]
