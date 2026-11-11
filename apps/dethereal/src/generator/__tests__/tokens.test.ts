import { askCue } from '../ask-cues.js'
import { describe, expect, it } from 'vitest'
import { claudeRenderer } from '../targets/claude/renderer.js'
import { filterHarness, renderText, scanTokens, type TokenRenderer } from '../tokens.js'

/** A renderer that shows exactly what the core handed it. */
const probe: TokenRenderer = {
  inline: (kind, name, inCode) => `<${kind}:${name}${inCode ? ':code' : ''}>`,
  delegate: (agent, prompt) => `<delegate ${agent}|${prompt}>`,
  ask: (id, question, freeText) => `<ask ${id}${freeText ? ' text' : ''}|${question}>`,
  asFile: (name, skill) => `<read ${name}${skill ? ` of ${skill}` : ''}>`,
}

function render(text: string, shared: Record<string, string> = {}, allowAsFile = true, renderer = probe) {
  return renderText(text, { harness: 'claude', renderer, shared: (p) => shared[p], allowAsFile })
}

const messages = (text: string) => scanTokens('f.md', text).findings.map((f) => `${f.line}: ${f.message}`)

describe('scanning', () => {
  it('accepts every token form', () => {
    const text = [
      '{{#harness claude,codex}}',
      'Use {{tool:list_models}}, {{cmd:sync}}, {{agent:model-reviewer}} and {{args}}.',
      '{{/harness}}',
      '{{include shared/a.md}}',
      '{{include shared/b.md as-file}}',
      '{{#delegate scout}}Do it.{{/delegate}}',
      '{{#ask id=pick-one}}Pick? (a / b){{/ask}}',
      '{{#ask id=free text}}',
      'Anything else?',
      '{{/ask}}',
    ].join('\n')
    const scan = scanTokens('f.md', text)
    expect(scan.findings).toEqual([])
    expect(scan.tokens.map((t) => t.token.kind)).toEqual([
      'harness-open', 'inline', 'inline', 'inline', 'inline', 'harness-close', 'include', 'include',
      'delegate-open', 'delegate-close', 'ask-open', 'ask-close', 'ask-open', 'ask-close',
    ])
    expect(scan.tokens[1]!.harnesses).toEqual(['claude', 'codex'])
    expect(scan.tokens[6]!.harnesses).toBeNull()
  })

  it.each([
    ['{{tool:Bad-Name}}', 'bad tool name'],
    ['{{cmd:Sync}}', 'bad cmd name'],
    ['{{frob:x}}', 'unknown token'],
    ['{{ tool:x }}', 'unknown token'],
    ['{{#harness claude,gemini}}\nx\n{{/harness}}', 'unknown harness gemini'],
    ['{{#harness claude,claude}}\nx\n{{/harness}}', 'harness listed twice'],
    ['{{include ../secrets.md}}', 'include path must be shared/<name>.md'],
    ['{{include shared/x.txt}}', 'include path must be shared/<name>.md'],
    ['{{#ask id=Bad_Id}}q{{/ask}}', 'bad ask id'],
    ['{{#ask id=x extra}}q{{/ask}}', 'unknown token'],
    ['text {{ unbalanced', 'unbalanced token braces'],
  ])('rejects %s', (text, expected) => {
    expect(messages(text).join('\n')).toContain(expected)
  })

  it('requires line-level tokens to stand alone', () => {
    expect(messages('See {{include shared/a.md}} here.')[0]).toContain('must stand alone')
    expect(messages('x {{#harness claude}}\n{{/harness}}')[0]).toContain('must stand alone')
  })

  it('rejects unbalanced and nested blocks, with the line', () => {
    expect(messages('{{#harness claude}}\n{{#harness codex}}\n{{/harness}}')).toContain('2: harness block opened inside the block opened on line 1')
    expect(messages('{{#harness claude}}\nx')).toContain('1: harness block is never closed')
    expect(messages('{{/harness}}')).toContain('1: {{/harness}} without an open harness block')
    expect(messages('{{#delegate a}}{{#ask id=q}}x{{/ask}}{{/delegate}}')[0]).toContain('ask block opened inside the delegate block')
    expect(messages('{{#ask id=q}}\nnever closed')).toContain('1: ask block is never closed')
    expect(messages('{{/delegate}}')).toContain('1: {{/delegate}} without an open delegate block')
    expect(messages('{{#ask id=q}}\n{{include shared/a.md}}\n{{/ask}}')).toContain('2: include inside the ask block opened on line 1')
  })

  it('rejects a block that crosses a harness boundary', () => {
    const text = '{{#harness claude}}\n{{#ask id=q}}\n{{/harness}}\n{{/ask}}'
    const found = messages(text)
    expect(found.join('\n')).toContain('still open')
    expect(found.join('\n')).toContain('crosses a harness block boundary')
  })

  it('knows which tokens sit in code, and which are a code span on their own', () => {
    const text = ['{{tool:a}} `{{tool:b}}` `run {{cmd:c}} now`', '```', '{{args}}', '```'].join('\n')
    const tokens = scanTokens('f.md', text).tokens
    expect(tokens.map((t) => [t.inCode, t.aloneInCodeSpan])).toEqual([
      [false, false],
      [true, true],
      [true, false],
      [true, false],
    ])
  })
})

