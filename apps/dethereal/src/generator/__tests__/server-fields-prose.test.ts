/**
 * The workflow reads what the server decides instead of deciding it by hand: the
 * sync record is only ever written by the tools, readiness and the review's
 * standing come from workspace_status with words for every blocker it can give,
 * the crossing flows and their authentication come from the coverage output,
 * and the drifted controls are named from the tool's list.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const pkg = path.resolve(__dirname, '../../..')
const workflow = path.join(pkg, 'workflow')
const read = (rel: string) => readFileSync(path.join(workflow, rel), 'utf8')

function workflowFiles(dir = workflow): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...workflowFiles(p))
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}

/** The members of a string-literal union type declared in a source file. */
function unionMembers(file: string, type: string): string[] {
  const src = readFileSync(path.join(pkg, file), 'utf8')
  const m = new RegExp(`export type ${type} = ([^\\n]+)`).exec(src)
  if (!m) throw new Error(`${type} not found in ${file}`)
  return [...m[1]!.matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]!)
}

describe('the workflow reads what the server decides', () => {
  it('never writes, rebuilds or diffs against a hand-made sync record or a temporary export', () => {
    for (const file of workflowFiles()) {
      const text = readFileSync(file, 'utf8')
      const rel = path.relative(workflow, file)
      // A line may say the tools write it, or forbid writing it; none may tell the model to.
      const instructs = text.split('\n').filter((l) => /\b(write|rebuild|reconstruct)[^.\n]{0,40}\.dethereal\/sync\.json/i.test(l) && !/\bnever\b|tools write/i.test(l))
      expect(instructs, rel).toEqual([])
      expect(text, rel).not.toMatch(/to a temporary directory/i)
    }
  })

  it('review shows readiness and a claimed review from workspace_status, with words for every blocker', () => {
    const review = read('skills/review/SKILL.md')
    expect(review).toMatch(/\{\{tool:workspace_status\}\} with `directory_path`/)
    expect(review).toMatch(/`readiness`/)
    expect(review).toMatch(/`displayState`/)
    expect(review).toMatch(/REVIEWED no longer holds/)
    expect(review).not.toMatch(/\*\*Partial\*\*/)
    const blockers = new Set([
      ...unionMembers('src/tools/workspace-status.tool.ts', 'ReadinessBlocker'),
      ...unionMembers('src/tools/workspace-status.tool.ts', 'ReviewBlocker'),
    ])
    expect(blockers.size).toBeGreaterThan(5)
    for (const b of blockers) expect(review, b).toContain(`| \`${b}\``)
  })

  it('surface takes the crossing flows and their authentication from the coverage output', () => {
    const surface = read('skills/surface/SKILL.md')
    expect(surface).toMatch(/`formal_coverage\.cross_boundary_flows`/)
    expect(surface).toMatch(/cross_boundary_flows_total/)
    expect(surface).toMatch(/`formal_coverage\.labels\.cross_boundary`/)
    // No flow attribute named `authentication` is ever written; the server's classification is read instead.
    expect(surface).not.toMatch(/authenticated \(`authentication`\)/)
    expect(surface).toMatch(/never from memory/)
  })

  it('status names the drifted controls from the tool, never by hand', () => {
    expect(read('skills/status/SKILL.md')).toMatch(/`driftedControls`/)
  })
})
