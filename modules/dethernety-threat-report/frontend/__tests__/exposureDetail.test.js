import { describe, it, expect } from 'vitest'
import { buildExposureDetail, cleanProse } from '../lib/exposureDetail.js'

const full = {
  id: 'e1',
  name: 'SQL Injection',
  score: 8.5,
  attackVector: 'NETWORK',
  description: 'Unsanitised input reaches the query (Citation: OWASP). See [docs](http://x).',
  type: 'Injection',
  category: 'Input Validation',
  references: 'CVE-2021-1234\nhttps://example.com',
  mitigationSuggestions: ['Parameterise queries', ' Validate input ', 'Parameterise queries', '', null],
  detectionMethods: ['WAF alerts', 'Query log review'],
  tags: ['owasp-top-10', 'web'],
  createdBy: 'USER',
  dispositionKind: null,
}

describe('cleanProse', () => {
  it('strips citation markers, markdown links, and tags; collapses whitespace', () => {
    expect(cleanProse('Foo (Citation: bar) [link](http://x)   baz')).toBe('Foo link baz')
    expect(cleanProse('a <b>bold</b> word')).toBe('a bold word')
  })
  it('leaves no <...> tag in the output for nested/malformed tags (fixpoint strip)', () => {
    const out = cleanProse('<scr<script>ipt>alert(1)<</script>/script>')
    expect(out).not.toMatch(/<[^>]*>/) // the security property: no surviving tag
  })
  it('returns null for nullish or blank input', () => {
    expect(cleanProse(null)).toBeNull()
    expect(cleanProse(undefined)).toBeNull()
    expect(cleanProse('   ')).toBeNull()
  })
})

describe('buildExposureDetail', () => {
  it('returns null for a missing/invalid finding', () => {
    expect(buildExposureDetail(null)).toBeNull()
    expect(buildExposureDetail('nope')).toBeNull()
  })

  it('maps the full field set with cleaned prose + deduped/trimmed lists', () => {
    const vm = buildExposureDetail(full, {
      techniques: [{ techniqueId: 'T1190', name: 'Exploit Public-Facing App' }],
      element: { id: 'c1', name: 'API', type: 'Component' },
      routeJewels: ['Customer DB'],
    })
    expect(vm).toMatchObject({
      id: 'e1',
      name: 'SQL Injection',
      score: 8.5,
      band: 'high', // scoreBand(8.5)
      attackVector: 'NETWORK',
      type: 'Injection',
      category: 'Input Validation',
      provenance: 'USER',
    })
    expect(vm.description).toBe('Unsanitised input reaches the query . See docs.')
    expect(vm.mitigationSuggestions).toEqual(['Parameterise queries', 'Validate input']) // deduped, trimmed, blanks dropped
    expect(vm.detectionMethods).toEqual(['WAF alerts', 'Query log review'])
    expect(vm.tags).toEqual(['owasp-top-10', 'web'])
    expect(vm.techniques).toHaveLength(1)
    expect(vm.element).toEqual({ id: 'c1', name: 'API', type: 'Component' })
  })

  it('carries the crown-jewel route cross-ref', () => {
    const vm = buildExposureDetail(full, { routeJewels: ['Customer DB', 'Secrets Vault'] })
    expect(vm.onCrownJewelRoute).toBe(true)
    expect(vm.routeJewels).toEqual(['Customer DB', 'Secrets Vault'])
    const none = buildExposureDetail(full, {})
    expect(none.onCrownJewelRoute).toBe(false)
    expect(none.routeJewels).toEqual([])
  })

  it('sets honesty flags; mitigations are ALWAYS framed as suggestions, never controls', () => {
    const vm = buildExposureDetail(full)
    expect(vm.hasDescription).toBe(true)
    expect(vm.hasMitigations).toBe(true)
    expect(vm.hasDetection).toBe(true)
    expect(vm.hasReferences).toBe(true)
    expect(vm.hasTags).toBe(true)
    expect(vm.mitigationsAreSuggestions).toBe(true)
  })

  it('degrades gracefully on a thin finding (old snapshot with none of the new fields)', () => {
    const thin = { id: 'e9', name: 'Legacy', score: null }
    const vm = buildExposureDetail(thin)
    expect(vm).toMatchObject({
      id: 'e9',
      name: 'Legacy',
      band: 'unknown', // null score
      provenance: 'SYSTEM', // null createdBy ⇒ SYSTEM (schema legacy note)
      description: null,
      references: null,
    })
    expect(vm.mitigationSuggestions).toEqual([])
    expect(vm.detectionMethods).toEqual([])
    expect(vm.tags).toEqual([])
    expect(vm.hasDescription).toBe(false)
    expect(vm.hasMitigations).toBe(false)
    expect(vm.disposition).toBeNull()
  })

  it('surfaces disposition history (read-only) when the finding is dispositioned', () => {
    const disposed = {
      ...full,
      dispositionKind: 'RISK_ACCEPTED',
      dispositionReason: 'Accepted by owner',
      dispositionedBy: 'alice',
      dispositionedAt: '2026-01-01T00:00:00Z',
      dispositionStale: true,
    }
    const vm = buildExposureDetail(disposed)
    expect(vm.disposition).toMatchObject({
      kind: 'RISK_ACCEPTED',
      reason: 'Accepted by owner',
      by: 'alice',
      at: '2026-01-01T00:00:00Z',
      stale: true,
    })
    expect(typeof vm.disposition.kindLabel).toBe('string')
  })

  it('prefers an already-annotated band/provenance when present (no recompute)', () => {
    const annotated = { ...full, score: 8.5, band: 'critical', provenance: 'SYSTEM' }
    const vm = buildExposureDetail(annotated)
    expect(vm.band).toBe('critical') // trusts the annotation rather than scoreBand(8.5)='high'
    expect(vm.provenance).toBe('SYSTEM')
  })
})
