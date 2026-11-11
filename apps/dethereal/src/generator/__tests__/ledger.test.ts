import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
import { FIXTURE_WORKFLOW, PKG_ROOT } from '../cli.js'
import { generate } from '../index.js'
import {
  autoPlace,
  BASELINE_FILE,
  type Baseline,
  checkLedgers,
  computeBaseline,
  consumerOutputs,
  derivedConsumers,
  findAnchor,
  gitBlobId,
  initLedger,
  type LedgerInput,
  ledgerFileFor,
  listSources,
  normaliseForMatch,
  parseLedger,
  readLedgerInput,
  renderStandalone,
} from '../ledger.js'
import { lintWorkflow } from '../index.js'
import { legacyNames } from '../ledger.js'
import { extractRules } from '../rules.js'
import { readWorkflow } from '../source.js'
import { claudeTarget } from '../targets/claude/index.js'

// These tests generate or walk the whole package workflow; under a full parallel run that can take
// longer than the default per-test timeout.
vi.setConfig({ testTimeout: 60_000 })

const SOURCE = 'skills/legacy/SKILL.md'
const LEGACY = [
  '---',
  'name: legacy',
  'description: the prose a fixture workflow was migrated from',
  '---',
  '',
  'Agents cannot talk to the operator.',
  '',
  '1. Survey the fixture and reply with the marker line.',
  '2. Guess the marker when unsure.',
  '',
].join('\n')
const RULES = extractRules(LEGACY)
const [talk, survey, guess] = RULES as [(typeof RULES)[0], (typeof RULES)[0], (typeof RULES)[0]]

const workflow = readWorkflow(FIXTURE_WORKFLOW)
const claudeOutputs = consumerOutputs(
  generate({ pkg: { name: 'p', version: '1.0.0' }, workflowDir: FIXTURE_WORKFLOW, harness: 'claude' }),
  claudeTarget,
  workflow,
)

const placedTalk = { id: talk.id, line: talk.line, anchor: 'Agents cannot talk to the operator', destination: 'shared/protocols.md', consumers: ['skill:orchestrate'] }
const placedSurvey = { id: survey.id, line: survey.line, anchor: 'survey the **fixture** and reply', destination: 'skills/orchestrate/SKILL.md', consumers: ['skill:orchestrate', 'agent:lead'], harnesses: ['claude'] }
const droppedGuess = { id: guess.id, line: guess.line, dropped: { reason: 'Contradicts the fail-closed rule; guessing is never allowed.', ref: 'shared/protocols.md' } }

function ledger(rules: unknown[], extra: Record<string, unknown> = {}) {
  return stringify({ source: SOURCE, blob: gitBlobId(LEGACY), migrated: true, rules, ...extra })
}

function input(ledgerYaml: string | undefined, overrides: Partial<LedgerInput> = {}): LedgerInput {
  return {
    baseline: computeBaseline(new Map([[SOURCE, LEGACY]])),
    ledgers: new Map(ledgerYaml === undefined ? [] : [[ledgerFileFor(SOURCE), ledgerYaml]]),
    sources: new Map([[SOURCE, LEGACY]]),
    workflow,
    outputs: { claude: claudeOutputs },
    standalone: { claude: renderStandalone(workflow, claudeTarget) },
    ...overrides,
  }
}

const messages = (i: LedgerInput) => checkLedgers(i).findings.map((f) => f.message)

