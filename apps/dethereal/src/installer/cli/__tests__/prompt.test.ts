/**
 * The installer's terminal questions, answered through a scripted input.
 */
import { describe, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { PromptAborted, readlinePrompter } from '../prompt.js'

function terminal(lines: string[]) {
  const input = new PassThrough()
  const output = new PassThrough()
  let shown = ''
  output.on('data', (c: Buffer) => { shown += c.toString() })
  for (const l of lines) input.write(l + '\n')
  return { prompter: readlinePrompter(input, output), end: () => input.end(), shown: () => shown }
}

const CHOICES = [{ value: 'claude', label: 'Claude Code' }, { value: 'codex', label: 'Codex' }, { value: 'opencode', label: 'OpenCode' }] as const

describe('the terminal questions', () => {
  it('takes numbers, keeps the marked default on Enter, and asks again on an answer it cannot use', async () => {
    const t = terminal(['', '9', '2', '1,3', '', 'https://x.example', 'yes', 'nope'])
    expect(await t.prompter.select('Which?', CHOICES, 'claude')).toBe('claude')
    expect(await t.prompter.select('Which?', CHOICES, 'claude')).toBe('codex')
    expect(await t.prompter.multi('Which ones?', CHOICES, [])).toEqual(['claude', 'opencode'])
    expect(await t.prompter.text('URL?', 'http://localhost:3003')).toBe('http://localhost:3003')
    expect(await t.prompter.text('URL?', 'http://localhost:3003')).toBe('https://x.example')
    expect(await t.prompter.confirm('Go?')).toBe(true)
    expect(await t.prompter.confirm('Go?')).toBe(false)
    expect(t.shown()).toMatch(/Answer with one of the numbers\./)
    expect(t.shown()).toMatch(/1\) Claude Code \*/)
    t.prompter.close()
  })

  it('aborts at the end of the input', async () => {
    const t = terminal([])
    t.end()
    await expect(t.prompter.select('Which?', CHOICES, 'claude')).rejects.toBeInstanceOf(PromptAborted)
  })
})
