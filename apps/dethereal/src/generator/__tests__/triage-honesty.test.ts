/**
 * The remediation task list's words stay those of dt-module's honesty check: the workflow names every term the
 * check refuses and no other, carries the citation line as written, and its fixed header lines pass the check.
 */

import { CITATION_ASYMMETRY_LINE, FORBIDDEN_REMEDIATION_VERBS, lintRemediationText } from '@dethernety/dt-module/remediation-honesty'
import { describe, expect, it } from 'vitest'
import { WORKFLOW } from '../cli.js'
import { readWorkflow } from '../source.js'

const tasks = readWorkflow(WORKFLOW).get('shared/triage-tasks.md')!.replace(/\s+/g, ' ')
const AS_OF = 'Task list derived from the threat model\'s attributes as of <date>; applying changes alters the model — re-run analysis and triage to confirm.'

describe('the remediation task list and the honesty check', () => {
  it('names exactly the terms the check refuses', () => {
    const m = tasks.match(/Compose it without these words in your own text, noun forms included: ([^.]+)\./)
    expect(m, 'the word list').not.toBeNull()
    expect(m![1]!.split(', ').sort()).toEqual([...FORBIDDEN_REMEDIATION_VERBS].sort())
  })

  it('carries both header lines as written, and they pass the check', () => {
    expect(tasks).toContain(`\`${CITATION_ASYMMETRY_LINE}\``)
    expect(tasks).toContain(`\`${AS_OF}\``)
    expect(lintRemediationText(`${AS_OF.replace('<date>', '2026-01-02')}\n${CITATION_ASYMMETRY_LINE}`)).toEqual([])
  })

  it('checks and writes the composed text in one server call, and never writes it any other way', () => {
    expect(tasks).toContain('**Check and write in one call.** {{tool:triage_review}} `tasks`')
    expect(tasks).toContain('Never write the list, or any draft of it, with your edit tool or the shell.')
    expect(tasks).toContain('`claims_found`: nothing was written.')
    expect(tasks).toContain('`tasks_exist`: show it as returned. A file is at the path that this call did not write or check; never call it the task list, and never say nothing is there.')
    expect(tasks).toContain('quoted as written: each field whole, as its own line')
  })
})