describe('ledger check', () => {
  it('passes when every rule is placed in its consumers or dropped with a reason', () => {
    const report = checkLedgers(input(ledger([placedTalk, placedSurvey, droppedGuess])))
    expect(report.findings).toEqual([])
    // talk: 1 consumer × 3 harnesses, 2 without a target; survey: claude only.
    expect(report.counts).toEqual({ placed: 2, dropped: 1, pending: 0, unchecked: 2, unconsumed: 0 })
  })

  it('derives consumers from the include graph when none are given', () => {
    const derived = { ...placedTalk, consumers: undefined }
    const report = checkLedgers(input(ledger([derived, placedSurvey, droppedGuess])))
    expect(report.findings).toEqual([])
    expect(derivedConsumers(workflow).get('shared/protocols.md')).toEqual(['skill:orchestrate'])
    expect(derivedConsumers(workflow).get('shared/steps.md')).toEqual(['skill:orchestrate'])
    expect(derivedConsumers(workflow).get('shared/reference.md')).toEqual(['skill:guide'])
    expect(derivedConsumers(workflow).get('agents/lead.md')).toEqual(['agent:lead'])
  })

  it('counts an include only for the harnesses whose filtering keeps it', () => {
    const gated = new Map(workflow)
    gated.set('shared/only-claude.md', 'Claude only here.\n')
    const lead = workflow.get('agents/lead.md')!
    gated.set('agents/lead.md', `${lead}\n{{#harness claude}}\n{{include shared/only-claude.md}}\n{{/harness}}\n`)
    expect(derivedConsumers(gated).get('shared/only-claude.md')).toEqual(['agent:lead'])
    expect(derivedConsumers(gated, 'claude').get('shared/only-claude.md')).toEqual(['agent:lead'])
    expect(derivedConsumers(gated, 'codex').get('shared/only-claude.md')).toBeUndefined()
  })

  it('holds a rule whose destination nothing includes yet to the destination rendered alone', () => {
    const lonely = new Map(workflow)
    lonely.set('shared/lonely.md', 'Agents cannot talk to the operator, here either.\n')
    const rule = { ...placedTalk, consumers: undefined, destination: 'shared/lonely.md' }
    const standalone = { claude: renderStandalone(lonely, claudeTarget) }
    const ok = checkLedgers(input(ledger([rule, placedSurvey, droppedGuess]), { workflow: lonely, standalone }))
    expect(ok.findings).toEqual([])
    expect(ok.counts.unconsumed).toBe(1)
    const missing = { ...rule, anchor: 'a phrase that is not there' }
    expect(messages(input(ledger([missing, placedSurvey, droppedGuess]), { workflow: lonely, standalone }))).toEqual([
      `rule ${talk.id}: anchor "a phrase that is not there" is missing from shared/lonely.md for claude`,
    ])
  })

  it('reports an anchor missing from a consumer, per harness', () => {
    const wrong = { ...placedTalk, consumers: ['skill:orchestrate', 'skill:status'] }
    expect(messages(input(ledger([wrong, placedSurvey, droppedGuess])))).toEqual([
      `rule ${talk.id}: anchor "Agents cannot talk to the operator" is missing from skill:status for claude`,
    ])
  })

  it('reports unknown consumers and destinations', () => {
    const badDestination = { ...placedTalk, destination: 'shared/none.md' }
    expect(messages(input(ledger([badDestination, placedSurvey, droppedGuess])))).toEqual([
      `rule ${talk.id}: destination shared/none.md is not a workflow file`,
    ])
    const badConsumer = { ...placedTalk, consumers: ['skill:ghost'] }
    expect(messages(input(ledger([badConsumer, placedSurvey, droppedGuess])))).toEqual([`rule ${talk.id}: no consumer skill:ghost in the workflow`])
  })

  it('refuses pending rules once the source is marked migrated, and allows them before', () => {
    const pending = { id: guess.id, line: guess.line }
    expect(messages(input(ledger([placedTalk, placedSurvey, pending])))).toEqual([`rule ${guess.id} is neither placed nor dropped`])
    expect(messages(input(ledger([placedTalk, placedSurvey, pending], { migrated: false })))).toEqual([])
  })

  it('requires the ledger to list exactly the rules of the source', () => {
    const found = messages(input(ledger([placedTalk, droppedGuess, { id: 'abcdef0123', line: 99 }])))
    expect(found).toHaveLength(2)
    expect(found[0]).toContain(`missing 1: ${survey.id}@${survey.line}`)
    expect(found[0]).toContain('unknown 1: abcdef0123@99')
    expect(found[1]).toBe('rule abcdef0123 is neither placed nor dropped')
  })

  it('checks the ledger and the tree against the baseline', () => {
    const edited = `${LEGACY}One more rule.\n`
    const changed = messages(input(ledger([placedTalk, placedSurvey, droppedGuess]), { sources: new Map([[SOURCE, edited]]) }))
    expect(changed).toContain(`${SOURCE} changed since the baseline; re-run the baseline`)
    const newSource = messages(input(undefined, { sources: new Map([[SOURCE, LEGACY], ['agents/new.md', 'Text.']]) }))
    expect(newSource).toEqual(['agents/new.md is not in the baseline; re-run the baseline'])
    const staleBlob = messages(input(ledger([placedTalk, placedSurvey, droppedGuess], { blob: '0'.repeat(40) })))
    expect(staleBlob).toEqual(['blob differs from the baseline; re-run the ledger init for this source'])
  })

  it('requires a completed ledger for a source that is gone, and then checks the count', () => {
    const gone = { sources: new Map<string, string>() }
    expect(messages(input(undefined, gone))).toEqual([`${SOURCE} is gone but its ledger is missing or not migrated`])
    expect(messages(input(ledger([placedTalk, placedSurvey, droppedGuess]), gone))).toEqual([])
    expect(messages(input(ledger([placedTalk, placedSurvey]), gone))).toEqual(['2 rules, but the baseline counted 3'])
  })

  it.each([
    [{ ...droppedGuess, dropped: { reason: 'short', ref: 'x' } }, 'dropped needs a reason of at least 10 characters'],
    [{ ...droppedGuess, dropped: { reason: 'A long enough reason here.', ref: '' } }, 'dropped needs a ref'],
    [{ ...placedTalk, anchor: 'two words' }, 'anchor must be a phrase of at least 3 words'],
    [{ ...placedTalk, consumers: ['orchestrate'] }, 'consumers, when given, must be a non-empty list'],
    [{ ...placedTalk, harnesses: ['gemini'] }, 'harnesses must list claude, codex, opencode'],
    [{ ...placedTalk, dropped: droppedGuess.dropped }, 'is both placed and dropped'],
    [{ ...placedTalk, note: 'x' }, 'unknown key note'],
  ])('rejects a malformed rule (%#)', (rule, message) => {
    const found = parseLedger('f.yaml', ledger([rule])).findings.map((f) => f.message).join('\n')
    expect(found).toContain(message)
  })

  it('puts each ledger in the file named after its source', () => {
    expect(ledgerFileFor('skills/threat-model/SKILL.md')).toBe('skills-threat-model.yaml')
    expect(ledgerFileFor('agents/model-reviewer.md')).toBe('agents-model-reviewer.yaml')
    expect(ledgerFileFor('docs/guidelines-core.md')).toBe('docs-guidelines-core.yaml')
    const misplaced = checkLedgers({ ...input(undefined), ledgers: new Map([['agents-other.yaml', ledger([placedTalk, placedSurvey, droppedGuess])]]) })
    expect(misplaced.findings.map((f) => f.message)).toContain(`the ledger of ${SOURCE} belongs in skills-legacy.yaml`)
  })

  it('matches anchors ignoring case, whitespace, backticks and emphasis', () => {
    expect(normaliseForMatch('Call  `the Tool`\n**now**')).toBe('call the tool now')
  })
})

