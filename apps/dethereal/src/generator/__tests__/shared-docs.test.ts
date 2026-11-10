import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PKG_ROOT } from '../cli.js'

const shared = (name: string) => readFileSync(path.join(PKG_ROOT, 'workflow', 'shared', name), 'utf8')

describe('guidelines-core', () => {
  const body = shared('guidelines-core.md')

  it('carries the frozen zone enum → display-name table, the single rendering source', () => {
    expect(body).toMatch(/`UNTRUSTED`.*Open internet/)
    expect(body).toMatch(/`PUBLIC`.*Internet-facing/)
    expect(body).toMatch(/`EXPOSED`.*DMZ/)
    expect(body).toMatch(/`INTERNAL`.*Internal/)
    expect(body).toMatch(/`RESTRICTED`.*Restricted/)
    expect(body).toMatch(/`VENDOR`.*Trusted external/)
    expect(body).toMatch(/approved channel/)
    // The zoning cascade is a pointer to the tool, not inlined.
    expect(body).toMatch(/action:'zoning'/)
  })

  it('stays within its 9000-byte budget: it is inlined into every skill that models', () => {
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(9000)
  })

  it('sends every state change through the state tool', () => {
    expect(body).toContain('{{tool:model_state}}')
    expect(body).toContain('{{tool:model_state_waive}}')
    expect(body).not.toMatch(/readiness threshold/i)
  })
})

describe('tiers', () => {
  const body = shared('tiers.md')

  it('defines the three tiers in the order they are assigned, with externals excluded', () => {
    const t1 = body.indexOf('**Tier 1** — internet-facing')
    const t2 = body.indexOf('**Tier 2** — crown-jewel-bearing or restricted')
    const t3 = body.indexOf('**Tier 3** — everything else')
    expect(t1).toBeGreaterThan(0)
    expect(t2).toBeGreaterThan(t1)
    expect(t3).toBeGreaterThan(t2)
    expect(body).toContain('External entities are never tiered')
    expect(body).toContain('the **first** tier it qualifies for')
  })

  it('counts only declared or inherited zones and carries the numbering note', () => {
    expect(body).toMatch(/Zones proposed by .* never count/)
    expect(body).toContain('Older guidance numbered internet-facing components **Tier 3**')
    expect(body).toContain('**depth levels**')
  })
})
