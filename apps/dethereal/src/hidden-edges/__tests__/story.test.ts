/**
 * The explanation in words, as Dethereal says it: a story for every row of the module's table, each naming the
 * starting point with its class and the rule's assumption; the evidence line; what removes or lowers an edge; each
 * fact the module weighed. Names come from the local files and the exposure read, cleaned.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { ExposureState } from '../../triage/exposures.js'
import type { ExplainPart } from '../explain.js'
import type { LocalModel } from '../local.js'
import { CONTAINER_CONFIGURATION, ROW_PRIVILEGE, ROW_TIER_CAP, STORY_ROWS, evidenceLine, factsOf, namerOf, remedyLine, storyOf, type StoryCandidate } from '../story.js'

const TABLE = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../../../../../modules/dethernety-hidden-edges/src/edge-kinds.json'), 'utf8')) as {
  rows: Array<{ id: string; edge_kind: string; defaults: StoryCandidate['defaults'] }>
}

const local: LocalModel = {
  components: new Map([
    ['web', { id: 'web', name: 'Web', type: 'PROCESS', className: 'Web Server', parent: 'seg' }],
    ['api', { id: 'api', name: 'API', type: 'PROCESS', className: null, parent: 'root' }],
    ['db', { id: 'db', name: 'DB', type: 'STORE', className: null, parent: 'root' }],
    ['out', { id: 'out', name: 'Out', type: 'PROCESS', className: null, parent: 'root' }],
    ['anon', { id: 'anon', name: '', type: 'PROCESS', className: null, parent: 'root' }],
  ]),
  boundaries: new Map([
    ['root', { id: 'root', name: 'Root', className: null, parent: null }],
    ['seg', { id: 'seg', name: 'GKE node pool', className: 'Network Segment', parent: 'root' }],
  ]),
  flows: new Map([['f1', { id: 'f1', name: 'query', source: 'web', target: 'db', classId: null }]]),
  dataItems: new Map([['tok', { id: 'tok', name: 'session token' }]]),
  controls: new Map([['c1', 'WAF']]),
}
const exposure = (id: string, name: string, element: string): ExposureState => ({
  exposure_id: id, name, type: null, category: null, score: null, attack_vector: null, created_by: 'SYSTEM', authored_by: null, disposition_kind: null, disposition_reason: null,
  dispositioned_by: null, dispositioned_at: null, disposition_stale: null, lifecycle: 'pending', element_id: element, element_name: element, element_kind: 'component',
  element_class: null, attack_ids: ['T1210'], atlas_ids: [], unresolved_references: null, def_hash: 'h', full_reason: null,
})
const exposures = new Map([['x2', exposure('x2', 'Default credentials', 'api')]])
const n = namerOf(local, exposures)
const candidate: StoryCandidate = { tier: 'medium', kg_lowered: false, defaults: { required_capability: 'opportunistic', required_privilege: 'user', granted_privilege: 'user' }, fields: {} }
const basis = { confirmed: true, gates: 2, gates_stated: 2, raises: 0, lowers: 0, high_reachable: true, caps: [] as string[] }
const part = (row: string, over: Partial<ExplainPart> = {}): ExplainPart => ({
  row, role: 'target', relation: 'same-segment', exposure: 'x2', anchor: 'api', matched: ['T1210'], path: 'T1210', foothold: 'web', reached: 'api',
  anchored_end: null, shared: 'seg', flow: null, item: null, low: null, tier: 'medium', basis, facts: [], facts_total: 0, ...over,
})

describe('the stories', () => {
  it('has a template for every row of the module’s table, none of them the fallback, each naming the starting point with its class', () => {
    expect(new Set(TABLE.rows.map((r) => r.id.split('/').pop()))).toEqual(new Set(STORY_ROWS))
    const fallback = storyOf(part('remote-service/zz-9', { item: 'tok', flow: 'f1' }), candidate, n)
    expect(fallback).toMatch(/^From Web \(Web Server\), an attacker reaches API by T1210/)
    for (const r of TABLE.rows) {
      const s = storyOf(part(r.id, { item: 'tok', flow: 'f1' }), { ...candidate, defaults: r.defaults }, n)
      expect(s, r.id).not.toBe(fallback)
      expect(s, r.id).toContain('Web (Web Server)')
      expect(s, r.id).toContain('rule assumption')
    }
  })

  it('names the assumption each credential, session and endpoint rule rests on', () => {
    const story = (row: string, over: Partial<ExplainPart> = {}) => storyOf(part(row, over), candidate, n)
    expect(story('credential-reuse/cr-1', { item: 'tok', flow: 'f1' })).toBe(
      'Web (Web Server) holds "session token"; API accepts it on "query"; a copy taken at Web is used at API. Assumes the credential can be read where Web keeps it, with user rights on Web (rule assumption).',
    )
    expect(story('credential-reuse/cr-3', { shared: null })).toBe(
      "Code on Web (Web Server) reads the instance-role credential on its host and uses it at API. Assumes code on Web can reach the host's credential endpoint, and the host has an instance role, with user rights on Web (rule assumption).",
    )
    expect(story('credential-reuse/cr-4')).toBe(
      "Any member of the realm, such as Web (Web Server), requests API's tickets; if API's service account has a weak password or the realm allows RC4, its key can be cracked offline, and the attacker acts as API's account. Assumes a foothold with user rights on Web (rule assumption).",
    )
    expect(story('credential-reuse/cr-4b')).toMatch(/ Assumes a ticket can be stolen or forged on Web, with user rights on Web \(rule assumption\)\.$/)
    expect(story('credential-reuse/cr-4c')).toMatch(/ Assumes the KDC key can be read on Web, with admin rights on Web \(rule assumption\)\.$/)
    expect(story('remote-service/rs-4v')).toBe(
      'Sessions from Web (Web Server) land in "GKE node pool"; from there an attacker reaches API. Assumes nothing between the landing segment and API checks the session again, with user rights on Web (rule assumption).',
    )
    expect(story('remote-service/rs-5', { anchor: '' })).toBe(
      'From an owned endpoint Web (Web Server), an attacker reaches API in another segment. Assumes the endpoint is already owned, with user rights on Web (rule assumption).',
    )
  })

  it('states the rights each rule assumes, as the module’s table states them, never the merged edge’s', () => {
    const table = TABLE.rows as Array<{ id: string; defaults: { required_privilege: string } }>
    for (const r of table) expect(ROW_PRIVILEGE[r.id.split('/').pop()!], r.id).toBe(r.defaults.required_privilege)
    expect(Object.keys(ROW_PRIVILEGE).sort()).toEqual([...STORY_ROWS].sort())
    for (const required_privilege of ['user', 'system'] as const) {
      const merged = { ...candidate, defaults: { ...candidate.defaults, required_privilege } }
      expect(storyOf(part('credential-capture/cc-1', { item: 'tok', flow: 'f1' }), merged, n)).toMatch(/, with admin rights on Web \(rule assumption\)\.$/)
      expect(storyOf(part('remote-service/rs-3'), { ...merged, defaults: { ...merged.defaults, required_privilege: 'admin' } }, n)).toMatch(/with user rights on Web \(rule assumption\)\.$/)
    }
    expect(storyOf(part('credential-reuse/cr-1d', { item: 'tok' }), candidate, n)).toBe('An admin on Web (Web Server) dumps "session token" and uses it at API, with admin rights on Web (rule assumption).')
  })

  it('tells a remote-service edge with its segment, technique, finding and assumption; the anchor only when it is not the target', () => {
    expect(storyOf(part('remote-service/rs-3'), candidate, n)).toBe(
      'From Web (Web Server), in the same "GKE node pool" as API, an attacker uses T1210 against API, where "Default credentials" was found, with user rights on Web (rule assumption).',
    )
    expect(storyOf(part('remote-service/rs-3', { anchor: 'db' }), candidate, n)).toContain('against API, on "DB", where')
    expect(storyOf(part('remote-service/rs-3', { shared: null }), candidate, n)).toMatch(/^From Web \(Web Server\), an attacker uses/)
  })

  it('tells a capture edge by its own facts on its flow, not the edge’s merged field', () => {
    const cc = { ...candidate, defaults: { ...candidate.defaults, required_privilege: 'admin' as const }, fields: { transport_state: 'cleartext' } }
    const onFlow = (attr: string, value: boolean) => ({ at: [`attributes:f1#${attr}`], value, effect: 'context' as const })
    expect(storyOf(part('credential-capture/cc-1', { item: 'tok', flow: 'f1', facts: [onFlow('tls_only_transport', true)] }), cc, n)).toContain('sent with transport not stated')
    expect(storyOf(part('credential-capture/cc-1', { item: 'tok', flow: 'f1', facts: [onFlow('flow_tls_encrypted', false)] }), cc, n)).toBe(
      'Code on Web (Web Server), in "GKE node pool", reads "session token" from "query" (Web → DB), sent in cleartext, and uses it at API, which accepts the same item. Assumes members of "GKE node pool" see each other\'s traffic, with admin rights on Web (rule assumption).',
    )
  })

  it('says the zone only of a starting point in it, by the files’ nesting; a zone by name only when its class says so', () => {
    expect(storyOf(part('remote-service/rs-1'), candidate, n)).toContain('From Web (Web Server), in "GKE node pool", an attacker')
    expect(storyOf(part('remote-service/rs-1', { foothold: 'out' }), candidate, n)).toContain("From Out, in API's segment, an attacker")
    expect(storyOf(part('remote-service/rs-1', { foothold: 'gone' }), candidate, n)).toContain(`in API's segment or "GKE node pool"`)
    const trust = namerOf({ ...local, boundaries: new Map([...local.boundaries].map(([id, b]) => [id, id === 'seg' ? { ...b, className: 'Trust Zone' } : b])) }, exposures)
    expect(storyOf(part('remote-service/rs-1'), candidate, trust)).toContain('From Web (Web Server), in zone "GKE node pool", an attacker')
    expect(storyOf(part('remote-service/rs-3b', { foothold: 'gone' }), candidate, trust)).toContain(`in API's segment or zone "GKE node pool"`)
  })

  it('starts every story with a capital, whatever name opens it', () => {
    const lower = namerOf({ ...local, components: new Map([...local.components].map(([id, c]) => [id, id === 'web' ? { ...c, name: 'web' } : c])) }, exposures)
    for (const r of TABLE.rows) expect(storyOf(part(r.id, { item: 'tok', flow: 'f1' }), candidate, lower).charAt(0), r.id).toMatch(/[A-Z]/)
  })

  it('names an unnamed element apart from one no longer in the files, and cleans every name', () => {
    expect(n.name('anon')).toBe('an unnamed component')
    expect(n.name('nowhere')).toBe('an element no longer in the model')
    const dirty = namerOf({ ...local, components: new Map([['web', { id: 'web', name: 'We‮b\nX', type: 'PROCESS', className: 'A'.repeat(90) }]]) }, exposures)
    expect(dirty.withClass('web')).toBe(`We?b X (${'A'.repeat(59)}…)`)
  })
})

describe("a host escape's route", () => {
  const fact = (el: string, a: string, value: boolean, effect: 'meets_gate' | 'context') => ({ at: [`attributes:${el}#${a}`], value, effect, gate: 0 })
  const he = (facts: ExplainPart['facts'], fields: Record<string, string>, explain?: StoryCandidate['explain']) =>
    storyOf(part('host-escape/he-1', { anchor: 'seg', facts }), { ...candidate, fields, ...(explain ? { explain } : {}) }, n)
  const x = (parts: ExplainPart[], parts_total = parts.length): StoryCandidate['explain'] => ({ parts, parts_total, crown_jewel: { source: false, target: false }, remedies: null, remedies_total: 0 })
  const UNSETTLED = '(the model does not settle how)'

  it('names the attributes the module’s table gates a host escape on', () => {
    const rows = TABLE.rows as unknown as Array<{ id: string; attribute_breakers: Array<{ attributes: string[]; high_when: string; read_from: string }> }>
    const gate = rows.find((r) => r.id.endsWith('/he-1'))!.attribute_breakers.find((b) => b.high_when === 'any_false')!
    expect([...CONTAINER_CONFIGURATION].sort()).toEqual([...gate.attributes].sort())
    expect(gate.read_from).toBe('anchor')
  })

  it('is the edge’s own escape vector where every way in is listed and on one container, the kernel route included', () => {
    const one = part('host-escape/he-1', { anchor: 'seg' })
    expect(he([], { escape_vector: 'kernel_or_runtime' }, x([one]))).toContain('(through the kernel or the runtime)')
    expect(he([], { escape_vector: 'configuration' }, x([one]))).toContain("(through the container's configuration)")
    expect(he([], { escape_vector: 'unstated' }, x([one]))).toContain(UNSETTLED)
    expect(he([], { escape_vector: 'kernel_or_runtime' }, x([one, part('host-escape/he-1', { anchor: 'seg', foothold: 'out' })]))).toContain('(through the kernel or the runtime)')
  })

  it('is from this way in’s own facts on an edge whose ways in are not all listed, or not on one container', () => {
    const one = part('host-escape/he-1', { anchor: 'seg' })
    for (const explain of [x([one], 2), x([one, part('host-escape/he-1', { anchor: 'root' })]), undefined]) {
      expect(he([], { escape_vector: 'kernel_or_runtime' }, explain)).toContain(UNSETTLED)
      for (const a of CONTAINER_CONFIGURATION) expect(he([fact('seg', a, false, 'meets_gate')], { escape_vector: 'kernel_or_runtime' }, explain), a).toContain("(through the container's configuration)")
      expect(he([fact('web', CONTAINER_CONFIGURATION[0]!, false, 'meets_gate')], {}, explain)).toContain(UNSETTLED)
      expect(he([fact('seg', CONTAINER_CONFIGURATION[0]!, true, 'context')], {}, explain)).toContain(UNSETTLED)
    }
  })
})

describe('the evidence, the remedies and the facts in words', () => {
  it('says why the evidence is what it is, the knowledge graph’s step included', () => {
    const pending = part('remote-service/rs-1', { basis: { ...basis, confirmed: false, gates: 1, gates_stated: 0, caps: ['pending', 'zone_without_own_finding'] } })
    expect(evidenceLine({ ...candidate, kg_lowered: true }, pending, n)).toBe(
      'Evidence: Medium. The finding is pending (Medium at most); 0 of the 1 condition High needs is met; API has no finding of its own (Medium at most); the knowledge graph lowered it one step.',
    )
  })

  it('says what removes or lowers the edge, against the module’s own evidence when the knowledge graph lowered it', () => {
    const limits = { listed: 1, not_listed: 0, pairs_capped: 2, anchors_over_budget: 0 }
    expect(remedyLine({ set: [{ at: 'attributes:api#hardened' }], outcome: 'removes', clears_finding: 'x2' }, candidate, n, limits)).toBe(
      'The edge goes if the model states hardened = true on "API", which also clears "Default credentials"; other paths may remain.',
    )
    expect(remedyLine({ control_classes: ['Endpoint Protection'], attributes_true: ['blocks_lateral'], item_classes: [], on: 'api', outcome: 'lowers_to:low' }, { ...candidate, kg_lowered: true }, n)).toBe(
      'Drops to Evidence Low (from the module\'s own evidence, before the knowledge graph\'s step) if the model states an Endpoint Protection control on "API" (blocks_lateral true).',
    )
  })

  it('says each fact: what it is about, its value, what it did', () => {
    const p = part('remote-service/rs-1', {
      facts: [
        { at: ['attributes:api#tls_enabled'], value: false, effect: 'meets_gate', gate: 0 },
        { at: ['control:c1'], value: null, effect: 'lowers' },
        { at: ['attributes:web#a', 'attributes:web#b'], value: null, effect: 'gate_unanswered' },
      ],
    })
    expect(factsOf(p, n)).toEqual([
      { fact: 'tls_enabled on "API"', value: false, effect: 'meets 1 of the 2 conditions High needs' },
      { fact: 'the control "WAF"', value: null, effect: 'lowers the evidence one step' },
      { fact: 'a on "Web", b on "Web"', value: null, effect: 'not answered; High needs one of these stated false' },
    ])
  })

  it('caps each rule where the module’s table caps it, and says a capped pair’s count and cap without what High needs', () => {
    const rows = TABLE.rows as unknown as Array<{ id: string; tier_cap: string }>
    for (const r of rows) expect(ROW_TIER_CAP[r.id.split('/').pop()!], r.id).toBe(r.tier_cap)
    expect(Object.keys(ROW_TIER_CAP).sort()).toEqual([...STORY_ROWS].sort())
    const capped = { ...basis, gates_stated: 1, high_reachable: false, caps: ['row_cap'] }
    expect(evidenceLine(candidate, part('remote-service/rs-3f', { basis: capped }), n)).toBe('Evidence: Medium. The finding is confirmed; 1 of the 2 conditions is met; this rule never reaches High.')
    expect(evidenceLine({ ...candidate, tier: 'low' }, part('credential-reuse/cr-4', { basis: capped }), n)).toBe('Evidence: Low. The finding is confirmed; 1 of the 2 conditions is met; this rule never goes above Low.')
    const noGate = { ...basis, gates: 0, gates_stated: 0, high_reachable: false, caps: ['no_gate'] }
    expect(evidenceLine(candidate, part('remote-service/rs-3', { basis: noGate }), n)).toBe('Evidence: Medium. The finding is confirmed; High is out of reach: no condition applies to this pair.')
    expect(evidenceLine(candidate, part('remote-service/rs-3f', { basis: { ...noGate, caps: ['no_gate', 'row_cap'] } }), n)).toBe('Evidence: Medium. The finding is confirmed; no condition applies to this pair; this rule never reaches High.')
    // the zone limit leaves the prefix: it is no cap on High
    expect(evidenceLine(candidate, part('remote-service/rs-1', { basis: { ...noGate, caps: ['no_gate', 'zone_without_own_finding'] } }), n)).toMatch(/; High is out of reach: no condition applies to this pair; API has no finding of its own/)
    const unreachable = part('remote-service/rs-3f', {
      basis: capped,
      facts: [
        { at: ['attributes:api#a'], value: false, effect: 'meets_gate', gate: 0 },
        { at: ['attributes:api#b'], value: null, effect: 'gate_unanswered' },
        { at: ['attributes:api#c', 'attributes:api#d'], value: null, effect: 'gate_unanswered' },
        { at: ['attributes:api#e'], value: true, effect: 'misses_gate' },
        { at: ['exposure:x2'], value: null, effect: 'own_target_finding' },
      ],
    })
    expect(factsOf(unreachable, n).map((f) => f.effect)).toEqual([
      'meets 1 of the 2 conditions', 'a condition, not answered', 'a condition, not answered: one of these stated false would meet it', 'contradicts a condition', "the target's own finding (lifts the zone limit)",
    ])
  })

  it('says the attributes that each meet the same condition once, as one condition, so they never outnumber the conditions', () => {
    const p = part('host-escape/he-1', {
      basis: { ...basis, gates: 2, gates_stated: 1 },
      facts: [
        { at: ['attributes:web#privileged'], value: true, effect: 'meets_gate', gate: 0 },
        { at: ['attributes:web#host_pid'], value: true, effect: 'meets_gate', gate: 0 },
        { at: ['attributes:web#host_network'], value: true, effect: 'meets_gate', gate: 0 },
      ],
    })
    expect(factsOf(p, n)).toEqual([
      { fact: 'privileged on "Web" = true, host_pid on "Web" = true, host_network on "Web" = true', value: null, effect: 'each meets the same condition (1 of the 2 conditions High needs)' },
    ])
  })
})
