#!/usr/bin/env node
/* global process, setTimeout, URL */
/**
 * Codex PreToolUse hook: keeps each Dethereal agent to its own tools.
 *
 * Codex gives an agent every tool its parent has, and ignores tool lists in agent files, so this
 * hook is the restriction. A call from a thread whose `agent_type` is not `dethereal-…` passes
 * untouched (nothing is printed). For a Dethereal agent it denies: any collaboration tool (an
 * agent never starts or messages another), `apply_patch` unless the agent may write, any other
 * MCP server's tool, and any Dethereal tool outside the agent's list in `leaf-allowlist.json`.
 *
 * It fails closed for a Dethereal agent: input it cannot parse is scanned for the agent type,
 * a missing or unreadable list denies, an unknown `dethereal-…` type denies, and any error or the
 * deadline denies when the caller is, or may be, a Dethereal agent. Codex accepts only a deny
 * from this hook; a pass prints nothing. A reason has no closing full stop: Codex adds its own.
 * Only `node:` builtins, so it runs without the server.
 */
import { readFileSync } from 'node:fs'

const DEADLINE_MS = 6000
const COLLABORATION = new Set(['spawn_agent', 'send_message', 'followup_task', 'wait_agent', 'close_agent', 'resume_agent', 'list_agents', 'interrupt_agent'])
const AGENT_TYPE = /"agent_type"\s*:\s*"(dethereal-[^"\\]*)"/
const DETHEREAL_MCP = 'mcp__dethereal__'

function deny(reason) {
  process.stdout.write(
    JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Dethereal: ${reason.replace(/\.$/, '')}` } }),
  )
  process.exit(0)
}

function pass() {
  process.exit(0)
}

function loadAllowlist() {
  const text = readFileSync(new URL('./leaf-allowlist.json', import.meta.url), 'utf8')
  const list = JSON.parse(text)
  if (!list || typeof list !== 'object' || Array.isArray(list)) throw new Error('the agent tool list is not an object')
  return list
}

function decide(raw) {
  let event
  try {
    event = JSON.parse(raw)
  } catch {
    const found = AGENT_TYPE.exec(raw)
    if (found) deny(`${found[1]}: this call could not be read, so it is not run.`)
    pass()
  }
  const agent = event && typeof event.agent_type === 'string' ? event.agent_type : ''
  if (!agent.startsWith('dethereal-')) pass()
  const tool = typeof event.tool_name === 'string' ? event.tool_name.replace(/^collaboration[._:/]?/, '') : ''
  if (!tool) deny(`${agent}: this call names no tool, so it is not run.`)
  let list
  try {
    list = loadAllowlist()
  } catch {
    deny(`${agent}: the agent tool list could not be read, so no checked tool runs.`)
  }
  const entry = list[agent]
  if (!entry || typeof entry !== 'object') deny(`${agent} is not a known Dethereal agent, so its checked tools do not run.`)
  const mcp = Array.isArray(entry.mcp) ? entry.mcp : []
  if (COLLABORATION.has(tool)) deny(`${agent} may not start, message or manage other agents.`)
  if (tool === 'apply_patch') {
    if (entry.write === true) pass()
    deny(`${agent} may not change files.`)
  }
  if (tool.startsWith('mcp__')) {
    if (!tool.startsWith(DETHEREAL_MCP)) deny(`${agent} may use only Dethereal tools, not ${tool}.`)
    if (mcp.includes(tool)) pass()
    deny(`${agent} may not call ${tool}${mcp.length ? `; it may use ${mcp.join(', ')}` : '; it may use no Dethereal tool'}.`)
  }
  pass()
}

let raw = ''
const timer = setTimeout(() => {
  if (AGENT_TYPE.test(raw) || !/"agent_type"\s*:/.test(raw)) deny('this call could not be checked in time, so it is not run.')
  pass()
}, DEADLINE_MS)
timer.unref()
try {
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    raw += chunk
  })
  process.stdin.on('end', () => {
    try {
      decide(raw)
    } catch {
      if (AGENT_TYPE.test(raw)) deny('this call could not be checked, so it is not run.')
      pass()
    }
  })
  process.stdin.on('error', () => {
    if (AGENT_TYPE.test(raw)) deny('this call could not be read, so it is not run.')
    pass()
  })
} catch {
  deny('this call could not be checked, so it is not run.')
}
