import { describe, expect, it } from 'vitest'
import { FIXTURE_WORKFLOW } from '../cli.js'
import { generateFromSource, lintWorkflow } from '../index.js'
import { parseRegistry, REGISTRY_FILE } from '../registry.js'
import { readWorkflow } from '../source.js'
import { agentAsk } from '../tokens.js'

const pkg = { name: '@dether.net/dethereal', version: '1.2.3' }
const fixture = readWorkflow(FIXTURE_WORKFLOW)
const registry = fixture.get(REGISTRY_FILE)!

function variant(changes: Record<string, string | undefined>): Map<string, string> {
  const source = new Map(fixture)
  for (const [p, content] of Object.entries(changes)) {
    if (content === undefined) source.delete(p)
    else source.set(p, content)
  }
  return source
}

const messages = (changes: Record<string, string | undefined>, external?: { skills?: string[] }) =>
  lintWorkflow(variant(changes), undefined, external ? { skills: new Set(external.skills ?? []), agents: new Set<string>() } : undefined)
    .filter((f) => f.rule === 'registry')
    .map((f) => f.message)

const entry = (id: string, extra = '') =>
  `  - id: ${id}\n    skill: orchestrate\n    mandatory: true\n    when: w\n    after: a\n    decides: d\n${extra || '    options: [yes, no]\n'}`

