import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  askIds,
  backtickedTokens,
  bareToolNames,
  baselineCommits,
  skillTokensInCode,
  claudeLiterals,
  askCues,
  REATTACH_SLICE_CHARS,
  injectedLength,
  optionCounts,
  duplicateParagraphs,
  lintPackage,
  optionLists,
  pendingFileWrites,
  protocolIncludes,
  reviewRecords,
  sizeBudget,
  SKILL_BUDGET,
  stateJsonWrites,
  tokenContexts,
  tokenStore,
  unknownTargets,
  versionLiterals,
} from '../lint.js'
import { askCue } from '../ask-cues.js'
import { scanTokens } from '../tokens.js'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const lines = (findings: ReadonlyArray<{ line: number }>) => findings.map((f) => f.line)

describe('claude-literal', () => {
  it.each([
    'Use the `Read` tool.',
    'Call Bash(ls) first.',
    'Call mcp__plugin_dethereal_dethereal__list_models.',
    'Ask with AskUserQuestion.',
    'Pass subagent_type to spawn it.',
    'Run ${CLAUDE_PLUGIN_ROOT}/x.',
    'Then run /dethereal:sync.',
    'Parse $ARGUMENTS.',
    '@../../docs/guidelines-core.md',
  ])('fires on %s', (line) => {
    expect(lines(claudeLiterals('f.md', line))).toEqual([1])
  })

  it('stays silent on plain English and inside a claude-only block', () => {
    const text = [
      'Read the file, then edit it.',
      '{{#harness claude}}',
      'Use the `Read` tool and AskUserQuestion; parse $ARGUMENTS.',
      '{{/harness}}',
    ].join('\n')
    expect(claudeLiterals('f.md', text)).toEqual([])
  })

  it('fires inside a block that other harnesses also see', () => {
    const text = ['{{#harness claude,codex}}', 'Use the `Read` tool.', '{{/harness}}'].join('\n')
    expect(lines(claudeLiterals('f.md', text))).toEqual([2])
  })
})

describe('token-store', () => {
  it('fires on the store in any spelling, silent otherwise', () => {
    expect(lines(tokenStore('f.md', 'ok\nread tokens.json\n~/.dethernety/tokens\n.dethernety\\tokens'))).toEqual([2, 3, 4])
    expect(tokenStore('f.md', 'The project registry is .dethernety/models.json.')).toEqual([])
  })

  it('scans the non-test tool sources of the package, and finds them', () => {
    expect(lintPackage(pkgRoot)).toEqual([])
  })
})

describe('version-literal', () => {
  it('fires on package versions, silent on other dotted numbers', () => {
    expect(lines(versionLiterals('f.md', 'npx @dether.net/dethereal@0.4.7\ndethereal@1\nsince v0.5.0'))).toEqual([1, 2, 3])
    expect(versionLiterals('f.md', 'schema "2.0.0"; bind 127.0.0.1; TLS 1.2')).toEqual([])
  })
})

describe('bare-tool-name', () => {
  const tools = new Set(['model_state', 'update_attributes'])

  it.each(['Call `model_state` with `get`.', 'Then `update_attributes(file)`.'])('fires on %s', (line) => {
    expect(lines(bareToolNames('f.md', line, tools))).toEqual([1])
  })

  it('is silent on a tool token, an unknown name, and inside a Claude-only block', () => {
    expect(bareToolNames('f.md', 'Call {{tool:model_state}}; set `other_key`.', tools)).toEqual([])
    expect(bareToolNames('f.md', '{{#harness claude}}\nCall `model_state`.\n{{/harness}}', tools)).toEqual([])
    expect(lines(bareToolNames('f.md', '{{#harness claude,codex}}\nCall `model_state`.\n{{/harness}}', tools))).toEqual([2])
  })
})

