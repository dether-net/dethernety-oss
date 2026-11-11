/**
 * How Claude Code spells the neutral tokens and tool vocabulary.
 */

import { type AskLayout, renderAsk } from '../../ask-cues.js'
import { FAIL_CLOSED, quoted } from '../common.js'
import type { InlineKind, TokenRenderer } from '../../tokens.js'
import { PLUGIN_NAME } from '../../types.js'

export const MCP_TOOL_PREFIX = `mcp__plugin_${PLUGIN_NAME}_${PLUGIN_NAME}__`


const TOOL_GROUPS: Readonly<Record<string, readonly string[]>> = {
  'fs-read': ['Read'],
  'fs-search': ['Glob', 'Grep'],
  'fs-write': ['Write', 'Edit'],
  shell: ['Bash'],
}

/** Neutral tool entries → Claude tool names, in source order, without duplicates. */
export function claudeTools(entries: readonly string[]): string[] {
  const out: string[] = []
  for (const entry of entries) {
    const mapped = TOOL_GROUPS[entry] ?? (entry.startsWith('mcp:') ? [`${MCP_TOOL_PREFIX}${entry.slice(4)}`] : [entry])
    for (const name of mapped) if (!out.includes(name)) out.push(name)
  }
  return out
}


export const claudeRenderer: TokenRenderer = {
  inline(kind: InlineKind, name: string, inCode: boolean): string {
    if (kind === 'args') return '$ARGUMENTS'
    if (kind === 'skill') return inCode ? `/${PLUGIN_NAME}:${name}` : `the \`/${PLUGIN_NAME}:${name}\` skill`
    const text = kind === 'tool' ? `${MCP_TOOL_PREFIX}${name}` : kind === 'cmd' ? `/${PLUGIN_NAME}:${name}` : `${PLUGIN_NAME}:${name}`
    return inCode ? text : `\`${text}\``
  },
  delegate(agent: string, prompt: string): string {
    return `Invoke the \`Agent\` tool with \`subagent_type: "${PLUGIN_NAME}:${agent}"\` and this prompt:${quoted(prompt)}Wait for its result. ${FAIL_CLOSED}`
  },
  ask: (id: string, question: string, freeText: boolean, layout: AskLayout) => renderAsk('claude', id, question, freeText, layout),
  asFile(fileName: string, _skill: string): string {
    return `Read the file \`\${CLAUDE_SKILL_DIR}/${fileName}\` in full.`
  },
}