describe('the prompt registry', () => {
  it('is silent on the fixture, whose every question is registered and asked by its owner', () => {
    expect(messages({})).toEqual([])
  })

  it('fires on a question that is not registered', () => {
    const skill = fixture.get('skills/orchestrate/SKILL.md')!
    expect(messages({ 'skills/orchestrate/SKILL.md': `${skill}\n{{#ask id=extra}}More? (yes / no){{/ask}}\n` })).toEqual([
      `question extra is not registered in ${REGISTRY_FILE}`,
    ])
  })

  it('fires on a registered question that nothing asks', () => {
    expect(messages({ [REGISTRY_FILE]: `${registry}${entry('orphan')}` })).toEqual(['registered question orphan is asked nowhere in the workflow'])
  })

  it('holds a question as pending while its owner is not in the workflow yet', () => {
    const pending = entry('later').replace('skill: orchestrate', 'skill: legacy')
    expect(messages({ [REGISTRY_FILE]: `${registry}${pending}` }, { skills: ['legacy'] })).toEqual([])
  })

  it('fires when the question is missing a required phrase, or its kind differs from the entry', () => {
    const changed = registry.replace('requires: ["Keep the survey"]', 'requires: ["Keep the survey", "as reported by the scout"]').replace('options: [keep, redo]', 'free_text: true')
    expect(messages({ [REGISTRY_FILE]: changed })).toEqual([
      'question survey-confirm is a choice here but registered as free text',
      'question survey-confirm must contain "as reported by the scout"',
    ])
  })

  it('meets a phrase of alternatives with any one of them, and fires when the question holds none', () => {
    const met = registry.replace('requires: ["Keep the survey"]', 'requires: ["Throw the survey | Keep the survey"]')
    expect(messages({ [REGISTRY_FILE]: met })).toEqual([])
    const unmet = registry.replace('requires: ["Keep the survey"]', 'requires: ["Throw the survey | Burn the survey"]')
    expect(messages({ [REGISTRY_FILE]: unmet })).toEqual(['question survey-confirm must contain "Throw the survey | Burn the survey"'])
  })

  it('fires on an owner that is no skill, and is silent on one not yet in the workflow', () => {
    const changed = registry.replace('skill: orchestrate\n    mandatory: false', 'skill: legacy\n    mandatory: false')
    expect(messages({ [REGISTRY_FILE]: changed })).toEqual(['question survey-notes: no skill named legacy'])
    expect(messages({ [REGISTRY_FILE]: changed }, { skills: ['legacy'] })).toEqual([])
  })

  it('fires when the owner never reaches its question', () => {
    const changed = registry.replace('skill: orchestrate\n    mandatory: false', 'skill: status\n    mandatory: false')
    expect(messages({ [REGISTRY_FILE]: changed })).toEqual(['question survey-notes is owned by status, which never asks it'])
  })

  it('reads the question groups and rejects a malformed one', () => {
    const base = 'prompts:\n' + entry('a') + entry('b')
    const good = parseRegistry(base + 'groups:\n  - name: pair\n    harnesses: [claude]\n    members: [a, b]\n')
    expect(good.findings).toEqual([])
    expect(good.groups).toEqual([{ name: 'pair', harnesses: ['claude'], members: ['a', 'b'] }])
    const bad = parseRegistry(base + 'groups:\n  - name: Pair\n    harnesses: [vscode]\n    members: [a, a, c]\n    size: 2\n')
    expect(bad.findings.map((f) => f.message)).toEqual([
      'group 1 (Pair): unknown key size',
      'group 1 (Pair): name must be lowercase words joined by hyphens',
      'group 1 (Pair): harnesses must be one or more of claude, codex, opencode',
      'group 1 (Pair): members must be 1 to 4 distinct question ids',
      'group 1 (Pair): c is not a registered question',
    ])
    expect(parseRegistry(base + 'other: 1\n').findings.map((f) => f.message)).toEqual(['must be a mapping with a `prompts` list and, optionally, a `groups` list'])
    const twice = parseRegistry(base + 'groups:\n  - name: one\n    harnesses: [claude]\n    members: [a]\n    repeat: 3\n  - name: one\n    harnesses: [claude]\n    members: [a, b]\n    repeat: 2\n')
    expect(twice.findings.map((f) => f.message)).toEqual([
      'group 2 (one): name registered twice',
      'group 2 (one): a is in another group too',
      'group 2 (one): repeat is 2 to 4, for a group of one member',
    ])
    expect(twice.groups[0]).toEqual({ name: 'one', harnesses: ['claude'], members: ['a'], repeat: 3 })
  })

  it('rejects malformed entries', () => {
    const parsed = parseRegistry('prompts:\n  - id: Bad_Id\n    skill: x\n    mandatory: yes\n    when: ""\n    after: a\n    decides: d\n    options: [only]\n    extra: 1\n')
    expect(parsed.findings.map((f) => f.message)).toEqual([
      'prompt 1 (Bad_Id): unknown key extra',
      'prompt 1 (Bad_Id): id must be lowercase words joined by hyphens',
      'prompt 1 (Bad_Id): mandatory must be true or false',
      'prompt 1 (Bad_Id): when must be a non-empty string',
      'prompt 1 (Bad_Id): options must list at least two answers',
      'prompt 1 (Bad_Id): give either options (a closed answer set) or free_text: true',
    ])
    expect(parseRegistry('prompts:\n  - id: a\n' + entry('a').split('\n').slice(1).join('\n') + '  - id: a\n' + entry('a').split('\n').slice(1).join('\n')).findings.map((f) => f.message)).toContain(
      'prompt 2 (a): id registered twice',
    )
  })

  it('marks a choice that follows a table, and rejects the mark on free text or without a table named', () => {
    const tabled = registry.replace("after: the scout's marker line and the include marker", "after: the scout's survey table").replace('requires: ["Keep the survey"]', 'requires: ["Keep the survey"]\n    table: true')
    expect(messages({ [REGISTRY_FILE]: tabled })).toEqual([])
    expect(parseRegistry(tabled).entries.find((e) => e.id === 'survey-confirm')?.table).toBe(true)
    const noTable = registry.replace('requires: ["Keep the survey"]', 'requires: ["Keep the survey"]\n    table: true')
    expect(parseRegistry(noTable).findings.map((f) => f.message)).toEqual(['prompt 1 (survey-confirm): table: true, but what it follows (after) names no table'])
    const onText = parseRegistry('prompts:\n' + entry('t', '    free_text: true\n    table: true\n').replace('after: a', 'after: a table'))
    expect(onText.findings.map((f) => f.message)).toEqual(['prompt 1 (t): a free-text question is a plain message that carries its table; table applies to choices only'])
    const unmarked = registry.replace("after: the scout's marker line and the include marker", "after: the scout's survey table")
    expect(parseRegistry(unmarked).findings.map((f) => f.message)).toEqual(['prompt 1 (survey-confirm): what it follows (after) names a table, so it needs table: true'])
  })

  it('marks a choice asked in one message, never on free text or with a table mark, and lays out each ask', async () => {
    const { askLayoutsOf } = await import('../registry.js')
    const asked = registry.replace('requires: ["Keep the survey"]', 'requires: ["Keep the survey"]\n    message: true')
    expect(messages({ [REGISTRY_FILE]: asked })).toEqual([])
    expect(parseRegistry(asked).entries.find((e) => e.id === 'survey-confirm')?.message).toBe(true)
    expect(askLayoutsOf(asked).get('survey-confirm')).toBe('message')
    expect(askLayoutsOf(registry).get('survey-confirm')).toBeUndefined()
    const onText = parseRegistry('prompts:\n' + entry('t', '    free_text: true\n    message: true\n'))
    expect(onText.findings.map((f) => f.message)).toEqual(['prompt 1 (t): a free-text question is a plain message already; message applies to choices only'])
    const both = parseRegistry('prompts:\n' + entry('t', '    options: [yes, no]\n    table: true\n    message: true\n').replace('after: a', 'after: a table'))
    expect(both.findings.map((f) => f.message)).toEqual(['prompt 1 (t): give table or message, not both: message already asks in one message'])
    const notTrue = parseRegistry('prompts:\n' + entry('t', '    options: [yes, no]\n    message: false\n'))
    expect(notTrue.findings.map((f) => f.message)).toEqual(['prompt 1 (t): message, when given, must be true'])
  })

  it('is required once the workflow asks anything', () => {
    expect(messages({ [REGISTRY_FILE]: undefined })).toEqual([`missing, but the workflow asks 2 question(s)`])
  })
})

