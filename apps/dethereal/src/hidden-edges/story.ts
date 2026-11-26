/**
 * What a hidden edge's explanation says, in words: the attacker's story from a part and its row (templates by row,
 * never by relation), the line on its evidence from the part's basis, what would remove or lower it, and each fact
 * the module weighed. The module gives ids; the words and the names (from the local files and the exposure read) are
 * Dethereal's. Every story names the starting point and its class, and the rule's assumption; a missing item or
 * segment drops its clause. What a story states of one way in rests on that way's own facts, never on the edge's
 * merged fields. Every name goes through `said()`: this session's credentials taken out, then cleaned and cut.
 */
import { redactSecrets } from '../auth/redact.js'
import type { ExposureState } from '../triage/exposures.js'
import { shown } from '../triage/text.js'
import type { BaseValues, Tier } from './contract.js'
import type { Explain, ExplainFact, ExplainPart, Limits, Remedy } from './explain.js'
import type { LocalModel } from './local.js'

const NAME_CHARS = 60
/** A text as a line shows it, this session's credentials taken out before the cut, so a cut never leaves part of one. */
export const said = (text: string, max?: number): string => shown(redactSecrets(text), max)
const TIER_WORD: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }
export const tierWord = (t: string) => TIER_WORD[t] ?? t

/** A word from one of these maps by a key the module sent: its own entries only, never an inherited one. */
const word = (map: Record<string, string>, key: unknown, fallback: string) =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key) ? map[key]! : fallback
const quoted = (s: string) => `"${s}"`

/** The rights a rule assumes on the starting point, in words. */
const RIGHTS: Record<string, string> = { none: 'no rights', user: 'user rights', admin: 'admin rights', system: 'system rights' }
/**
 * The rights each rule assumes on its starting point (its `defaults.required_privilege` in the module's table): a way
 * in states its own row's, never the merged edge's, which may come from another row.
 */
export const ROW_PRIVILEGE: Readonly<Record<string, string>> = Object.freeze({
  'cc-1': 'admin', 'cc-1c': 'admin', 'cc-2': 'admin', 'cc-2c': 'admin', 'cr-1d': 'admin', 'cr-1db': 'admin', 'cr-4c': 'admin', 'he-1': 'admin',
  'rs-1': 'user', 'rs-1f': 'user', 'rs-2': 'user', 'rs-3': 'user', 'rs-3f': 'user', 'rs-3b': 'user', 'rs-4v': 'user', 'rs-4a': 'user', 'rs-5': 'user',
  'cr-1': 'user', 'cr-1b': 'user', 'cr-1s': 'user', 'cr-1f': 'user', 'cr-2': 'user', 'cr-2f': 'user', 'cr-3': 'user', 'cr-3f': 'user', 'cr-4': 'user', 'cr-4b': 'user',
})
/** A host escape's route, as the edge's escape vector says it. */
const ESCAPE: Record<string, string> = { configuration: "through the container's configuration", kernel_or_runtime: 'through the kernel or the runtime', unstated: 'the model does not settle how' }
/** The container attributes whose one stated false meets a host escape's condition, as the module's table names them. */
export const CONTAINER_CONFIGURATION = Object.freeze(['container_privileged_mode_disabled', 'container_capabilities_dropped_to_minimal', 'container_host_namespaces_not_shared', 'container_no_sensitive_host_mounts'])

/** The names a story reads: an element's name and class, a flow's name and ends, a finding's, a control's. */
export interface Namer {
  name(id: string): string
  withClass(id: string): string
  flow(id: string): { name: string; source: string; target: string; sourceId: string | null; targetId: string | null } | null
  finding(id: string): string
  control(id: string): string
  /** Whether an element sits under a boundary, by the files' nesting; null when the files cannot tell */
  isUnder(id: string, boundary: string): boolean | null
  /** An element's class name, or null */
  className(id: string): string | null
}