describe('pending-file-write', () => {
  it.each([
    'Then clear the pending file.',
    'Delete `.dethereal/enrichment-pending.json` once the push succeeds.',
    'The pending file is cleared after the push.',
    'Pending entries get removed once the operator accepts them.',
    'Wipe the pending entries and continue.',
    'Run `rm .dethereal/enrichment-pending.json`.',
    'Run `echo {} > .dethereal/enrichment-pending.json`.',
    'Use `sed -i` on enrichment-pending.json to drop the row.',
    'Then update the pending enrichment file.',
    'Mark the pending rows as accepted.',
    'The pending values are set to confirmed.',
    'Run `git checkout -- .dethereal/enrichment-pending.json`.',
    'Run `cp /dev/null .dethereal/enrichment-pending.json`.',
    'If there is no reply, clear the pending file.',
    'Drop rows not settled from the pending file.',
    'Run `node -e "fs.unlinkSync(\'.dethereal/enrichment-pending.json\')"`.',
    'Run `git stash -- .dethereal/enrichment-pending.json`.',
  ])('fires on %s', (line) => {
    expect(lines(pendingFileWrites('shared/relay.md', line))).toEqual([1])
  })

  it.each([
    'Never write the pending file yourself.',
    'If `.dethereal/enrichment-pending.json` has entries, stop.',
    'Empty attribute fields stay pending (`enrichment-pending.json`).',
    'Rows the operator does not mention stay pending.',
  ])('is silent on %s', (line) => {
    expect(pendingFileWrites('shared/relay.md', line)).toEqual([])
  })

  it('leaves the enrichment protocol and its invariants to describe the writes', () => {
    expect(pendingFileWrites('shared/enrichment-protocol.md', 'Then clear the pending file.')).toEqual([])
    expect(pendingFileWrites('shared/enrichment-invariants.md', 'Append each write to `.dethereal/enrichment-pending.json` first.')).toEqual([])
  })
})

describe('review-record', () => {
  const transition = "Call {{tool:model_state}} with `action: 'transition'`, `to: 'REVIEWED'`."

  it('fires on a transition to REVIEWED with no review-record question in the file', () => {
    expect(lines(reviewRecords('f.md', `Intro.\n${transition}`))).toEqual([2])
    expect(lines(reviewRecords('f.md', 'Call it with `to: "REVIEWED"`.'))).toEqual([1])
  })

  it('catches the JSON and backticked spellings too', () => {
    expect(lines(reviewRecords('f.md', 'Send `{"to": "REVIEWED"}`.'))).toEqual([1])
    expect(lines(reviewRecords('f.md', 'Set `to`: `REVIEWED`.'))).toEqual([1])
  })

  it('is silent when the file asks review-record, or never transitions', () => {
    expect(reviewRecords('f.md', `{{#ask id=review-record}}Record it? (record / not now){{/ask}}\n\n${transition}`)).toEqual([])
    expect(reviewRecords('f.md', 'The state stays ENRICHING; never REVIEWED.')).toEqual([])
  })
})

describe('state-json-write', () => {
  it('fires on a sentence that writes state.json', () => {
    expect(lines(stateJsonWrites('f.md', 'Record progress in `.dethereal/state.json`.'))).toEqual([1])
    expect(lines(stateJsonWrites('f.md', 'Done. Then update state.json with the new state.'))).toEqual([1])
  })

  it('stays silent on reads and on prohibitions', () => {
    expect(stateJsonWrites('f.md', 'Read state.json to find the step.')).toEqual([])
    expect(stateJsonWrites('f.md', 'Never write state.json; use the state tool.')).toEqual([])
  })
})

describe('option-list', () => {
  it('fires on a choice question outside an ask block', () => {
    const text = 'Continue now? (yes / later)'
    expect(lines(optionLists('f.md', text, scanTokens('f.md', text)))).toEqual([1])
  })

  it('stays silent inside an ask block and on non-questions', () => {
    const text = ['{{#ask id=go}}', 'Continue now? (yes / later)', '{{/ask}}', 'It needs (read / write access).'].join('\n')
    expect(optionLists('f.md', text, scanTokens('f.md', text))).toEqual([])
  })
})

describe('backticked-token', () => {
  it('fires when a code span is exactly a token, silent when the token is part of a longer span', () => {
    const text = 'Call `{{tool:x}}`.\nRun `{{cmd:sync}} push`.'
    expect(lines(backtickedTokens('f.md', scanTokens('f.md', text)))).toEqual([1])
  })
})