describe('harness filtering', () => {
  const text = ['a', '{{#harness claude}}', 'b', '{{/harness}}', '{{#harness codex,opencode}}', 'c', '{{/harness}}', 'd'].join('\n')

  it('keeps shared lines and the harness own lines, and drops tag lines', () => {
    expect(filterHarness(text, 'claude')).toBe('a\nb\nd')
    expect(filterHarness(text, 'codex')).toBe('a\nc\nd')
    expect(filterHarness(text, 'opencode')).toBe('a\nc\nd')
  })
})

describe('rendering', () => {
  it('renders inline tokens, bare inside code', () => {
    const out = render('Call {{tool:x}}; run `{{cmd:y}} --z`.\n```\n{{agent:w}} {{args}}\n```').text
    expect(out).toBe('Call <tool:x>; run `<cmd:y:code> --z`.\n```\n<agent:w:code> <args::code>\n```')
  })

  it('renders blocks with their trimmed bodies, then the inline tokens inside them', () => {
    const out = render('{{#delegate scout}}\n  Survey with {{tool:get_classes}}.\n{{/delegate}}\n{{#ask id=q text}}Why?{{/ask}}').text
    expect(out).toBe('<delegate scout|Survey with <tool:get_classes>.>\n<ask q text|Why?>')
  })

  it('inlines includes recursively, harness-filtered, and reports cycles', () => {
    const shared = {
      'shared/a.md': 'A1\n{{#harness codex}}\nA-codex\n{{/harness}}\n{{include shared/b.md}}\n',
      'shared/b.md': 'B with {{tool:t}}\n\n',
      'shared/loop.md': '{{include shared/loop.md}}',
    }
    expect(render('top\n{{include shared/a.md}}\nend', shared).text).toBe('top\nA1\nB with <tool:t>\nend')
    expect(() => render('{{include shared/loop.md}}', shared)).toThrow('include cycle')
    expect(() => render('{{include shared/none.md}}', shared)).toThrow('missing file')
  })

  it('emits as-file includes as siblings and renders their tokens', () => {
    const shared = { 'shared/ref/notes.md': 'Notes on {{tool:t}}.\n' }
    const result = render('Before.\n{{include shared/ref/notes.md as-file}}\nAfter.', shared)
    expect(result.text).toBe('Before.\n<read notes.md>\nAfter.')
    expect([...result.siblings]).toEqual([['notes.md', 'Notes on <tool:t>.\n']])
    expect(() => render('{{include shared/ref/notes.md as-file}}', shared, false)).toThrow('outside a skill body')
  })
})