export function namerOf(local: LocalModel, exposures: ReadonlyMap<string, ExposureState>): Namer {
  const cut = (s: string) => said(s, NAME_CHARS)
  const name = (id: string): string => {
    const c = local.components.get(id)
    if (c) return c.name ? cut(c.name) : 'an unnamed component'
    const b = local.boundaries.get(id)
    if (b) return b.name ? cut(b.name) : 'an unnamed boundary'
    const f = local.flows.get(id)
    if (f) return f.name ? cut(f.name) : 'an unnamed flow'
    const d = local.dataItems.get(id)
    if (d) return d.name ? cut(d.name) : 'an unnamed data item'
    return 'an element no longer in the model'
  }
  const parentOf = (id: string) => local.components.get(id)?.parent ?? local.boundaries.get(id)?.parent ?? null
  return {
    name,
    withClass: (id) => {
      const cls = local.components.get(id)?.className ?? local.boundaries.get(id)?.className
      return cls ? `${name(id)} (${cut(cls)})` : name(id)
    },
    flow: (id) => {
      const f = local.flows.get(id)
      return f ? { name: f.name ? cut(f.name) : 'an unnamed flow', source: name(f.source), target: name(f.target), sourceId: f.source || null, targetId: f.target || null } : null
    },
    finding: (id) => {
      const e = exposures.get(id)
      return e ? (e.name ? said(e.name, 80) : 'an unnamed finding') : 'a finding no longer in the model'
    },
    control: (id) => {
      const c = local.controls?.get(id)
      return c ? cut(c) : 'a control on the path'
    },
    className: (id) => local.components.get(id)?.className ?? local.boundaries.get(id)?.className ?? null,
    isUnder: (id, boundary) => {
      if (!(local.components.has(id) || local.boundaries.has(id)) || !local.boundaries.has(boundary)) return null
      const seen = new Set<string>()
      for (let b = parentOf(id); b; b = parentOf(b)) {
        if (b === boundary) return true
        if (seen.has(b)) return null
        seen.add(b)
      }
      return false
    },
  }
}

/**
 * What a story reads of the candidate: its tier and the knowledge graph's step, and its kind's fields where they are
 * one way in's alone (its explanation says whether they are); its defaults are kept for the callers' signature.
 */
export interface StoryCandidate { fields: Record<string, string>; defaults: BaseValues; tier: Tier; kg_lowered: boolean; explain?: Explain }

/**
 * A host escape's route. Where every way in the module found is listed and all sit on the same container (one way in,
 * at least), the edge's escape vector is theirs and says it, the kernel or runtime route included, which gives no fact
 * of its own. Otherwise, from this way in's own facts: through the container's configuration when one of its
 * configuration attributes is stated false on the container; else the model does not settle how.
 */
function escapeRouteOf(part: ExplainPart, c: StoryCandidate): string {
  const x = c.explain && 'parts' in c.explain ? c.explain : null
  const own = x !== null && x.parts_total === x.parts.length && x.parts.every((p) => p.anchor === x.parts[0]!.anchor)
  if (own && Object.prototype.hasOwnProperty.call(c.fields, 'escape_vector')) {
    const field = word(ESCAPE, c.fields.escape_vector, '')
    if (field) return field
  }
  const configured = part.facts.some((f) => f.effect === 'meets_gate' && f.at.length === 1 && f.at[0]!.startsWith('attributes:') && elOf(f.at[0]!) === part.anchor && CONTAINER_CONFIGURATION.includes(attrOf(f.at[0]!)))
  return configured ? ESCAPE.configuration! : ESCAPE.unstated!
}

/** The rule's assumption on the starting point, by its row: "with admin rights on Web (rule assumption)". */
const assumption = (key: string, f: string, prep = 'on') => `with ${word(RIGHTS, word(ROW_PRIVILEGE, key, 'user'), RIGHTS.user!)} ${prep} ${f} (rule assumption)`

const attrOf = (at: string) => at.replace(/^attributes:/, '').split('#')[1] ?? at
const elOf = (at: string) => at.replace(/^attributes:/, '').split('#')[0]!

