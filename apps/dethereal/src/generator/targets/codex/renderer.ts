/**
 * How Codex spells the neutral tokens and the tool vocabulary.
 *
 * Codex facts behind the choices: skills are invoked as `$<plugin>:<skill>`; agents are spawned
 * with `spawn_agent`, whose `fork_turns` defaults to the whole conversation (and then inherits
 * the caller's model and effort), so every delegation passes `fork_turns: "none"`; a finished
 * agent keeps counting against the session's agent limit until `close_agent`, so every
 * delegation closes its agent once the answer is in; there is no
 * file-read tool, files are read through the shell.
 */

import { type AskLayout, renderAsk } from '../../ask-cues.js'
import { FAIL_CLOSED, flatAgentName, leafMcpTools, quoted } from '../common.js'
import type { InlineKind, TokenRenderer } from '../../tokens.js'
import { PLUGIN_NAME } from '../../types.js'

export const MCP_TOOL_PREFIX = `mcp__${PLUGIN_NAME}__`

/** Codex's own tools for reading (through the shell) and writing files. */
export const SHELL_TOOLS = ['exec_command', 'write_stdin'] as const
export const WRITE_TOOLS = ['apply_patch'] as const
/** Tools for starting and steering other agents: never a leaf's. */
export const COLLABORATION_TOOLS = ['spawn_agent', 'send_message', 'followup_task', 'wait_agent', 'close_agent', 'resume_agent', 'list_agents', 'interrupt_agent'] as const


export const agentName = flatAgentName

export interface CodexTools {
  /** Dethereal MCP tools by Codex name, sorted. */
  readonly mcp: readonly string[]
  readonly useShell: boolean
  readonly write: boolean
  /** Entries outside the vocabulary, as written (harness literals). */
  readonly literal: readonly string[]
}

/** Neutral tool entries → what a Codex agent may use. */
export function codexTools(entries: readonly string[]): CodexTools {
  const mcp = new Set<string>()
  let useShell = false
  let write = false
  const literal: string[] = []
  for (const entry of entries) {
    if (entry === 'fs-read' || entry === 'fs-search' || entry === 'shell') useShell = true
    else if (entry === 'fs-write') {
      write = true
      useShell = true
    } else if (entry === 'mcp:*') for (const t of leafMcpTools([entry])) mcp.add(`${MCP_TOOL_PREFIX}${t}`)
    else if (entry.startsWith('mcp:')) mcp.add(`${MCP_TOOL_PREFIX}${entry.slice(4)}`)
    else literal.push(entry)
  }
  return { mcp: [...mcp].sort(), useShell, write, literal }
}


/** Start a leaf and wait for it; `trailing` ends the instruction (the fail-closed rule by default). */
export function delegation(agent: string, message: string, trailing: string = FAIL_CLOSED): string {
  return (
    `Use the \`spawn_agent\` tool with \`agent_type: "${agentName(agent)}"\`, \`fork_turns: "none"\` and this message:${quoted(message)}` +
    `Then wait for its final answer with \`wait_agent\`, and once you have it close the agent with \`close_agent\` — a finished agent counts against the session's agent limit until it is closed; if you have no \`close_agent\` tool, go on, and if a later \`spawn_agent\` fails on the agent limit, stop and tell the operator. ${trailing}`
  )
}

export const codexRenderer: TokenRenderer = {
  inline(kind: InlineKind, name: string, inCode: boolean): string {
    if (kind === 'args') return 'the text the operator supplied with the skill invocation, or the arguments a skill that handed over to this one named'
    // Codex has no tool that starts a skill: the model opens the skill's file from its skill list.
    if (kind === 'skill') return inCode ? `${PLUGIN_NAME}:${name}` : `the \`${PLUGIN_NAME}:${name}\` skill (open its \`SKILL.md\`, whose path is in your skill list, and read it in full; its arguments are the ones named here)`
    const text = kind === 'tool' ? `${MCP_TOOL_PREFIX}${name}` : kind === 'cmd' ? `$${PLUGIN_NAME}:${name}` : agentName(name)
    return inCode ? text : `\`${text}\``
  },
  delegate: (agent: string, prompt: string) => delegation(agent, prompt),
  ask: (id: string, question: string, freeText: boolean, layout: AskLayout) => renderAsk('codex', id, question, freeText, layout),
  asFile(fileName: string, skill: string): string {
    return `Read the file \`${fileName}\` from the directory of the \`${PLUGIN_NAME}:${skill}\` skill's \`SKILL.md\` (its path is in your skill list), in full.`
  },
}

/** A forked skill's body, rendered as a task file for the agent that runs it. */
export const codexTaskRenderer: TokenRenderer = {
  ...codexRenderer,
  inline(kind, name, inCode) {
    return kind === 'args' ? "the operator's text quoted in your task message" : codexRenderer.inline(kind, name, inCode)
  },
  asFile(fileName: string): string {
    return `Read the file \`${fileName}\` from the same directory as your task file, in full.`
  },
}
