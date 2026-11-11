/**
 * How a question renders in a skill: its tag, its text, and a short cue that names how to ask it.
 * The gate rules themselves (table first, write nothing until the answer, ask again after a
 * compaction) live once, in the core rules' asking rule, which every skill with questions carries.
 */

import type { Harness } from './types.js'

/** The heading the asking rule carries; the ask lint looks for it. */
export const ASKING_RULE = 'The asking rule.'

/** The rule that a dismissed question decides nothing; the ask lint requires it wherever a question is asked. */
export const DISMISSAL_RULE = 'A dismissed question is not answered.'

/**
 * How a choice is asked: a dialog where the harness has one; `table` — it follows a table, so on
 * Claude it is asked in the message that shows the table; `message` — in one message on every
 * harness, because its reply may carry facts in the operator's own words.
 */
export type AskLayout = 'dialog' | 'table' | 'message'

export function askCue(harness: Harness, id: string, freeText: boolean, layout: AskLayout = 'dialog'): string {
  if (freeText) return harness === 'opencode' ? '— a plain message; end your turn; unanswered → ask again.' : '— a plain message; end your turn.'
  switch (harness) {
    case 'claude':
      // A dialog alone shows the operator nothing else: a choice that follows a table is asked in the message that shows it
      // (a question group in a phase is the exception: one dialog after all its tables).
      if (layout === 'table') return '— the table, then the question with its choices numbered, in one message; end your turn.'
      if (layout === 'message') return '— what it follows, then the question with its choices numbered, in one message; end your turn.'
      return '— table first, then AskUserQuestion, the tag first in its question text.'
    case 'codex':
      if (layout === 'message') return '— what it follows, then a numbered list, in one message; end your turn.'
      return '— table first, a numbered list; end your turn.'
    case 'opencode':
      if (layout === 'message') return '— what it follows, then the question with its choices numbered, in one message, not the `question` tool; end your turn; unanswered → ask again.'
      return `— table first, the \`question\` tool, header \`${id}\`; unanswered → ask again.`
  }
}

/** A question as a skill shows it: the tag, the question, and the cue after its last line. */
export function renderAsk(harness: Harness, id: string, question: string, freeText: boolean, layout: AskLayout = 'dialog'): string {
  return `\`[prompt: ${id}]\` ${question} ${askCue(harness, id, freeText, layout)}`
}