/** The transport attributes the module reads on a flow. */
const TRANSPORT_ATTRS = new Set(['flow_tls_encrypted', 'encryption_in_transit_enabled', 'tls_only_transport', 'service_to_service_mtls_enforced'])

/**
 * How the credential crosses this part's flow, from this part's own facts on that flow (as the module reads a flow's
 * transport): any transport attribute stated false is cleartext; one stated true with the certificate stated not
 * validated is unverified TLS; anything else does not settle it.
 */
export function transportOf(part: Pick<ExplainPart, 'flow' | 'facts'>): string {
  if (!part.flow) return 'with transport not stated'
  const stated = new Map<string, ExplainFact['value']>()
  for (const f of part.facts) if (f.at.length === 1 && f.at[0]!.startsWith('attributes:') && elOf(f.at[0]!) === part.flow) stated.set(attrOf(f.at[0]!), f.value)
  const transport = [...stated].filter(([a]) => TRANSPORT_ATTRS.has(a)).map(([, v]) => v)
  if (transport.includes(false)) return 'in cleartext'
  if (transport.includes(true) && stated.get('server_certificate_validated') === false) return 'over unverified TLS'
  return 'with transport not stated'
}

/** The attacker's story for one part, starting with a capital whatever name or words open it. */
export function storyOf(part: ExplainPart, c: StoryCandidate, n: Namer): string {
  const s = storyText(part, c, n)
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}`
}

/** The story by its row, with its own facts, its row's rights and the names the files give. */
function storyText(part: ExplainPart, c: StoryCandidate, n: Namer): string {
  const key = part.row.split('/').pop() ?? ''
  const F = n.withClass(part.foothold)
  const f = n.name(part.foothold)
  const R = n.name(part.reached)
  const S = part.shared ? quoted(n.name(part.shared)) : null
  const item = part.item ? quoted(n.name(part.item)) : null
  const flow = part.flow ? n.flow(part.flow) : null
  // the finding's element, when it is neither the target nor the segment already named
  const on = part.anchor && part.anchor !== part.reached && part.anchor !== part.shared ? `, on ${quoted(n.name(part.anchor))}` : ''
  const finding = quoted(n.finding(part.exposure))
  const technique = part.path
  switch (key) {
    case 'cc-1':
    case 'cc-1c':
    case 'cc-2':
    case 'cc-2c': {
      const verb = key.startsWith('cc-2') ? 'intercepts' : 'reads'
      const from = flow ? ` from ${quoted(flow.name)} (${flow.source} → ${flow.target})` : ''
      // the credential is used past the flow it crosses: the target accepts the same item
      const accepts = item && flow && flow.targetId !== part.reached ? ', which accepts the same item' : ''
      const sees = S ? `members of ${S} see each other's traffic` : `the traffic can be seen from ${f}`
      return `Code on ${F}${S ? `, in ${S},` : ''} ${verb} ${item ?? 'the credential'}${from}, sent ${transportOf(part)}, and uses it at ${R}${accepts}. Assumes ${sees}, ${assumption(key, f)}.`
    }
    case 'rs-1f':
    case 'rs-3':
    case 'rs-3f':
    case 'rs-2':
    case 'cr-2':
    case 'cr-2f':
      return `From ${F}${S ? `, in the same ${S} as ${R}` : ''}, an attacker uses ${technique} against ${R}${on}, where ${finding} was found, ${assumption(key, f)}.`
    case 'rs-1':
    case 'rs-3b': {
      // a starting point of a zone rule may be the target's segment peer, outside the zone
      const under = part.shared ? n.isUnder(part.foothold, part.shared) : null
      // a boundary is called a zone only when its class names it one
      const zone = part.shared && /zone/i.test(n.className(part.shared) ?? '') ? 'zone ' : ''
      const where = !S ? '' : under === true ? `, in ${zone}${S}` : under === false ? `, in ${R}'s segment` : `, in ${R}'s segment or ${zone}${S}`
      return `From ${F}${where}, an attacker uses ${technique} against ${R}${on}, where ${finding} was found, ${assumption(key, f)}.`
    }
    case 'rs-4v':
    case 'rs-4a':
      return `Sessions from ${F} land ${S ? `in ${S}` : 'in its segment'}; from there an attacker reaches ${R}. Assumes nothing between the landing segment and ${R} checks the session again, ${assumption(key, f)}.`
    case 'rs-5':
      return `From an owned endpoint ${F}${part.anchor ? ` in ${quoted(n.name(part.anchor))}` : ''}, an attacker reaches ${R} in another segment. Assumes the endpoint is already owned, ${assumption(key, f)}.`
    case 'cr-3':
    case 'cr-3f':
      return `Code on ${F} reads the instance-role credential on ${S ?? 'its host'} and uses it at ${R}. Assumes code on ${f} can reach the host's credential endpoint, and the host has an instance role, ${assumption(key, f)}.`
    case 'cr-4':
      return `Any member of the realm, such as ${F}, requests ${R}'s tickets; if ${R}'s service account has a weak password or the realm allows RC4, its key can be cracked offline, and the attacker acts as ${R}'s account. Assumes a foothold ${assumption(key, f)}.`
    case 'cr-4b':
      return `With a ticket stolen or forged on ${F}, an attacker passes it at ${R}, another service of the realm. Assumes a ticket can be stolen or forged on ${f}, ${assumption(key, f)}.`
    case 'cr-4c':
      return `With the KDC key from ${F}, an attacker forges tickets for any member and uses them at ${R}. Assumes the KDC key can be read on ${f}, ${assumption(key, f)}.`
    case 'he-1': {
      const C = quoted(n.name(part.anchor))
      return `Code on ${F}, in container ${C}, escapes to ${S ?? 'its host'} (${escapeRouteOf(part, c)}) and reaches ${R} on the same host, ${assumption(key, C, 'in')}.`
    }
    case 'cr-1':
    case 'cr-1b':
    case 'cr-1s':
    case 'cr-1f':
      return `${F} holds ${item ?? 'a credential'}; ${R} accepts it${flow ? ` on ${quoted(flow.name)}` : ''}; a copy taken at ${f} is used at ${R}. Assumes the credential can be read where ${f} keeps it, ${assumption(key, f)}.`
    case 'cr-1d':
    case 'cr-1db':
      return `An admin on ${F} dumps ${item ?? 'a credential'} and uses it at ${R}, ${assumption(key, f)}.`
    default:
      // a row Dethereal has no words for: what the module says, plainly
      return `From ${F}, an attacker reaches ${R} by ${technique}, where ${finding} was found.`
  }
}

