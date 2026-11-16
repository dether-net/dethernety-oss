/**
 * The remediation task list: checked and written in one call, never over a file already at its path, only into the
 * run's own directory, dated by the run's name; and a line that quotes a class guide of this model whole is the
 * guide's words, not the list's.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ToolContext } from '../../tools/base-tool.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { triageReviewTool } from '../../tools/triage-review.tool.js'
import { cleanText, dateOfRun, hiddenCharacters, quotableFields, QUOTE_MIN, withoutQuotedLines, writeTaskList } from '../tasks.js'

const RUN = 'run-20261115-001500'
const FILE = `.dethereal/triage-run/${RUN}/remediation-tasks-2026-11-15.md`
/** A guide field holding a listed word, as a module author may write it. */
const GUIDE_QUOTE = 'Outbound-fetch code resolves and validates the destination against an allow-list before it connects.'
const CLEAN = 'Task list derived from the threat model\'s attributes as of 2026-11-15.\n- Set tls_enabled to true on the api.'

let tmp: string
let repo: string
let dir: string

const codes = (r: { data?: unknown }) => (r.data as { codes?: string[] } | undefined)?.codes
/** Every file under the model directory, with its bytes: what a refused call must leave as it was. */
function tree(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out[path.relative(root, p)] = e.isSymbolicLink() ? `-> ${fs.readlinkSync(p)}` : fs.readFileSync(p, 'utf8')
    }
  }
  walk(root)
  return out
}

const guideJson = JSON.stringify([
  {
    option_name: 'egress_filtering',
    how_to_obtain: [
      { type: 'code', instruction: 'Find the HTTP client wrapper the service uses for outbound calls.', expected_output: GUIDE_QUOTE },
      { type: 'manual', instruction: 'Short step here.' },
    ],
    typical_values: ['deny-by-default egress with an allow-list', 'none'],
  },
])
let guideDown = false
const guideQuery = async (o: { query: { definitions: Array<{ kind: string; name?: { value: string } }> }; variables?: Record<string, unknown> }) => {
  const name = o.query.definitions.find((d) => d.kind === 'OperationDefinition')?.name?.value
  if (guideDown) throw new Error('platform down')
  if (name === 'ComponentClassGuide') return { data: { componentClasses: o.variables!.id === 'class-svc' ? [{ guide: guideJson }] : [] } }
  throw new Error(`unexpected query ${name}`)
}
const context = { debug: false, apolloClient: { query: guideQuery } } as unknown as ToolContext
const noSession = { debug: false, apolloClient: null, clientUnavailableReason: 'sign in first' } as unknown as ToolContext
const GUIDES = [{ class_id: 'class-svc', element_kind: 'component', attribute_keys: ['egress_filtering'] }]

const tasks = (text: string, more: Record<string, unknown> = {}, ctx: ToolContext = context) =>
  triageReviewTool.run({ action: 'tasks', directory_path: dir, run: RUN, text, ...more }, ctx)

