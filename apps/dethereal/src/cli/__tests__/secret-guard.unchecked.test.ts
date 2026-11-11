/**
 * The check of the server's own folder fails closed: a command it cannot finish judging is denied as unchecked,
 * never passed on to the project's checks. Nothing a command can spell makes it fail today, so the failure is
 * put in by hand: path resolution throws for one word.
 */
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import os from 'node:os'

vi.mock('node:path', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('node:path') & { default: typeof import('node:path') }
  const resolve = (...parts: string[]) => {
    if (parts.some((p) => p.includes('unplaceable-word'))) throw new Error('resolution failed')
    return actual.resolve(...parts)
  }
  return { ...actual, resolve, default: { ...actual.default, resolve } }
})

const { decideSecretAccess } = await import('../secret-guard.js')
const { rawEventFrom } = await import('../config-guard.js')
const path = (await import('node:path')).default

describe('a command the folder check cannot finish', () => {
  it('is denied as unchecked', () => {
    const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'secret-guard-unchecked-')))
    try {
      const home = path.join(tmp, 'home')
      mkdirSync(path.join(home, '.dethernety'), { recursive: true })
      const project = path.join(tmp, 'project')
      mkdirSync(project)
      const g = { env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, cwd: project, platform: 'linux' as const, now: Date.now }
      const d = decideSecretAccess(rawEventFrom(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat unplaceable-word' }, cwd: project })), g)
      expect(d.deny).toBe(true)
      expect(d.deny ? d.reason : '').toMatch(/could not be checked for secret files \(its words could not be placed\)/)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
