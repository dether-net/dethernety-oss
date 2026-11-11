import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain JavaScript release script, without type declarations
import { listedSkills } from '../../scripts/smoke-codex.mjs'

describe('the Codex smoke script', () => {
  it('reads the namespaced skills from prompt-input, each with its own SKILL.md', () => {
    const text = [
      '## Skills',
      '- skill-installer: Install skills (file: r0/skill-installer/SKILL.md)',
      '- dethereal:add: Add components, boundaries (and flows) to a model (file: r1/add/SKILL.md)',
      '- dethereal:status: Show the status (file: /cache/dethereal-local/dethereal/0.5.0/skills/status/SKILL.md)',
      '- dethereal:view: points elsewhere (file: r1/other/SKILL.md)',
    ].join('\n')
    const stdout = JSON.stringify([{ type: 'message', content: [{ type: 'input_text', text }] }])
    expect([...listedSkills(stdout)].sort()).toEqual(['add', 'status'])
    expect(listedSkills('not json').size).toBe(0)
  })
})
