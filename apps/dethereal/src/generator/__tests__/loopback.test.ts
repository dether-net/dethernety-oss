/**
 * A loop back from the failed Gate 3 re-enters enrichment as a concrete phase entry, on every
 * harness: a run that only re-checks the gates after the operator's facts never fills the gaps
 * the source could have filled.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PACKAGE_GOLDENS } from '../cli.js'

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    return statSync(p).isDirectory() ? filesUnder(p) : /\.(md|toml)$/.test(name) ? [p] : []
  })
}

describe('the loop back from Gate 3', () => {
  it.each(['claude', 'codex', 'opencode'])('%s: enters enrich with the gates report\'s loop-back worklist, and does not just re-run the gates', (harness) => {
    const text = filesUnder(path.join(PACKAGE_GOLDENS, harness)).map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(text).toContain("Then enter `enrich` at once (Enter a phase, in the skill), before any other call, with the gates report's `gate3.loopback` as its worklist")
    expect(text).toContain("`loop back` enters `enrich` with the gates report's `gate3.loopback` as its worklist")
    expect(text).toMatch(/the last gates report's `gate3\.loopback` \(with Gate 3 `NOT_COMPUTED`, its `gate3\.loop_back\.untouched`, the same shape\) comes first: each of its `elements` with exactly its `fields`/)
    expect(text).toMatch(/name its `not_enrichable` entries and their reasons to the operator, never send them to the agent/)
    // the loop-back bullet itself no longer ends in a re-check of the gates (a waiver still does)
    const bullet = text.split('\n').filter((l) => l.startsWith('- **loop back**'))
    expect(bullet.length).toBeGreaterThan(0)
    for (const l of bullet) expect(l).not.toContain('then run the gates again')
  })

  it.each(['claude', 'codex', 'opencode'])('%s: the skill text itself names the delegation as the next call after the loop back', (harness) => {
    // the skill text is sent again on every invocation; a phase file read hours earlier is not, and is not followed
    const skill = filesUnder(path.join(PACKAGE_GOLDENS, harness)).filter((f) => /threat-model\/SKILL\.md$/.test(f))
    expect(skill).toHaveLength(1)
    const text = readFileSync(skill[0]!, 'utf8').replace(/\s+/g, ' ')
    expect(text).toContain("After a loop back from `gate3-loopback`, `--phase enrich` takes up Step 8 at once: after the reads and the state, your next call is Step 8's delegation (its item 1) — even when you think nothing more can be answered.")
    // the full rule is Step 8's first paragraph, read on that re-entry
    const enrich = filesUnder(path.join(PACKAGE_GOLDENS, harness)).filter((f) => /threat-model\/guided-enrich\.md$/.test(f))
    expect(enrich).toHaveLength(1)
    const step8 = readFileSync(enrich[0]!, 'utf8').replace(/\s+/g, ' ')
    expect(step8).toMatch(/After a loop back from `gate3-loopback`, `--phase enrich` takes up Step 8 at once: after the reads and the state, your next call is Step 8's delegation to the \S+ agent with the last gates report's `gate3.loopback` as its worklist/)
    expect(step8).toContain('Delegate even when you think nothing more can be answered: the agent decides that from the source, and each field it cannot settle is asked in the relay.')
  })

  it.each(['claude', 'codex', 'opencode'])('%s: the loop is opened before the operator\'s values are set, so they count as changes', (harness) => {
    const text = filesUnder(path.join(PACKAGE_GOLDENS, harness)).map((f) => readFileSync(f, 'utf8')).join('\n')
    const bullets = text.split('\n').filter((l) => l.startsWith('- **loop back**'))
    expect(bullets.length).toBeGreaterThan(0)
    for (const l of bullets) {
      const arm = l.indexOf("with only `action: 'loop_back'`")
      expect(arm, l).toBeGreaterThan(0)
      expect(l.indexOf('write it to the file that holds the field')).toBeGreaterThan(arm)
      expect(l).toContain('first, before any write or Skill call')
    }
  })

  it.each(['claude', 'codex', 'opencode'])('%s: a Gate 3 the loop holds back has a way out, and a drop carries only the operator\'s words', (harness) => {
    const files = filesUnder(path.join(PACKAGE_GOLDENS, harness))
    const text = files.map((f) => readFileSync(f, 'utf8')).join('\n').replace(/\s+/g, ' ')
    expect(text).toContain('### When Gate 3 is not computed')
    expect(text).toContain('Never open the loop again here, and never ask `review-record`, `gate3-loopback` or a waiver question')
    expect(text).toContain('never a row from an earlier round\'s declines')
    expect(text).toContain('Never write a reason yourself, and never drop to get past this.')
    expect(text).toContain('is never fixed by rewording: show the refusal and ask that row again')
    expect(text).toContain('a dropped element still fails it: a drop is not a waiver')
    expect(text).toContain('Show `loop_back_round` once, right after the verdict line')
    // the server's loop_back_round statuses, as its Outcome type names them (src/utils/loop-back.ts)
    expect(text).toContain("(`changed`, `removed`, `not_listed` — no longer on Gate 3's list, so now passing — `waived` or `dropped`)")
    expect(text).not.toContain('`passing`')
    expect(text).toContain('A `NOT_COMPUTED` Gate 3 is neither a pass nor a fail: its criteria are unknown.')
    // the reviewer reads the gates but never ends a loop
    const reviewer = files.filter((f) => /model-reviewer\.(md|toml)$/.test(f))
    expect(reviewer).toHaveLength(1)
    const r = readFileSync(reviewer[0]!, 'utf8')
    expect(r).toContain('NOT_COMPUTED')
    expect(r).not.toMatch(/drop_remaining|drop: \[|action: 'loop_back'/)
  })
})