describe('ask-id', () => {
  it('fires on a repeated id, silent on distinct ones', () => {
    const text = '{{#ask id=a}}x{{/ask}}\n{{#ask id=b}}y{{/ask}}\n{{#ask id=a}}z{{/ask}}'
    expect(askIds('f.md', scanTokens('f.md', text)).map((f) => f.message)).toEqual(['ask id a already used on line 1'])
  })
})

describe('unknown-target', () => {
  const targets = {
    tools: new Set(['list_models']),
    skills: new Set(['sync']),
    agents: new Set(['scout']),
    shared: new Set(['shared/a.md']),
  }

  it('fires on every kind of unknown reference', () => {
    const text = '{{tool:nope}} {{cmd:nope}} {{agent:nope}}\n{{#delegate nope}}x{{/delegate}}\n{{include shared/nope.md}}'
    expect(unknownTargets('f.md', scanTokens('f.md', text), targets).map((f) => f.message)).toEqual([
      'tool nope is not in the tool manifest',
      'no skill named nope',
      'no agent named nope',
      'no agent named nope',
      'no shared file shared/nope.md',
    ])
  })

  it('stays silent on known references', () => {
    const text = '{{tool:list_models}} {{cmd:sync}} {{agent:scout}}\n{{#delegate scout}}x{{/delegate}}\n{{include shared/a.md}}'
    expect(unknownTargets('f.md', scanTokens('f.md', text), targets)).toEqual([])
  })
})

describe('token-context', () => {
  const text = '{{#ask id=q}}Go?{{/ask}}\nFor {{args}}.'
  const scan = scanTokens('f.md', text)

  it('allows questions and arguments in a skill body', () => {
    expect(tokenContexts('f.md', scan, new Set(['skill']))).toEqual([])
  })

  it("rejects a question in a fork or a leaf; a skill's sibling may ask but has no arguments, a fork's sibling neither", () => {
    expect(lines(tokenContexts('f.md', scan, new Set(['fork'])))).toEqual([1])
    expect(lines(tokenContexts('f.md', scan, new Set(['agent'])))).toEqual([2])
    expect(lines(tokenContexts('f.md', scan, new Set(['leaf'])))).toEqual([1, 2])
    expect(lines(tokenContexts('f.md', scan, new Set(['skill', 'as-file'])))).toEqual([2])
    expect(lines(tokenContexts('f.md', scan, new Set(['fork-file'])))).toEqual([1, 2])
  })
})

describe('duplicate-paragraph', () => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')

  it('fires on a 40-word paragraph in two files, ignoring case and wrapping', () => {
    const wrapped = long.toUpperCase().replace(/ word2/g, '\nword2')
    const found = duplicateParagraphs(new Map([['a.md', `intro\n\n${long}\n`], ['b.md', wrapped]]))
    expect(found.map((f) => `${f.file}:${f.line}`).sort()).toEqual(['a.md:3', 'b.md:1'])
  })

  it('stays silent on shorter paragraphs, one file, and code fences', () => {
    const short = long.split(' ').slice(0, 39).join(' ')
    expect(duplicateParagraphs(new Map([['a.md', short], ['b.md', short]]))).toEqual([])
    expect(duplicateParagraphs(new Map([['a.md', `${long}\n\n${long}`]]))).toEqual([])
    expect(duplicateParagraphs(new Map([['a.md', `\`\`\`\n${long}\n\`\`\``], ['b.md', `\`\`\`\n${long}\n\`\`\``]]))).toEqual([])
  })
})

describe('protocol-include', () => {
  it('fires when the protocol is referenced but not defined in the rendered text', () => {
    expect(protocolIncludes('s', ['Proceed per the Drift Protocol.']).map((f) => f.message)).toEqual([
      'refers to the Drift Protocol but does not include it',
    ])
  })

  it('stays silent when the heading is in the text or in an as-file sibling', () => {
    expect(protocolIncludes('s', ['## Drift Protocol\n\nProceed per the Drift Protocol.'])).toEqual([])
    expect(protocolIncludes('s', ['Proceed per the Model Resolution Protocol.', '### 3. Model Resolution Protocol\n'])).toEqual([])
  })
})

