/**
 * The operator facts a sheet reply gives only when its question asks for them (a prompt's `facts:`), read from
 * the run itself: the table rows each logged reply answered, as the run kit reads its turn.
 *
 * - A fact the reply gave while no row before the question named one of its substrings, or in a reply mode its
 *   `only_modes` leaves out, was volunteered: the run broke the protocol (`fact_unasked`).
 * - A fact a row asked for that the reply did not give was withheld: the run stays valid, and the verdict names it
 *   as a marginal reason, since a gate it fails may rest on the fact it never had. Only a reply whose sheet text
 *   (the logged variant's, else the prompt's) holds the facts line can withhold one.
 *
 * Only the lines logged under the prompt that owns the facts are read.
 */
import { factInMode, holdsFacts, rowsName, tableRows, type AnswerSheet, type ReplyMode } from '../answer-sheet.js'
import type { TranscriptEvent } from '../transcripts/types.js'
import { normaliseReply, operatorInputs, type ReplyMatch } from './replies.js'
import type { ReplyLine, RunDirProblem } from './run-dir.js'

/**
 * The table rows an operator input answered: the main session's assistant and question text after the last
 * operator input before it (a compaction is no input), up to it.
 */
export function tableRowsFor(events: TranscriptEvent[], answer: number): string {
  const from = operatorInputs(events).filter((i) => i.kind !== 'compaction' && i.event < answer).at(-1)?.event ?? -1
  return tableRows(events.filter((e) => e.actor === 'main' && e.seq > from && e.seq < answer && (e.kind === 'assistant' || e.kind === 'ask')).map((e) => e.text ?? ''))
}

export interface FactCheck {
  /** Facts given without being asked for, or outside their modes */
  unasked: RunDirProblem[]
  /** Facts asked for and not given, in words */
  withheld: string[]
}

export function checkFacts(sheet: AnswerSheet, events: TranscriptEvent[], replies: ReplyLine[], pairs: ReplyMatch['pairs'], mode: ReplyMode): FactCheck {
  const out: FactCheck = { unasked: [], withheld: [] }
  for (const pair of pairs) {
    const r = replies[pair.line - 1]
    const prompt = r && sheet.prompts.find((p) => p.id === r.prompt)
    if (!r || !prompt?.facts.length) continue
    const rows = tableRowsFor(events, pair.event)
    const said = normaliseReply(r.text)
    const fills = holdsFacts(r.variant !== undefined ? prompt.variants[r.variant - 1]?.reply ?? '' : prompt.reply)
    for (const f of prompt.facts) {
      const given = said.includes(normaliseReply(f.text))
      const asked = rowsName(rows, f.ifTableContainsAny)
      const where = `replies.jsonl line ${pair.line} (${prompt.id})`
      if (given && !factInMode(f, mode)) out.unasked.push({ code: 'fact_unasked', detail: `${where} gives fact ${f.id}, which a ${mode} run never gives` })
      else if (given && !asked) out.unasked.push({ code: 'fact_unasked', detail: `${where} gives fact ${f.id}, and no table row before the question asked for it` })
      else if (!given && asked && fills && factInMode(f, mode)) out.withheld.push(`${where} was asked for fact ${f.id} and did not give it`)
    }
  }
  return out
}