describe('questions inside agents', () => {
  it('stop the agent with the question as its final message, for the caller to put to the operator verbatim', () => {
    const text = agentAsk('pick', 'Which one?')
    for (const phrase of [
      '`[prompt: pick]` Which one?',
      'as your final message, and stop',
      'write nothing this question decides',
      'Put this question to the operator exactly as written. Do not answer it yourself.',
      'tagged `[answer: pick]`',
      "Only the operator's own words answer it",
      'a paraphrase such as "the user agreed" does not',
    ]) {
      expect(text).toContain(phrase)
    }
  })

  it('render that form in every harness, and never the skill form', () => {
    const lead = fixture.get('agents/lead.md')!
    const source = variant({
      // An agent that asks carries the gate rules (the fixture keeps them in its protocols).
      'agents/lead.md': `${lead}\n{{include shared/protocols.md}}\n\n{{#ask id=survey-notes text}}Anything the survey missed? Say "none" to finish.{{/ask}}\n`,
    })
    for (const harness of ['claude', 'codex', 'opencode'] as const) {
      const out = [...generateFromSource({ pkg, source, harness })].filter(([p]) => /agents\/(dethereal-)?lead\.(md|toml)$/.test(p))
      expect(out).toHaveLength(1)
      const body = out[0]![1]
      expect(body, harness).toContain('[answer: survey-notes]')
      expect(body, harness).not.toMatch(/AskUserQuestion|`question` tool/)
    }
  })

  it('are rejected in a leaf: an agent something delegates to or forks onto', () => {
    const scout = fixture.get('agents/scout.md')!
    const found = lintWorkflow(variant({ 'agents/scout.md': `${scout}\n{{#ask id=survey-notes text}}Anything else?{{/ask}}\n` }))
    expect(found.filter((f) => f.rule === 'token-context').map((f) => f.file)).toEqual(['agents/scout.md'])
  })
})

describe('an agent that asks', () => {
  it('fails generation without the asking and dismissal rules', () => {
    const lead = fixture.get('agents/lead.md')!
    const source = variant({ 'agents/lead.md': `${lead}\n{{#ask id=survey-notes text}}Anything the survey missed?{{/ask}}\n` })
    expect(() => generateFromSource({ pkg, source, harness: 'claude' })).toThrow(/A dismissed question is not answered\./)
  })
})