describe('size-budget', () => {
  it('measures the text as the harness injects it, and fires above the budget only', () => {
    const head = '---\nname: s\ndescription: d\n---\n'
    // The frontmatter is not injected; a base-directory line is.
    expect(injectedLength(`${head}abc`)).toBe(3 + 120)
    // An expanded skill directory and the operator's arguments count at their injected length.
    expect(injectedLength('${CLAUDE_SKILL_DIR}/x.md')).toBe(90 + 5 + 120)
    expect(injectedLength('$ARGUMENTS')).toBe(200 + 120)
    expect(sizeBudget('s', 'x'.repeat(SKILL_BUDGET - 120))).toEqual([])
    expect(sizeBudget('s', 'x'.repeat(SKILL_BUDGET - 119))[0]!.rule).toBe('size-budget')
  })

  it('keeps the budget under the slice Claude Code re-attaches after a compaction', () => {
    // A margin under the version-specific slice (see SKILL_BUDGET).
    expect(SKILL_BUDGET).toBeLessThan(REATTACH_SLICE_CHARS)
  })
})

describe('ask-line', () => {
  const rule = '2. **The asking rule.** A line tagged `[prompt: <id>]` is a question gate. **A dismissed question is not answered.**'

  it('is silent when the skill carries the asking rule and every question its cue', () => {
    expect(askCues('s', `${rule}\n\n\`[prompt: a]\` Go? (x / y) ${askCue('claude', 'a', false)}\n\n\`[prompt: b]\` Why? ${askCue('claude', 'b', true)}`, 'claude')).toEqual([])
    expect(askCues('s', `${rule}\n\n\`[prompt: a]\` Go? (x / y) ${askCue('opencode', 'a', false)}`, 'opencode')).toEqual([])
  })

  it('fires on questions without the asking rule, or a question without its cue', () => {
    // No rule at all: both the asking rule and the dismissal rule are missing.
    expect(askCues('s', `\`[prompt: a]\` Go? (x / y) ${askCue('claude', 'a', false)}`, 'claude').map((f) => f.message)).toEqual([
      'questions without the asking rule ("The asking rule.")',
      'questions without the dismissal rule ("A dismissed question is not answered.")',
    ])
    expect(askCues('s', `2. **The asking rule.** Gates.\n\n\`[prompt: a]\` Go? (x / y) ${askCue('claude', 'a', false)}`, 'claude').map((f) => f.message)).toEqual([
      'questions without the dismissal rule ("A dismissed question is not answered.")',
    ])
    expect(askCues('s', `${rule}\n\n\`[prompt: a]\` Go? (x / y)`, 'claude').map((f) => f.message)).toEqual(['question a does not carry its cue'])
    // The OpenCode cue names the header: another question's cue does not count.
    expect(askCues('s', `${rule}\n\n\`[prompt: a]\` Go? (x / y) ${askCue('opencode', 'b', false)}`, 'opencode').map((f) => f.message)).toEqual(['question a does not carry its cue'])
  })

  it('finds the cue of a question that runs over several paragraphs, but not past the next question or heading', () => {
    const long = `\`[prompt: a]\` Review:\n- one?\n\nSay "done". ${askCue('claude', 'a', true)}`
    expect(askCues('s', `${rule}\n\n${long}`, 'claude')).toEqual([])
    const borrowed = `\`[prompt: a]\` Go?\n\n\`[prompt: b]\` Why? ${askCue('claude', 'b', true)}`
    expect(askCues('s', `${rule}\n\n${borrowed}`, 'claude').map((f) => f.message)).toEqual(['question a does not carry its cue'])
    const pastHeading = `\`[prompt: a]\` Go?\n\n## Next\n\nText ${askCue('claude', 'a', true)}`
    expect(askCues('s', `${rule}\n\n${pastHeading}`, 'claude').map((f) => f.message)).toEqual(['question a does not carry its cue'])
  })

  it('requires the one-message cue for a question asked in one message, on every harness', () => {
    for (const harness of ['claude', 'codex', 'opencode'] as const) {
      const asked = `${rule}\n\n\`[prompt: a]\` Go? (x / y) ${askCue(harness, 'a', false, 'message')}`
      expect(askCues('s', asked, harness, undefined, new Map([['a', 'message' as const]])), harness).toEqual([])
      const dialog = `${rule}\n\n\`[prompt: a]\` Go? (x / y) ${askCue(harness, 'a', false)}`
      expect(askCues('s', dialog, harness, undefined, new Map([['a', 'message' as const]])).map((f) => f.message), harness).toEqual(['question a does not carry its cue'])
    }
    expect(askCue('claude', 'a', false, 'message')).toContain('in one message')
    expect(askCue('opencode', 'a', false, 'message')).toContain('not the `question` tool')
    expect(askCue('opencode', 'a', false, 'message')).not.toContain('header')
  })

  it('requires the table cue for a question that follows a table on Claude, and only there', () => {
    const tabled = `${rule}\n\n\`[prompt: a]\` Go? (x / y) ${askCue('claude', 'a', false, 'table')}`
    expect(askCues('s', tabled, 'claude', undefined, new Map([['a', 'table' as const]]))).toEqual([])
    expect(askCues('s', tabled, 'claude').map((f) => f.message)).toEqual(['question a does not carry its cue'])
    const dialog = `${rule}\n\n\`[prompt: a]\` Go? (x / y) ${askCue('claude', 'a', false)}`
    expect(askCues('s', dialog, 'claude', undefined, new Map([['a', 'table' as const]])).map((f) => f.message)).toEqual(['question a does not carry its cue'])
  })

  it("takes a sibling file's asking rule from its skill's body", () => {
    const sibling = `\`[prompt: a]\` Go? (x / y) ${askCue('codex', 'a', false)}`
    expect(askCues('sib.md', sibling, 'codex', rule)).toEqual([])
    expect(askCues('sib.md', sibling, 'codex', 'no rule here').map((f) => f.rule)).toEqual(['ask-line', 'ask-line'])
  })
})