/** The row ids storyOf has a template for. */
export const STORY_ROWS = Object.freeze(['cc-1', 'cc-1c', 'cc-2', 'cc-2c', 'rs-1f', 'rs-3', 'rs-3f', 'rs-2', 'cr-2', 'cr-2f', 'rs-1', 'rs-3b', 'rs-4v', 'rs-4a', 'rs-5', 'cr-3', 'cr-3f', 'cr-4', 'cr-4b', 'cr-4c', 'he-1', 'cr-1', 'cr-1b', 'cr-1s', 'cr-1f', 'cr-1d', 'cr-1db'])

const LOW: Record<string, string> = {
  perimeter_only: 'the starting point reaches it only across the perimeter (Low only)',
  managed_runtime: 'the starting point is a managed runtime (Low only)',
  generic_item: 'the credential is carried by many flows (Low only)',
}

/** The highest evidence each rule can give (its `tier_cap` in the module's table). */
export const ROW_TIER_CAP: Readonly<Record<string, string>> = Object.freeze({
  'rs-1': 'high', 'rs-1f': 'high', 'rs-2': 'high', 'rs-3': 'high', 'rs-3f': 'medium', 'rs-3b': 'medium', 'rs-4v': 'medium', 'rs-4a': 'medium', 'rs-5': 'medium',
  'cr-1': 'high', 'cr-1b': 'medium', 'cr-1s': 'medium', 'cr-1d': 'medium', 'cr-1db': 'medium', 'cr-1f': 'medium', 'cr-2': 'high', 'cr-2f': 'high',
  'cr-3': 'medium', 'cr-3f': 'medium', 'cr-4': 'low', 'cr-4b': 'low', 'cr-4c': 'low', 'cc-1': 'high', 'cc-2': 'high', 'cc-1c': 'medium', 'cc-2c': 'medium', 'he-1': 'high',
})

