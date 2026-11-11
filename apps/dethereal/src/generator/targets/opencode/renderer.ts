/**
 * How OpenCode spells the neutral tokens.
 *
 * OpenCode facts behind the choices: MCP tools are `<server>_<tool>`; skills and commands are
 * flat, so everything is prefixed `dethereal-`; agents are started with the `task` tool, whose
 * `prompt` is all the agent receives; the `question` tool asks with options (and a free
 * answer); and a skill is also served as a command template, so skill text must not hold
 * template syntax.
 */

import { type AskLayout, renderAsk } from '../../ask-cues.js'
import { FAIL_CLOSED, flatAgentName, quoted } from '../common.js'
import type { InlineKind, TokenRenderer } from '../../tokens.js'
import { PLUGIN_NAME } from '../../types.js'

export const agentName = flatAgentName



/** Start a leaf and wait for it; `trailing` ends the instruction (the fail-closed rule by default). */
export function delegation(agent: string, prompt: string, trailing: string = FAIL_CLOSED): string {
  return (
    `Use the \`task\` tool with \`subagent_type: "${agentName(agent)}"\`, a 3–5 word \`description\`, and this prompt:${quoted(prompt)}` +
    `Wait for its result. ${trailing}`
  )
}

export const openCodeRenderer: TokenRenderer = {
  inline(kind: InlineKind, name: string, inCode: boolean): string {
    if (kind === 'args') return 'the arguments given with the command, or those a skill that handed over to this one named'
    if (kind === 'skill') return inCode ? agentName(name) : `the \`${agentName(name)}\` skill (load it with the \`skill\` tool, which takes only its name; its arguments are the ones named here)`
    const text = kind === 'tool' ? `${PLUGIN_NAME}_${name}` : kind === 'cmd' ? `/${agentName(name)}` : agentName(name)
    return inCode ? text : `\`${text}\``
  },
  delegate: (agent: string, prompt: string) => delegation(agent, prompt),
  ask: (id: string, question: string, freeText: boolean, layout: AskLayout) => renderAsk('opencode', id, question, freeText, layout),
  asFile(fileName: string): string {
    return `Read the file \`${fileName}\` with the \`read\` tool, from this skill's base directory (shown when the skill was loaded), in full.`
  },
}

/** A forked skill's body as the command template its agent runs: OpenCode substitutes `$ARGUMENTS`. */
export const openCodeCommandRenderer: TokenRenderer = {
  ...openCodeRenderer,
  inline(kind, name, inCode) {
    return kind === 'args' ? '$ARGUMENTS' : openCodeRenderer.inline(kind, name, inCode)
  },
  asFile(fileName: string): string {
    // Rejected before emission (a command's agent sees no skill directory); kept total for rendering.
    return `Read the file \`${fileName}\`.`
  },
}

/** A forked skill's body as a task file for the agent the skill starts. */
export const openCodeTaskRenderer: TokenRenderer = {
  ...openCodeRenderer,
  inline(kind, name, inCode) {
    return kind === 'args' ? "the operator's text quoted in your task prompt" : openCodeRenderer.inline(kind, name, inCode)
  },
  asFile(fileName: string): string {
    return `Read the file \`${fileName}\` with the \`read\` tool, from the same directory as your task file, in full.`
  },
}