describe('option-count', () => {
  it('fires on a choice question with more than four options', () => {
    expect(optionCounts('f.md', '{{#ask id=a}}Pick? (a / b / c / d / e){{/ask}}').map((f) => f.rule)).toEqual(['option-count'])
  })

  it('is silent up to four options, and on free-text questions', () => {
    expect(optionCounts('f.md', '{{#ask id=a}}Pick one (of the rows)? (a / b / c / d){{/ask}}')).toEqual([])
    expect(optionCounts('f.md', '{{#ask id=a text}}Name them (a / b / c / d / e / f).{{/ask}}')).toEqual([])
  })
})

describe('baseline-commit', () => {
  it('flags set_baseline with a commit, and passes one that says no commit', () => {
    expect(baselineCommits('f.md', "recorded with `action: 'set_baseline'` and `commit` by discover").map((f) => f.rule)).toEqual(['baseline-commit'])
    expect(baselineCommits('f.md', "set by `action: 'set_baseline'` with no `commit` (the server records HEAD)")).toEqual([])
    expect(baselineCommits('f.md', 'a `commit` elsewhere')).toEqual([])
    expect(baselineCommits('f.md', "`set_baseline`: never pass `commit`, and call it without `commit`")).toEqual([])
    expect(baselineCommits('f.md', "`set_baseline` with no `commit`, or else with `commit`").map((f) => f.rule)).toEqual(['baseline-commit'])
  })
})

describe('skill-in-code', () => {
  it('flags a skill token inside a code span, not in prose', () => {
    expect(skillTokensInCode('f.md', 'run `{{skill:sync}} push` now').map((f) => f.rule)).toEqual(['skill-in-code'])
    expect(skillTokensInCode('f.md', 'load {{skill:sync}} with `push`')).toEqual([])
    expect(skillTokensInCode('f.md', 'at `x` load {{skill:sync}} with `backup`')).toEqual([])
  })
})