const conditions = (k: number) => (k === 1 ? 'condition' : 'conditions')
/** "1 of the 2 conditions High needs", or "1 of the 2 conditions" where High cannot be reached: built here only. */
const ofConditions = (k: number, gates: number, reachable: boolean) => `${k} of the ${gates} ${conditions(gates)}${reachable ? ' High needs' : ''}`

/**
 * One line on the evidence, from the primary part's basis: "Evidence: Medium. The finding is pending (Medium at most);
 * 0 of the 1 condition High needs is met." What High needs is said only where this rule can reach High on this pair;
 * else the conditions met are counted, and the cap says why.
 */
export function evidenceLine(c: StoryCandidate, part: ExplainPart, n: Namer): string {
  const b = part.basis
  const why = [b.confirmed ? 'The finding is confirmed' : 'The finding is pending (Medium at most)']
  if (b.gates > 0) why.push(`${ofConditions(b.gates_stated, b.gates, b.high_reachable)} ${b.gates_stated === 1 || b.gates === 1 ? 'is' : 'are'} met`)
  // a cap clause after it already says High is out of reach
  else if (part.low || b.caps.includes('row_cap') || b.caps.includes('technique_cap')) why.push('no condition applies to this pair')
  else why.push('High is out of reach: no condition applies to this pair')
  if (b.raises) why.push(`${b.raises} ${b.raises === 1 ? 'fact raises' : 'facts raise'} it`)
  if (b.lowers) why.push(`${b.lowers} ${b.lowers === 1 ? 'fact lowers' : 'facts lower'} it`)
  if (part.low) why.push(word(LOW, part.low, part.low))
  if (b.caps.includes('row_cap')) why.push(word(ROW_TIER_CAP, part.row.split('/').pop(), '') === 'low' ? 'this rule never goes above Low' : 'this rule never reaches High')
  if (b.caps.includes('technique_cap')) why.push('its technique never reaches High')
  if (b.caps.includes('zone_without_own_finding')) why.push(`${n.name(part.reached)} has no finding of its own (Medium at most)`)
  if (c.kg_lowered) why.push('the knowledge graph lowered it one step')
  return `Evidence: ${tierWord(c.tier)}. ${why.join('; ')}.`
}

/**
 * What a remedy would do, in words. A lowering is said against the evidence the module computed before the knowledge
 * graph's step, and says so; an edge that goes, where the module did not walk every starting point for its kind, says
 * other paths may remain.
 */
export function remedyLine(r: Remedy, c: StoryCandidate, n: Namer, kindLimits: Limits['by_kind'][string] | null = null): string {
  let lead: string
  if (r.outcome === 'removes') lead = 'The edge goes'
  else if (r.outcome === 'this_path_only') lead = `Some ways in close; the edge stays at Evidence ${tierWord(c.tier)},`
  else {
    const to = tierWord(r.outcome.slice('lowers_to:'.length))
    lead = c.kg_lowered ? `Drops to Evidence ${to} (from the module's own evidence, before the knowledge graph's step)` : `Drops to Evidence ${to}`
  }
  let what: string
  if ('set' in r) {
    const clears = r.clears_finding ? `, which also clears ${quoted(n.finding(r.clears_finding))}` : ''
    what = `${r.set.map((s) => `${attrOf(s.at)} = true`).join(' and ')} on ${quoted(n.name(elOf(r.set[0]!.at)))}${clears}`
  } else {
    const attrs = r.attributes_true.length ? ` (${r.attributes_true.join(' or ')} true)` : ''
    const items = r.item_classes.length ? `, protecting ${r.item_classes.join(' or ')}` : ''
    const classes = r.control_classes.join(' or ')
    what = `${/^[AEIOU]/i.test(classes) ? 'an' : 'a'} ${classes} control on ${quoted(n.name(r.on))}${attrs}${items}`
  }
  const partial = r.outcome === 'removes' && kindLimits && (kindLimits.anchors_over_budget > 0 || kindLimits.pairs_capped > 0) ? '; other paths may remain' : ''
  return `${lead} if the model states ${what}${partial}.`
}

