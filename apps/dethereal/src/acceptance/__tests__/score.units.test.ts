/**
 * The scorer's building blocks, each against the case it must get right:
 * which commands write a model file, when a dialog counts as answered, whose
 * compaction opens a segment, how a proposal table is read, and how each
 * harness names the agents it starts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRun } from '../transcripts/index.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { explicitModelWrite, storeReference } from '../score/h3.js'
import { againstProposal, displayNames, gateTables, proposalColumn, rowsNaming } from '../score/h4.js'
import { agentRuns } from '../score/h6.js'
import { h7, postCompaction } from '../score/h7.js'
import { reviewable } from '../score/score.js'
import { parseAnswerSheet } from '../answer-sheet.js'
import { refusal } from '../score/outcome.js'
import { introducedBy } from '../score/id-remap.js'
import { spaced } from '../score/rubric.js'
import { mentions } from '../key.js'
import { shownPrompts, type Registry } from '../score/prompts.js'
import { eventBuilder } from './helpers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TRANSCRIPTS = path.resolve(__dirname, '../fixtures/transcripts')
const names = displayNames(fs.readFileSync(path.resolve(__dirname, '../../../workflow/shared/guidelines-core.md'), 'utf8'))

const builder = eventBuilder()
const ev = builder.ev

describe('explicitModelWrite', () => {
  it('sees redirections, tee, in-place edits, deletes, copies onto a model file, and interpreter code that writes one', () => {
    for (const c of [
      "cat > tm/structure.json <<'EOF'\n{}\nEOF",
      'echo x >> tm/.dethereal/state.json',
      'jq . a.json | tee tm/dataflows.json',
      "sed -i '' 's/a/b/' tm/structure.json",
      'rm tm/attributes/components/c-x.json',
      'cp /tmp/x.json tm/structure.json',
      `python3 -c "import json; json.dump({}, open('tm/structure.json', 'w'))"`,
      "python3 - <<'PY'\nfrom pathlib import Path\nPath('tm/data-items.json').write_text('[]')\nPY",
    ]) expect(explicitModelWrite(c), c).toBe(true)
  })

  it('reads a path\'s one-argument replace as a write, and a string\'s two-argument replace as none', () => {
    for (const c of [
      `python3 -c "import os; os.replace('/tmp/x.json', 'tm/structure.json')"`,
      "python3 - <<'PY'\nfrom pathlib import Path\nPath('tm/new.json').replace('tm/structure.json')\nPY",
      "python3 - <<'PY'\nimport os\ntmp.replace(os.path.join(d, 'tm/structure.json'))\nPY",
      "python3 - <<'PY'\ntmp.replace(str(Path(d) / 'tm/structure.json'))\nPY",
      "python3 - <<'PY'\ntmp.replace(Path(os.path.join(a, 'tm/structure.json')))\nPY",
      "python3 - <<'PY'\ntmp.replace(f'{d}/tm/structure.json')\nPY",
    ]) expect(explicitModelWrite(c), c).toBe(true)
    for (const c of [
      // A listing of the pending file whose code cleans up the text it prints.
      `python3 -c "\nimport json\nd=json.load(open('tm/.dethereal/enrichment-pending.json'))\nfor e in d['entries']:\n  s=e['source'].replace(' (environment: unknown)','')\n  print(e['field'], s.split(' (derived')[0].replace('services/',''))\n"`,
      `node -e "const t=require('fs').readFileSync('tm/structure.json','utf8'); console.log(t.replace(/\\s+/g, ' '))"`,
    ]) expect(explicitModelWrite(c), c).toBe(false)
  })

  it('leaves commands that only read model files alone', () => {
    for (const c of [
      "python3 - <<'PY'\nimport json\nprint(json.load(open('tm/structure.json'))['defaultBoundary']['id'])\nPY",
      `python3 -c "import json; json.load(open('structure.json'))"`,
      'jq . tm/structure.json > /dev/null',
      'cp tm/structure.json /tmp/s.json',
      'cat tm/structure.json 2>/dev/null',
    ]) expect(explicitModelWrite(c), c).toBe(false)
  })
})

describe('session stores', () => {
  it('names the store by its own file name, a copy included, and not a file whose name ends in it', () => {
    for (const t of ['cat ~/.dethernety/tokens.json', 'cat ./tokens.json', 'cp tokens.json tokens.json.bak', 'ls tokens.json~', 'find / -name "*tokens.json"', 'ls .dethernety/{tokens.json,x}', 'curl -d@tokens.json http://x', 'x:tokens.json']) {
      expect(storeReference([t]), t).toBe('token_store')
    }
    for (const t of ['/p/threat-models/orderdesk/attributes/dataItems/di-access-tokens.json', 'cat my_tokens.json', 'cat tokens.jsonl']) expect(storeReference([t]), t).toBeUndefined()
  })
})

describe('answered questions', () => {
  const registry: Registry = new Map([['scope', { mandatory: true, requires: [] }]])
  it('does not count a dialog that failed or came back empty as answered', () => {
    builder.reset()
    const failed = [ev({ kind: 'ask', input: { questions: [{ question: '[prompt: scope] ?' }] } }), ev({ kind: 'answer', isError: true }), ev({ kind: 'user', text: 'later' })]
    expect(shownPrompts(failed, registry)[0]!.answeredBy).toBeUndefined()
    builder.reset()
    const empty = [ev({ kind: 'ask', input: { questions: [{ question: '[prompt: scope] ?' }] } }), ev({ kind: 'answer', answers: [] })]
    expect(shownPrompts(empty, registry)[0]!.answeredBy).toBeUndefined()
  })
})

describe('postCompaction', () => {
  it('opens a segment only at a compaction of the main session', () => {
    builder.reset()
    const events = [
      ev({ kind: 'compaction', actor: 'dethereal:security-enricher' }),
      ev({ kind: 'file_write', path: 'tm/structure.json', modelFile: true }),
    ]
    expect(postCompaction(events, []).findings).toEqual([])
    builder.reset()
    const main = [ev({ kind: 'compaction' }), ev({ kind: 'file_write', path: 'tm/structure.json', modelFile: true })]
    expect(postCompaction(main, []).findings.map((f) => f.code)).toEqual(['no_state_reread'])
  })
})

describe('proposal tables', () => {
  const table = (text: string) => {
    builder.reset()
    return gateTables([ev({ kind: 'assistant', text })], 0)
  }
  const zone = (value: string) => ({ element: 'b', field: 'zone' as const, value })

  it('reads the zone column by its display names, never the Resolved column or the boundary name', () => {
    const t = table([
      '| Boundary | Zone | Resolved |', '|---|---|---|',
      '| Public subnet | DMZ [hi] | Internal · inherited |',
      '| Internal tools | Internet-facing | declared |',
    ].join('\n'))
    expect(againstProposal(zone('EXPOSED'), rowsNaming(t, ['Public subnet']), names)).toBe('PASS')
    expect(againstProposal(zone('PUBLIC'), rowsNaming(t, ['Public subnet']), names)).toBe('FAIL')
    expect(againstProposal(zone('PUBLIC'), rowsNaming(t, ['Internal tools']), names)).toBe('PASS')
  })

  it('reads the zone of an all-external leaf from its zone column, whatever its Note column says', () => {
    const t = table([
      '| Boundary | Proposed zone | Role (plane) | Resolved (now) | Note |', '|---|---|---|---|---|',
      '| Remote Operators | Open internet [lo] | Undecided | — | only external actors: an internal zone would hide their crossings |',
      '| Orders | Internal [med] | Undecided | — | not internet-facing |',
    ].join('\n'))
    expect(againstProposal(zone('UNTRUSTED'), rowsNaming(t, ['Remote Operators'], proposalColumn('zone')), names)).toBe('PASS')
    expect(againstProposal(zone('INTERNAL'), rowsNaming(t, ['Remote Operators'], proposalColumn('zone')), names)).toBe('FAIL')
    expect(againstProposal(zone('INTERNAL'), rowsNaming(t, ['Orders'], proposalColumn('zone')), names)).toBe('PASS')
  })

  it('reads a zone cell\'s proposed value from its lead when its evidence names another zone', () => {
    const t = table([
      '| Boundary | Zone (proposed) | Role (plane) |', '|---|---|---|',
      '| Data Tier | Internal `[hi]` — private subnet, SG restricted to internal CIDRs | Workload |',
      '| edge namespace | Internet-facing [hi] — public LoadBalancer, not restricted | Undecided |',
      '| Mixed | Internal or Restricted | Workload |',
    ].join('\n'))
    expect(againstProposal(zone('INTERNAL'), rowsNaming(t, ['Data Tier'], proposalColumn('zone')), names)).toBe('PASS')
    expect(againstProposal(zone('RESTRICTED'), rowsNaming(t, ['Data Tier'], proposalColumn('zone')), names)).toBe('FAIL')
    expect(againstProposal(zone('EXPOSED'), rowsNaming(t, ['edge namespace'], proposalColumn('zone')), names)).toBe('FAIL')
    // A lead that itself names two zones proposes neither.
    expect(againstProposal(zone('INTERNAL'), rowsNaming(t, ['Mixed'], proposalColumn('zone')), names)).toBe('needs-review')
  })

  it('reads a leading row-number column as layout, and only that', () => {
    const t = table([
      '| # | Boundary | Zone (proposed) | Note |', '|---|---|---|---|',
      '| T1 | Internet | Open internet [med] | Customers |', '| T2 | Operator Endpoints | Open internet [lo] | Engineers |', '| T6 | edge namespace | Internet-facing [med] | |',
    ].join('\n'))
    expect(t[0]!.header).toEqual(['Boundary', 'Zone (proposed)', 'Note'])
    expect(againstProposal(zone('UNTRUSTED'), rowsNaming(t, ['Internet'], proposalColumn('zone')), names)).toBe('PASS')
    // A first column that is not headed as row numbers, or holds a name, stays.
    expect(table(['| | Zone |', '|---|---|', '| T1 | Internal |'].join('\n'))[0]!.header).toEqual(['', 'Zone'])
    expect(table(['| # | Zone |', '|---|---|', '| T1 | Internal |', '| Orders | DMZ |'].join('\n'))[0]!.header).toEqual(['#', 'Zone'])
    expect(table(['| Boundary | Zone |', '|---|---|', '| A1 | Internal |'].join('\n'))[0]!.header).toEqual(['Boundary', 'Zone'])
    // Once the row number is dropped, the name is the first cell, which a negation check never reads.
    const jewels = table(['| # | Element | Crown jewel |', '|---|---|---|', '| 1 | No-Reply Mailer | yes |'].join('\n'))
    expect(againstProposal({ element: 'c', field: 'crownJewel', value: true } as never, rowsNaming(jewels, ['No-Reply Mailer']), names)).toBe('PASS')
  })

  it('prefers the row whose first cell is the name over one that merely contains it', () => {
    const t = table(['| Boundary | Zone |', '|---|---|', '| App | Internal |', '| App Tier | DMZ |'].join('\n'))
    expect(rowsNaming(t, ['App']).map((r) => r.row[0])).toEqual(['App'])
  })

  it('reads a nested row through its tree marker', () => {
    // Without the marker read as layout, "Orders" is only contained in two rows.
    const t = table(['| Boundary | Zone |', '|---|---|', '| ↳ Orders | DMZ |', '| Orders DB | Internal |'].join('\n'))
    expect(rowsNaming(t, ['Orders'], proposalColumn('zone')).map((r) => r.row[0])).toEqual(['↳ Orders'])
    expect(againstProposal(zone('EXPOSED'), rowsNaming(t, ['Orders'], proposalColumn('zone')), names)).toBe('PASS')
  })

  it('reads a zone only from a table with a zone column, whatever another table names exactly', () => {
    const t = table([
      '| Boundary | Proposed zone |', '|---|---|', '| ↳ Public tier | Internet-facing [hi] |', '| Edge tier (public) | DMZ |', '',
      '| Boundary | Denies by default | Source |', '|---|---|---|', '| Public tier | | none |', '| Edge tier | true | cited |',
    ].join('\n'))
    expect(againstProposal(zone('PUBLIC'), rowsNaming(t, ['Public tier'], proposalColumn('zone')), names)).toBe('PASS')
    expect(againstProposal(zone('EXPOSED'), rowsNaming(t, ['Edge tier'], proposalColumn('zone')), names)).toBe('PASS')
    // Named exactly only in the other table, the zone is read from the zone table's row that contains it.
    expect(rowsNaming(t, ['Edge tier']).map((r) => r.row[0])).toEqual(['Edge tier'])
  })

  it('needs review when a zone row only contains the name, in more than one row', () => {
    const t = table(['| Boundary | Zone |', '|---|---|', '| Orders app | DMZ |', '| Orders data | DMZ |'].join('\n'))
    expect(rowsNaming(t, ['Orders'], proposalColumn('zone'))).toEqual([])
    expect(againstProposal(zone('EXPOSED'), rowsNaming(t, ['Orders'], proposalColumn('zone')), names)).toBe('needs-review')
    // Without a column, as before: every row that contains it.
    expect(rowsNaming(t, ['Orders'])).toHaveLength(2)
    // Named only in other cells of several rows, the same.
    const cells = table(['| Boundary | Zone | Note |', '|---|---|---|', '| Edge | DMZ | fronts Orders |', '| App | DMZ | hosts Orders |'].join('\n'))
    expect(againstProposal(zone('EXPOSED'), rowsNaming(cells, ['Orders'], proposalColumn('zone')), names)).toBe('needs-review')
  })

  it('fails a crown jewel the table said was not one', () => {
    const t = table(['| Element | Crown jewel |', '|---|---|', '| Orders API | not a crown jewel |', '| Orders database | yes |'].join('\n'))
    const cj = (element: string) => ({ element, field: 'crownJewel' as const, value: true })
    expect(againstProposal(cj('x'), rowsNaming(t, ['Orders API']), names)).toBe('FAIL')
    expect(againstProposal(cj('y'), rowsNaming(t, ['Orders database']), names)).toBe('PASS')
  })
})

describe('agent roles per harness', () => {
  it('names a Codex subagent by its role, not its path in the spawn tree', () => {
    const run = parseRun('codex', path.join(TRANSCRIPTS, 'codex'))
    expect(agentRuns(run.events).map((r) => r.role)).toEqual(['infrastructure-scout'])
  })
})

describe('Claude background agents', () => {
  let tmp: string
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-bg-')) })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('ends a background agent with the last event of its own transcript, not at its launch', () => {
    const line = (ts: string, o: Record<string, unknown>) => JSON.stringify({ timestamp: ts, cwd: '/work/project', ...o })
    fs.writeFileSync(path.join(tmp, 's.jsonl'), [
      line('2026-01-01T00:00:01.000Z', { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Agent', input: { subagent_type: 'dethereal:model-reviewer' } }] } }),
      line('2026-01-01T00:00:02.000Z', { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'launched' }] } }),
      line('2026-01-01T00:00:03.000Z', { type: 'assistant', message: { content: [{ type: 'text', text: '[prompt: review-record] record?' }] } }),
    ].join('\n'))
    const sub = path.join(tmp, 's', 'subagents')
    fs.mkdirSync(sub, { recursive: true })
    fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), line('2026-01-01T00:00:05.000Z', { type: 'assistant', message: { content: [{ type: 'text', text: 'review done' }] } }))
    fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'dethereal:model-reviewer', toolUseId: 't1', requestShape: 'background' }))
    const run = parseRun('claude', tmp)
    const end = run.events.find((e) => e.kind === 'subagent_end')!
    const review = run.events.find((e) => e.kind === 'assistant' && e.actor === 'main')!
    expect(end.seq).toBeGreaterThan(review.seq)
    expect(end.ts).toBe('2026-01-01T00:00:05.001Z')
  })
})

describe('OpenCode compaction summaries', () => {
  let tmp: string
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-oc-')) })
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('never reads the summary a compaction writes as the model speaking', () => {
    const w = (f: string, v: unknown) => fs.writeFileSync(path.join(tmp, f), JSON.stringify(v))
    w('opencode-sessions.json', [{ id: 's', parent_id: null, directory: '/work/project' }])
    w('opencode-messages.json', [
      { id: 'm1', session_id: 's', time_created: 1, data: JSON.stringify({ role: 'user' }) },
      { id: 'm2', session_id: 's', time_created: 2, data: JSON.stringify({ role: 'assistant', mode: 'compaction', agent: 'compaction', summary: true }) },
    ])
    w('opencode-parts.json', [
      { id: 'p1', message_id: 'm1', session_id: 's', time_created: 1, data: JSON.stringify({ type: 'compaction', auto: false }) },
      { id: 'p2', message_id: 'm2', session_id: 's', time_created: 2, data: JSON.stringify({ type: 'text', text: 'Summary: asked [prompt: boundary-trust]' }) },
    ])
    const run = parseRun('opencode', tmp)
    expect(run.events.map((e) => e.kind)).toEqual(['compaction'])
  })
})

describe('refused calls and pushed ids', () => {
  it('says how a call was refused', () => {
    expect(refusal({})).toBe('')
    expect(refusal({ denied: 'user-rejected' })).toBe(' (declined by the operator; it never ran)')
    expect(refusal({ denied: 'declined' })).toBe(' (declined by the operator; it never ran)')
    expect(refusal({ denied: 'permission-rule' })).toBe(' (refused by a rule or hook; it never ran)')
    expect(refusal({ denied: 'automode-blocked' })).toBe(' (refused (automode-blocked); it never ran)')
  })

  it('dates an id to the first push that brought its line in, through later renames', () => {
    const pushed = introducedBy([{ seq: 10, map: new Map([['a', 'x']]) }, { seq: 20, map: new Map([['x', 'y'], ['b', 'z']]) }])
    expect([...pushed].sort()).toEqual([['y', 10], ['z', 20]])
  })
})

describe('phrases in free text', () => {
  const names = (text: string, phrase: string) => mentions(spaced(text), spaced(phrase))
  it('reads a phrase through a line break and markdown emphasis, and never through a missing word', () => {
    expect(names('The bastion accepts SSH without\nMFA from anywhere.', 'ssh without mfa')).toBe(true)
    expect(names('**Unauthenticated** admin listener on 9090', 'unauthenticated admin')).toBe(true)
    expect(names('Set `sslmode=disable` in db.py', 'sslmode=disable')).toBe(true)
    expect(names('The bastion accepts SSH without\nlogging.', 'ssh without mfa')).toBe(false)
    expect(names('**Unauthenticated**', 'unauthenticated admin')).toBe(false)
  })
})

describe('a question asked only for a crossing to ratify', () => {
  const sheetOf = (required: string) => parseAnswerSheet(`version: 1\nprompts:\n  - id: approved-channels\n    trigger: "x"\n    mandatory: true\n    required: ${required}\n    how: typed\n    reply: "Ratify it."\n`)
  const notShown = (externalIngress?: boolean) =>
    h7({ sheet: sheetOf('if_external_ingress'), shown: [], replies: [], pairs: [], mode: 'loopback', ...(externalIngress === undefined ? {} : { externalIngress }) }).findings.map((f) => f.code)

  it('requires it only when the model has a crossing, and when that is unknown', () => {
    expect(notShown(true)).toEqual(['prompt_not_shown'])
    expect(notShown(false)).toEqual([])
    expect(notShown()).toEqual(['prompt_not_shown'])
  })

  it('reads the new requirement on the sheet, and no other', () => {
    expect(sheetOf('if_external_ingress').prompts[0]!.required).toBe('if_external_ingress')
    expect(() => sheetOf('sometimes')).toThrow(/required must be/)
  })
})

describe('a question asked only before a review is recorded', () => {
  const sheet = parseAnswerSheet('version: 1\nprompts:\n  - id: review-record\n    trigger: "x"\n    mandatory: true\n    required: if_reviewable\n    how: option-or-typed\n    reply: "record"\n')
  const notShown = (reviewable?: boolean) => h7({ sheet, shown: [], replies: [], pairs: [], mode: 'loopback', ...(reviewable === undefined ? {} : { reviewable }) }).findings.map((f) => f.code)

  it('requires it only when the run could record a review, and when that is unknown', () => {
    expect(sheet.prompts[0]!.required).toBe('if_reviewable')
    expect(notShown(true)).toEqual(['prompt_not_shown'])
    expect(notShown(false)).toEqual([])
    expect(notShown()).toEqual(['prompt_not_shown'])
  })

  it('reads the run as able to record one when its final Gate 3 passes or it asked to move to REVIEWED', () => {
    const { ev } = eventBuilder()
    const asked = [ev({ kind: 'tool_call', tool: 'dethereal.model_state', callId: 't', input: { action: 'transition', to: 'REVIEWED' } })]
    const other = [ev({ kind: 'tool_call', tool: 'dethereal.model_state', callId: 'u', input: { action: 'transition', to: 'ENRICHING' } })]
    expect(reviewable(other, 'PASS')).toBe(true)
    expect(reviewable(asked, 'FAIL')).toBe(true)
    expect(reviewable(other, 'FAIL')).toBe(false)
    expect(reviewable(other, undefined)).toBeUndefined()
    expect(reviewable(asked, undefined)).toBe(true)
  })
})