describe('auto-placement', () => {
  it('anchors a rule that survived verbatim on its longest harness-neutral run of words', () => {
    const rule = 'Call `mcp__plugin_dethereal_dethereal__validate_model_json` after every write to the model files, then report the result.'
    const rendered = 'Call `mcp__dethereal__validate_model_json` after every write to the model files, then report the result.'
    expect(findAnchor(rule, [rendered])).toBe('after every write to the model files, then report the result.')
  })

  it('leaves a rewritten rule alone, and never anchors on a short common phrase', () => {
    expect(findAnchor('Guess the marker when you are unsure about which one applies.', ['Ask when you are unsure.'])).toBeUndefined()
    expect(findAnchor('Keep the operator in the loop.', ['keep the operator informed'])).toBeUndefined()
    expect(findAnchor('Never guess.', ['never guess.'])).toBeUndefined()
  })

  it('places only pending rules and reports how many it placed', () => {
    const pendingDoc = parseLedger('f', initLedger(SOURCE, LEGACY).yaml).doc!
    const withDrop = { ...pendingDoc, rules: pendingDoc.rules.map((r) => (r.id === guess.id ? droppedGuess : r)) }
    const { doc, placed } = autoPlace(withDrop, LEGACY, 'shared/protocols.md', [claudeOutputs.get('skill:orchestrate')!])
    // The survey rule was reworded ("the" → "your marker line"), so it stays pending for a hand placement.
    expect(placed).toBe(1)
    expect(doc.rules.find((r) => r.id === talk.id)).toMatchObject({ anchor: 'Agents cannot talk to the operator.', destination: 'shared/protocols.md' })
    expect(doc.rules.find((r) => r.id === survey.id)).toEqual({ id: survey.id, line: survey.line })
    expect(doc.rules.find((r) => r.id === guess.id)).toEqual(droppedGuess)
  })
})

