/**
 * The hidden-edges workflow: the questions the skill asks are the ones its tools return, as registered; the
 * analyst can only read and argue, never write or add a candidate, on every harness.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { GOLDEN_HARNESSES, PACKAGE_GOLDENS, WORKFLOW } from '../cli.js'
import { APPLY_ASK, applyAsk, REVIEW_ASK, reviewAsk } from '../../hidden-edges/asks.js'
import type { Harness } from '../types.js'

const source = readFileSync(path.join(WORKFLOW, 'skills', 'hidden-edges', 'SKILL.md'), 'utf8')
const agentSource = readFileSync(path.join(WORKFLOW, 'agents', 'hidden-edge-analyst.md'), 'utf8')
const agentFile = (harness: Harness) =>
  harness === 'claude' ? 'bundles/claude/agents/hidden-edge-analyst.md' : harness === 'codex' ? 'bundles/codex/agents/dethereal-hidden-edge-analyst.toml' : 'bundles/opencode/agents/dethereal-hidden-edge-analyst.md'

describe('the hidden-edges workflow', () => {
  it('asks the questions its tools return, as registered', () => {
    const asked = (id: string) => {
      const m = source.match(new RegExp(`\\{\\{#ask id=${id}(?: [a-z]+)*\\}\\}([\\s\\S]*?)\\{\\{/ask\\}\\}`))
      expect(m, id).not.toBeNull()
      return m![1]!
    }
    const registry = parseYaml(readFileSync(path.join(WORKFLOW, 'shared', 'prompts.yaml'), 'utf8')) as { prompts: Array<{ id: string; skill: string; requires?: string[] }> }
    for (const [id, text] of [['hidden-edges-review', REVIEW_ASK], ['hidden-edges-apply', APPLY_ASK]] as const) {
      expect(asked(id)).toBe(text)
      const entry = registry.prompts.find((p) => p.id === id)
      expect(entry?.skill).toBe('hidden-edges')
      for (const required of entry?.requires ?? []) expect(text).toContain(required)
    }
    expect(reviewAsk()).toBe(`[prompt: hidden-edges-review] ${REVIEW_ASK}`)
    expect(applyAsk(3)).toBe('[prompt: hidden-edges-apply] Apply 3 hidden-edge change(s)? Type yes or cancel.')
  })

  it('gives the analyst reads, file search and the technique lookup only, and no part in what is proposed', () => {
    const tools = /^tools:\n((?: {2}- .+\n)+)/m.exec(agentSource)![1]!.split('\n').filter(Boolean).map((l) => l.replace(/^ *- /, ''))
    // It gets no dossier of cited paths: it finds the project's files by name, then reads them.
    expect(tools).toEqual(['fs-read', 'fs-search', 'mcp:search_mitre_attack'])
    expect(agentSource).toContain('You never propose a new edge, another direction, or another kind')
    expect(source).toContain('Every candidate comes from the module: you add none.')
    for (const harness of GOLDEN_HARNESSES) {
      const text = readFileSync(path.join(PACKAGE_GOLDENS, harness, agentFile(harness)), 'utf8')
      expect(text, harness).not.toMatch(/hidden_edges|manage_hidden_edges/)
    }
  })

  it('names only refusal codes the tools return', () => {
    const tools = ['src/tools/hidden-edges.tool.ts', 'src/tools/manage-hidden-edges.tool.ts', 'src/hidden-edges/open.ts', 'src/hidden-edges/analyst.ts', 'src/hidden-edges/platform.ts', 'src/tools/base-tool.ts', 'src/utils/settle-plans.ts']
      .map((p) => readFileSync(path.join(WORKFLOW, '..', p), 'utf8')).join('\n')
    const codes = ['push_first', 'sync_first', 'decisions_unreadable', 'session_refused', 'review_stale', 'plan_stale', 'plan_expired', 'key_unavailable', 'reply_not_answer', 'locator_invalid', 'module_not_loaded']
    for (const code of codes) {
      expect(source, code).toContain(code)
      expect(tools, code).toContain(`'${code}'`)
    }
  })
})
