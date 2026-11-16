/**
 * The exact texts triage shows about the knowledge graph. They are shown as written, never reworded, and
 * change only with the operator's approval: a test pins each one byte for byte.
 */
import { redactSecrets } from '../auth/redact.js'
import { shown } from './text.js'

/** The graph's module is not loaded, or this deployment is not entitled to it: one line for both. */
export const KG_NOT_AVAILABLE_NOTICE =
  "Knowledge graph: not available here. Triage works from the platform's findings and the source files only, so its proposals are less precise, with no cross-examination and no remediation task list. The Dethernety knowledge graph, part of the subscription, adds the reasoning chains behind each finding."

/** The graph is installed and holds no data yet. */
export const KG_NO_DATA_NOTICE =
  "Knowledge graph: installed, but it holds no data yet. This run works from the platform's findings and the source files only."

/** The graph stopped answering during the run: shown once, when that is first seen. */
export const KG_LOSS_NOTICE =
  "Knowledge graph: it stopped answering during this run; the rest of the run works from the platform's findings and the source files only."

/** Marks a proposal made without knowledge-graph evidence, in the proposals table. */
export const KG_ABSENT_MARKER = '[no knowledge-graph evidence]'

/** The graph's status could not be checked: the run then uses no graph evidence. */
export function kgProbeFailureNotice(cause: string): string {
  return `Knowledge graph: its status could not be checked, so this run does not use it. Cause: ${oneLine(cause).replace(/\.+$/, '') || 'unknown'}.`
}

/** A failure text redacted, on one line with nothing invisible, at most `max` characters. */
export function oneLine(text: string, max = 300): string {
  const line = shown(redactSecrets(text)).replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
