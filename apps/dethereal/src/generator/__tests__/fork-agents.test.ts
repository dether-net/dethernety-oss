/**
 * Every skill that runs forked on an agent leaves that agent turns enough to finish: a fork that
 * reaches its agent's turn cap ends without an answer, and the operator then sees nothing of it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseAgent, parseSkill } from '../workflow.js'

const WORKFLOW = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'workflow')
const MIN_TURNS = 30

describe('forked skills and the agents they run on', () => {
  const skills = readdirSync(path.join(WORKFLOW, 'skills')).flatMap((name) => {
    let text: string
    try {
      text = readFileSync(path.join(WORKFLOW, 'skills', name, 'SKILL.md'), 'utf8')
    } catch {
      return []
    }
    const meta = parseSkill(`skills/${name}/SKILL.md`, name, text, 'claude').meta
    return meta?.forkAgent ? [{ name, agent: meta.forkAgent, body: text }] : []
  })

  it('finds the forked skills', () => {
    expect(skills.map((s) => s.name)).toEqual(expect.arrayContaining(['review', 'surface']))
  })

  it.each(skills.map((s) => [s.name, s.agent, s.body] as const))('%s runs on %s, whose turn cap leaves room to answer', (_skill, agent, body) => {
    const file = `agents/${agent}.md`
    const meta = parseAgent(file, agent, readFileSync(path.join(WORKFLOW, file), 'utf8'), 'claude').meta
    expect(meta?.maxTurns).toBeGreaterThanOrEqual(MIN_TURNS)
    // and the body tells the agent to keep turns for its answer, marking what it did not finish
    expect(body).toMatch(/Keep turns for the answer: after about \d+ turns of gathering, stop and write the \w+ from what you have, and mark each part you did not finish "not checked"/)
    const turns = Number(/after about (\d+) turns of gathering/.exec(body)![1])
    expect(turns).toBeLessThan(meta!.maxTurns!)
  })
})