describe('Claude renderings', () => {
  const claude = (text: string, shared: Record<string, string> = {}) => render(text, shared, true, claudeRenderer).text

  it('spells tools, commands, agents and arguments the Claude way', () => {
    expect(claude('{{tool:list_models}} {{cmd:sync}} {{agent:model-reviewer}} {{args}}')).toBe(
      '`mcp__plugin_dethereal_dethereal__list_models` `/dethereal:sync` `dethereal:model-reviewer` $ARGUMENTS',
    )
    expect(claude('`{{cmd:sync}} push`')).toBe('`/dethereal:sync push`')
  })

  it('delegates through the Agent tool with the scoped agent type, failing closed', () => {
    const out = claude('{{#delegate scout}}Survey it.{{/delegate}}')
    expect(out).toBe(
      'Invoke the `Agent` tool with `subagent_type: "dethereal:scout"` and this prompt: “Survey it.” Wait for its result. ' +
        'If the agent cannot be started, or it returns without doing the work, stop and tell the operator; do not do its work yourself.',
    )
  })

  it('quotes a multi-paragraph delegation prompt as a blockquote', () => {
    const out = claude('{{#delegate scout}}\nFirst.\n\nSecond.\n{{/delegate}}')
    expect(out).toContain('this prompt:\n\n> First.\n>\n> Second.\n\nWait for its result.')
  })

  it('asks a choice question in one line: the tag, the question, and the cue naming AskUserQuestion', () => {
    // The gate rules themselves live once, in the core rules' asking rule.
    expect(claude('{{#ask id=push-confirm}}Push now? (push / skip){{/ask}}')).toBe(
      '`[prompt: push-confirm]` Push now? (push / skip) — table first, then AskUserQuestion, the tag first in its question text.',
    )
  })

  it('asks a choice that follows a table in the message that shows it, not in a dialog', () => {
    const out = renderText('{{#ask id=push-confirm}}Push now? (push / skip){{/ask}}', { harness: 'claude', renderer: claudeRenderer, shared: () => undefined, allowAsFile: true, askLayouts: new Map([['push-confirm', 'table' as const]]) }).text
    expect(out).toBe('`[prompt: push-confirm]` Push now? (push / skip) — the table, then the question with its choices numbered, in one message; end your turn.')
    expect(out).not.toContain('AskUserQuestion')
    // Only Claude changes: the other harnesses already ask a choice in their own way.
    expect(askCue('codex', 'push-confirm', false, 'table')).toBe(askCue('codex', 'push-confirm', false))
    expect(askCue('opencode', 'push-confirm', false, 'table')).toBe(askCue('opencode', 'push-confirm', false))
    // A free-text question stays a plain free-text message.
    expect(askCue('claude', 'notes', true, 'table')).toBe(askCue('claude', 'notes', true))
  })

  it('asks a choice marked for one message in a message on every harness, never a dialog or the question tool', () => {
    const out = renderText('{{#ask id=loop}}Loop back? (loop back / skip){{/ask}}', { harness: 'claude', renderer: claudeRenderer, shared: () => undefined, allowAsFile: true, askLayouts: new Map([['loop', 'message' as const]]) }).text
    expect(out).toBe('`[prompt: loop]` Loop back? (loop back / skip) — what it follows, then the question with its choices numbered, in one message; end your turn.')
    const opencode = askCue('opencode', 'loop', false, 'message')
    expect(opencode).toContain('not the `question` tool')
    expect(opencode).not.toContain('header')
    expect(askCue('codex', 'loop', false, 'message')).toContain('in one message')
    for (const h of ['claude', 'codex', 'opencode'] as const) expect(askCue(h, 'notes', true, 'message')).toBe(askCue(h, 'notes', true))
  })

  it('keeps a command and its arguments in one code span, and bare inside code', () => {
    expect(claude('Run {{cmd:sync push}} now.')).toBe('Run `/dethereal:sync push` now.')
    expect(claude('`{{cmd:sync push}}`')).toBe('`/dethereal:sync push`')
    expect(messages('{{cmd:sync `push`}}')).toEqual(['1: command arguments must not contain a backtick: `push`'])
  })

  it('asks a free-text question as a plain message that ends the turn', () => {
    const out = claude('{{#ask id=notes text}}Anything missed?{{/ask}}')
    expect(out).toBe('`[prompt: notes]` Anything missed? — a plain message; end your turn.')
    expect(out).not.toContain('AskUserQuestion')
  })

  it('reads an as-file sibling from the skill directory', () => {
    expect(claude('{{include shared/ref.md as-file}}', { 'shared/ref.md': 'x' })).toBe('Read the file `${CLAUDE_SKILL_DIR}/ref.md` in full.')
  })
})