beforeEach(() => {
  guideDown = false
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-tasks-')))
  repo = path.join(tmp, 'repo')
  dir = path.join(repo, 'model')
  fs.mkdirSync(path.join(dir, '.dethereal', 'triage-run', RUN), { recursive: true })
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ model: { id: 'local', name: 'M' } }))
  fs.writeFileSync(path.join(dir, 'structure.json'), JSON.stringify({ defaultBoundary: { id: 'b0', name: 'Edge', boundaries: [], components: [{ id: 'c1', name: 'api', classData: { id: 'class-svc', name: 'Service' } }] } }))
  fs.writeFileSync(path.join(dir, 'dataflows.json'), JSON.stringify([]))
  fs.writeFileSync(path.join(dir, 'data-items.json'), JSON.stringify([]))
  initProjectRoot({ cwd: repo, env: {} })
})
afterEach(() => {
  vi.useRealTimers()
  resetProjectRoot()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('triage_review tasks', () => {
  it('writes a clean list at its path, dated by the run, keeping the run files out of git', async () => {
    // Late on the next day in UTC: the file still takes the run's date.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-16T23:30:00Z'))
    const r = await tasks(CLEAN)
    expect(r.success, r.error).toBe(true)
    expect(r.data).toEqual({ written: true, path: FILE, chars: CLEAN.length, quotes_exempted: 0 })
    expect(fs.readFileSync(path.join(dir, FILE), 'utf8')).toBe(CLEAN)
    expect(fs.readFileSync(path.join(dir, '.dethereal', '.gitignore'), 'utf8').split('\n')).toContain('triage-run/')
    expect(fs.readdirSync(path.join(dir, '.dethereal', 'triage-run', RUN))).toEqual(['remediation-tasks-2026-11-15.md'])
  })

  it('refuses a list with a claim, writing nothing', async () => {
    const before = tree(dir)
    const r = await tasks(`${CLEAN}\n- Enabling TLS fixes this and closes the gap.`)
    expect(codes(r)).toEqual(['claims_found'])
    expect(r.data).toMatchObject({ hits: ['closes', 'fixes'], written: false })
    expect(tree(dir)).toEqual(before)
  })

  it('leaves a file it did not write untouched, says so and names it; takes the same bytes as the list', async () => {
    const draft = path.join(dir, FILE)
    fs.writeFileSync(draft, 'a draft written before the check')
    const r = await tasks(CLEAN)
    expect(codes(r)).toEqual(['tasks_exist'])
    expect(r.error).toBe(`a file is already at ${FILE}; this call neither wrote nor checked it, and it is not the task list`)
    expect(fs.readFileSync(draft, 'utf8')).toBe('a draft written before the check')
    fs.writeFileSync(draft, CLEAN)
    const same = await tasks(CLEAN)
    expect(same.data).toMatchObject({ written: true, path: FILE, existing: true })
    // The same bytes with a claim are still refused for the claim, never taken as the list.
    fs.writeFileSync(draft, `${CLEAN}\nThis fixes it.`)
    expect(codes(await tasks(`${CLEAN}\nThis fixes it.`))).toEqual(['claims_found'])
  })

  it('never replaces a file created between its check and its write', async () => {
    const target = path.join(dir, FILE)
    await expect(writeTaskList(dir, RUN, CLEAN, { beforeCreate: async (t) => fs.writeFileSync(t, 'raced in') })).rejects.toMatchObject({ code: 'tasks_exist' })
    expect(fs.readFileSync(target, 'utf8')).toBe('raced in')
    expect(fs.readdirSync(path.dirname(target))).toEqual(['remediation-tasks-2026-11-15.md'])
  })

  it('writes nothing outside when the run directory is swapped for a link after its check', async () => {
    const outside = path.join(tmp, 'outside')
    fs.mkdirSync(outside)
    const runDir = path.join(dir, '.dethereal', 'triage-run', RUN)
    const swap = async () => {
      fs.rmSync(runDir, { recursive: true })
      fs.symlinkSync(outside, runDir)
    }
    await expect(writeTaskList(dir, RUN, CLEAN, { beforeCreate: swap })).rejects.toMatchObject({ code: 'not_confined' })
    expect(fs.readdirSync(outside)).toEqual([])
  })

  it('writes nothing where it cannot confirm, from the descriptor, where the file was created', async () => {
    // A system with no kernel name for the descriptor (here: no /proc), or an unknown system: refused, nothing left.
    for (const platform of process.platform === 'linux' ? (['freebsd'] as const) : (['linux', 'freebsd'] as const)) {
      await expect(writeTaskList(dir, RUN, CLEAN, { platform })).rejects.toMatchObject({ code: 'tasks_unwritable' })
      expect(fs.readdirSync(path.join(dir, '.dethereal', 'triage-run', RUN))).toEqual([])
    }
  })

  it('takes no link as the list: a link at the path, or a second name of the same file, is a file it did not write', async () => {
    const target = path.join(dir, FILE)
    const elsewhere = path.join(tmp, 'elsewhere.md')
    fs.writeFileSync(elsewhere, CLEAN)
    fs.symlinkSync(elsewhere, target)
    expect(codes(await tasks(CLEAN))).toEqual(['tasks_exist'])
    fs.rmSync(target)
    fs.linkSync(elsewhere, target)
    expect(codes(await tasks(CLEAN))).toEqual(['tasks_exist'])
    expect(fs.readFileSync(elsewhere, 'utf8')).toBe(CLEAN)
  })

  it('keeps the list readable by its owner only, and names an unwritable directory by its relative path', async () => {
    expect((await tasks(CLEAN)).success).toBe(true)
    expect(fs.statSync(path.join(dir, FILE)).mode & 0o777).toBe(0o600)
    const run2 = 'run-20261115-001502'
    const runDir = path.join(dir, '.dethereal', 'triage-run', run2)
    fs.mkdirSync(runDir)
    fs.chmodSync(runDir, 0o500)
    try {
      const r = await tasks(CLEAN, { run: run2 })
      expect(codes(r)).toEqual(['tasks_unwritable'])
      expect(r.error).toContain(`.dethereal/triage-run/${run2}/remediation-tasks-2026-11-15.md`)
      expect(r.error).not.toContain(tmp)
    } finally {
      fs.chmodSync(runDir, 0o700)
    }
  })

  it.each(['.dethereal', '.dethereal/triage-run', `.dethereal/triage-run/${RUN}`])('refuses a link at %s, writing nothing anywhere', async (link) => {
    const outside = path.join(tmp, 'outside')
    fs.mkdirSync(path.join(outside, 'triage-run', RUN), { recursive: true })
    fs.mkdirSync(path.join(outside, RUN), { recursive: true })
    const at = path.join(dir, link)
    fs.rmSync(at, { recursive: true, force: true })
    fs.symlinkSync(link === '.dethereal' ? outside : link.endsWith(RUN) ? path.join(outside, RUN) : outside, at)
    const before = tree(outside)
    const r = await tasks(CLEAN)
    expect(codes(r)).toEqual(['not_confined'])
    expect(tree(outside)).toEqual(before)
  })

  it('refuses a run directory that is not there, and creates none', async () => {
    const r = await tasks(CLEAN, { run: 'run-20261115-001501' })
    expect(codes(r)).toEqual(['run_not_found'])
    expect(fs.existsSync(path.join(dir, '.dethereal', 'triage-run', 'run-20261115-001501'))).toBe(false)
  })

  it('refuses a directory that is not a model directory', async () => {
    fs.rmSync(path.join(dir, 'manifest.json'))
    expect(codes(await tasks(CLEAN))).toEqual(['not_model_dir'])
  })

  it.each([
    ['a soft hyphen', 'This fi\u00adxes it.'],
    ['a zero-width joiner', 'This fi\u200dxes it.'],
    ['a carriage return', 'One line.\r\nAnother.'],
    ['a tab', 'One\tline.'],
    ['a bidirectional mark', 'This \u202efixes it.'],
    ['an emoji variation selector', 'Warning \u26a0\ufe0f insufficient alone.'],
    ['a lone surrogate', 'a\ud800b'],
  ])('refuses %s, a character that could split a word past the check, naming it and its line', async (_label, text) => {
    const r = await tasks(text)
    expect(codes(r)).toEqual(['text_invalid'])
    expect(r.error).toMatch(/U\+[0-9A-F]{4} on line \d/)
    expect(fs.existsSync(path.join(dir, FILE))).toBe(false)
  })

  it('names each hidden character by its line and code point', () => {
    expect(hiddenCharacters('ok\nfi\u00adx\n\u200b')).toEqual([{ line: 2, code: 'U+00AD' }, { line: 3, code: 'U+200B' }])
  })

  it('takes as the list only a file with the same bytes, not the same decoded text', async () => {
    const draft = path.join(dir, FILE)
    fs.writeFileSync(draft, Buffer.from([0x61, 0xf0, 0x9f, 0x98, 0x62]))
    expect(codes(await tasks('a\ufffdb'))).toEqual(['tasks_exist'])
  })

  it('reads guides only with a session; a failed read and a class outside the model write nothing', async () => {
    const quoted = `${CLEAN}\n- ${GUIDE_QUOTE}`
    const none = await tasks(quoted, { guides: GUIDES }, noSession)
    expect(none).toEqual({ success: false, error: 'sign in first' })
    guideDown = true
    expect(codes(await tasks(quoted, { guides: GUIDES }))).toEqual(['guide_unread'])
    guideDown = false
    const outside = await tasks(quoted, { guides: [{ class_id: 'class-other', element_kind: 'component', attribute_keys: ['egress_filtering'] }] })
    expect(codes(outside)).toEqual(['guide_not_in_model'])
    expect(fs.existsSync(path.join(dir, FILE))).toBe(false)
  })
})

describe('quoted guide text', () => {
  const ok = (text: string) => tasks(`${CLEAN}\n${text}`, { guides: GUIDES })

  it('sets aside a line that quotes a guide field of a class of this model whole', async () => {
    const r = await ok(`- ${GUIDE_QUOTE}`)
    expect(r.success, r.error).toBe(true)
    expect(r.data).toMatchObject({ written: true, quotes_exempted: 1 })
    for (const line of [`> ${GUIDE_QUOTE}`, `"${GUIDE_QUOTE}"`, `- “${GUIDE_QUOTE}”`, `-   ${GUIDE_QUOTE.replace(' and ', '  and\u00a0')}`]) {
      fs.rmSync(path.join(dir, FILE), { force: true })
      expect((await ok(line)).success, line).toBe(true)
    }
  })

  it('checks the same quote inside a sentence of the list’s own, one character off, or cut', async () => {
    for (const line of [
      `- As the guide says, ${GUIDE_QUOTE}`,
      `- ${GUIDE_QUOTE.replace('allow-list', 'allowlist')}`,
      `- ${GUIDE_QUOTE.replace('resolves', '[REDACTED] resolves')}`,
      `- ${GUIDE_QUOTE} This fixes it.`,
    ]) expect(codes(await ok(line)), line).toEqual(['claims_found'])
  })

  it('exempts nothing without the guide named, or from text the list gives itself', async () => {
    expect(codes(await tasks(`${CLEAN}\n- ${GUIDE_QUOTE}`))).toEqual(['claims_found'])
  })

  it('keeps only fields of at least QUOTE_MIN characters, cleaned', () => {
    const fields = quotableFields([{ optionName: 'x', howToObtain: [{ type: 'manual', instruction: 'It fixes things now.', expectedOutput: '  A long   enough\nfield that resolves names.  ' }], typicalValues: 'short' }])
    expect([...fields]).toEqual(['A long enough field that resolves names.'])
    expect('It fixes things now.'.length).toBeLessThan(QUOTE_MIN)
  })

  it('sets lines aside whole in one pass, counts them, and never joins the lines around one', () => {
    const fields = new Set([cleanText(GUIDE_QUOTE)])
    expect(withoutQuotedLines(`a\n- ${GUIDE_QUOTE}\nb`, fields)).toEqual({ checked: ['a', 'b'], exempted: 1 })
    expect(withoutQuotedLines(`a ${GUIDE_QUOTE}`, fields)).toEqual({ checked: [`a ${GUIDE_QUOTE}`], exempted: 0 })
  })

  it('finds no claim across a quote set aside', async () => {
    const r = await ok(`- The change lowers\n- ${GUIDE_QUOTE}\nrisk is not a word here alone.`)
    expect(r.success, r.error).toBe(true)
  })

  it('takes a field that itself begins and ends with quotes, quoted as written', () => {
    const field = '"The proxy resolves upstream names through the resolver"'
    const fields = quotableFields([{ optionName: 'x', howToObtain: [{ type: 'manual', instruction: field }] }])
    for (const line of [`- ${field}`, field, `> ${field}`]) expect(withoutQuotedLines(line, fields).exempted, line).toBe(1)
  })

  it('cleans both sides alike, the composed and decomposed forms of a letter included', () => {
    const fields = quotableFields([{ optionName: 'x', howToObtain: [{ type: 'manual', instruction: 'Check the cafe\u200b\u0301 resolver configuration file' }] }])
    expect(withoutQuotedLines('- Check the caf\u00e9 resolver configuration file', fields).exempted).toBe(1)
  })
})

describe('the run date', () => {
  it('is the run name’s own', () => {
    expect(dateOfRun(RUN)).toBe('2026-11-15')
    expect(() => dateOfRun('run-x')).toThrow()
  })
})