describe('drop references', () => {
  it('must name a path that exists from the OSS root', () => {
    const drop = { ...droppedGuess }
    const exists = (ref: string) => ref === 'apps/dethereal/src/tools/manifest.ts'
    const ok = { ...drop, dropped: { ...drop.dropped, ref: 'apps/dethereal/src/tools/manifest.ts (model_state)' } }
    const bad = { ...drop, dropped: { ...drop.dropped, ref: 'src/tools/manifest.ts (model_state)' } }
    expect(checkLedgers({ ...input(ledger([placedTalk, placedSurvey, ok])), refExists: exists }).findings).toEqual([])
    expect(messages({ ...input(ledger([placedTalk, placedSurvey, bad])), refExists: exists })).toEqual([
      `rule ${droppedGuess.id}: ref src/tools/manifest.ts does not exist (refs are paths from the OSS root, e.g. apps/dethereal/… or docs/…)`,
    ])
  })
})

describe('ledger init', () => {
  it('lists every rule as pending, then keeps placements across a refresh', () => {
    const first = parseLedger('f', initLedger(SOURCE, LEGACY).yaml).doc!
    expect(first.rules.map((r) => r.id)).toEqual(RULES.map((r) => r.id))
    expect(first.migrated).toBe(false)
    const placed = parseLedger('f', ledger([placedTalk, placedSurvey, droppedGuess])).doc!
    const edited = LEGACY.replace('2. Guess the marker when unsure.', '2. Ask when unsure.')
    const { yaml, removed } = initLedger(SOURCE, edited, placed)
    const refreshed = parseLedger('f', yaml).doc!
    expect(removed).toEqual([guess.id])
    expect(refreshed.rules[0]).toEqual(placedTalk)
    expect(refreshed.rules[2]).toEqual({ id: extractRules(edited)[2]!.id, line: 9 })
    expect(refreshed.blob).toBe(gitBlobId(edited))
  })
})

describe('the real tree', () => {
  // Generating every harness's bundle for the check is the slow part: it runs once, for the tests that read it.
  let report: ReturnType<typeof checkLedgers>
  beforeAll(() => {
    report = checkLedgers(readLedgerInput(PKG_ROOT, JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'))))
  }, 180_000)

  it('keeps a complete, migrated ledger for every source in the baseline, the sources themselves gone', () => {
    const baseline = JSON.parse(readFileSync(path.join(PKG_ROOT, BASELINE_FILE), 'utf8')) as Baseline
    expect(listSources(PKG_ROOT)).toEqual([])
    const sources = Object.entries(baseline.sources)
    expect(sources.length).toBeGreaterThanOrEqual(20)
    for (const [source, entry] of sources) {
      const file = ledgerFileFor(source)
      const doc = parseLedger(file, readFileSync(path.join(PKG_ROOT, 'src/generator/ledger', file), 'utf8')).doc!
      expect(doc.migrated, source).toBe(true)
      expect(doc.blob, source).toBe(entry.blob)
      expect(doc.rules.length, source).toBe(entry.rules)
      expect(doc.rules.every((r) => 'anchor' in r || 'dropped' in r), source).toBe(true)
    }
  })

  it('has no ledger findings', () => {
    expect(report.findings).toEqual([])
  })

  it('has a completed ledger for every migrated source', () => {
    for (const doc of ['guidelines-core', 'guidelines-layout', 'guidelines-schema', 'guidelines-examples', 'controls-enrichment']) {
      const file = path.join(PKG_ROOT, 'src/generator/ledger', `docs-${doc}.yaml`)
      const parsed = parseLedger(`docs-${doc}.yaml`, readFileSync(file, 'utf8')).doc!
      expect(parsed.migrated, doc).toBe(true)
      expect(parsed.rules.every((r) => 'anchor' in r || 'dropped' in r), doc).toBe(true)
    }
  })

  it('has a lint-clean workflow, referencing only skills and agents that exist somewhere', () => {
    expect(lintWorkflow(readWorkflow(path.join(PKG_ROOT, 'workflow')), undefined, legacyNames(PKG_ROOT))).toEqual([])
  })
})