/** What a fact is about, in words: its attributes and their elements, a control, a finding, or the knowledge graph. */
function factSubject(f: ExplainFact, n: Namer): string {
  const attrs = f.at.filter((l) => l.startsWith('attributes:'))
  if (attrs.length) return attrs.map((l) => `${attrOf(l)} on ${quoted(n.name(elOf(l)))}`).join(', ')
  const first = f.at[0]!
  if (first.startsWith('control:')) return `the control ${quoted(n.control(first.slice('control:'.length)))}`
  if (first.startsWith('exposure:')) return `the finding ${quoted(n.finding(first.slice('exposure:'.length)))}`
  return `the knowledge graph (${f.at.map((l) => said(l, 140)).join(', ')})`
}

/** What a fact did to the evidence, in words; what High needs only where High can be reached. */
function factEffect(f: ExplainFact, gates: number, reachable: boolean): string {
  switch (f.effect) {
    case 'meets_gate':
      return `meets ${ofConditions(1, gates, reachable)}`
    case 'gate_unanswered':
      if (!reachable) return f.at.length > 1 ? 'a condition, not answered: one of these stated false would meet it' : 'a condition, not answered'
      return f.at.length > 1 ? 'not answered; High needs one of these stated false' : 'not answered; High needs it stated false'
    case 'context':
      return 'stated; another condition decides'
    case 'misses_gate':
      return reachable ? 'contradicts a condition, which keeps the edge below High' : 'contradicts a condition'
    case 'lowers':
      return 'lowers the evidence one step'
    case 'raises':
      return 'raises the evidence one step'
    case 'own_target_finding':
      return reachable ? "the target's own finding allows High" : "the target's own finding (lifts the zone limit)"
    case 'kg_lowered':
      return 'lowered it one step'
  }
}

/**
 * Each fact the module weighed: what it is about, its value as stated, and what it did. The attributes that each meet
 * the same condition (a group's, any one of them stated false enough, such as a host escape's configuration) are said
 * once, as one condition. What High needs is said only where High can be reached.
 */
export function factsOf(part: ExplainPart, n: Namer): Array<{ fact: string; value: ExplainFact['value']; effect: string }> {
  const gates = part.basis.gates
  const reachable = part.basis.high_reachable
  const byGate = new Map<number, ExplainFact[]>()
  const order: Array<{ fact: ExplainFact } | { gate: number }> = []
  for (const f of part.facts) {
    if (f.effect === 'meets_gate' && typeof f.gate === 'number') {
      if (!byGate.has(f.gate)) {
        byGate.set(f.gate, [])
        order.push({ gate: f.gate })
      }
      byGate.get(f.gate)!.push(f)
    } else order.push({ fact: f })
  }
  return order.map((x) => {
    const group = 'gate' in x ? byGate.get(x.gate)! : null
    if (!group || group.length === 1) {
      const f = group ? group[0]! : (x as { fact: ExplainFact }).fact
      return { fact: factSubject(f, n), value: typeof f.value === 'string' ? said(f.value) : f.value, effect: factEffect(f, gates, reachable) }
    }
    const joined = group.map((f) => `${factSubject(f, n)}${f.value === null ? '' : ` = ${said(String(f.value))}`}`).join(', ')
    return { fact: joined, value: null, effect: `each meets the same condition (${ofConditions(1, gates, reachable)})` }
  })
}
