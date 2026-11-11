/**
 * detect_drift: the changed file set since a model's baseline, from a hardened git.
 *
 * The expected sets are frozen in the scenarios, first captured from the script
 * this tool replaced; while it exists, a second test runs it on the same
 * repositories and must agree. Renames and copies now list both paths, which
 * the script never did.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { detectDriftTool, MAX_SCOPED } from '../detect-drift.tool.js'
import { initProjectRoot, resetProjectRoot } from '../../utils/project-root.js'
import { SCENARIOS, HERMETIC_GIT_ENV, git, write, commitAll, setBaseline } from './fixtures/drift-scenarios.js'

const SCRIPT = path.resolve(import.meta.dirname, '..', '..', '..', 'scripts', 'detect-drift.js')

interface Outcome {
  success: boolean
  data?: Record<string, unknown>
  error?: string
}

describe('detect_drift', () => {
  let tmp: string
  let repo: string
  const saved = { home: process.env.HOME }

  const run = async (dir: string): Promise<Outcome> => {
    initProjectRoot({ cwd: repo, env: {} })
    return (await detectDriftTool.run({ directory_path: dir }, { debug: false })) as Outcome
  }

  beforeEach(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-drift-')))
    fs.mkdirSync(path.join(tmp, 'home'))
    process.env.HOME = path.join(tmp, 'home')
    repo = path.join(tmp, 'repo')
    fs.mkdirSync(repo)
  })
  afterEach(() => {
    resetProjectRoot()
    process.env.HOME = saved.home
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  describe('parity with the frozen expectations', () => {
    it.each(SCENARIOS.map((s) => [s.name, s] as const))('%s', async (_name, scenario) => {
      const model = scenario.build(repo)
      const out = await run(model)
      expect(out.success).toBe(true)
      expect(out.data!.scoped).toEqual(scenario.scoped)
      expect(out.data!.renamed).toEqual(scenario.renamed ?? [])
      expect(out.data!.copied).toEqual(scenario.copied ?? [])
      // A rename or copy lists the path it came from too: a file moved away from what discovery read is drift.
      for (const p of [...(scenario.renamed ?? []), ...(scenario.copied ?? [])]) expect(out.data!.scoped).toEqual(expect.arrayContaining([p.from, p.to]))
      expect(out.data!.baseline).toMatch(/^[0-9a-f]{40}$/)
      expect(out.data).not.toHaveProperty('omitted')
    })

    it.skipIf(!fs.existsSync(SCRIPT))('the script being replaced agrees on every scenario', () => {
      for (const scenario of SCENARIOS) {
        const dir = fs.mkdtempSync(path.join(tmp, 'script-'))
        const model = scenario.build(dir)
        const stdout = execFileSync(process.execPath, [SCRIPT, '--model-dir', model], { env: HERMETIC_GIT_ENV, encoding: 'utf8' })
        expect((JSON.parse(stdout) as { scoped: string[] }).scoped, scenario.name).toEqual(scenario.scoped)
      }
    }, 60_000)

    it('lists a file whose timestamps changed without a content change (over-reports, never misses)', async () => {
      const model = SCENARIOS[0]!.build(repo)
      const future = new Date(Date.now() + 60_000)
      fs.utimesSync(path.join(repo, 'infra/main.tf'), future, future)
      const out = await run(model)
      expect(out.data!.scoped).toEqual(['infra/main.tf'])
    })
  })

  describe('refusals', () => {
    const refusal = (out: Outcome) => (out.data as { error: string; hint: string }).error

    it('refuses a directory outside the project', async () => {
      const model = SCENARIOS[0]!.build(repo)
      initProjectRoot({ cwd: repo, env: {} })
      const elsewhere = fs.mkdtempSync(path.join(tmp, 'elsewhere-'))
      const out = (await detectDriftTool.run({ directory_path: elsewhere }, { debug: false })) as Outcome
      expect(out.success).toBe(false)
      expect(refusal(out)).toBe('outside-root')
      expect(model).toBeTruthy()
    })

    it('refuses a missing directory', async () => {
      git(repo, 'init', '-q')
      expect(refusal(await run(path.join(repo, 'nope')))).toBe('not-found')
    })

    it('refuses a directory that is not a repository', async () => {
      fs.mkdirSync(path.join(repo, '.dethernety'))
      setBaseline(repo, 'a'.repeat(40))
      expect(refusal(await run(repo))).toBe('not-a-git-repo')
    })

    it('refuses a model without state or without a baseline', async () => {
      git(repo, 'init', '-q', '-b', 'main')
      write(repo, 'README.md', 'x')
      commitAll(repo)
      expect(refusal(await run(repo))).toBe('missing-baseline')
      write(repo, '.dethereal/state.json', JSON.stringify({ currentState: 'DISCOVERED' }))
      expect(refusal(await run(repo))).toBe('missing-baseline')
    })

    it('refuses a baseline that is not in the branch history', async () => {
      const model = SCENARIOS[0]!.build(repo)
      git(repo, 'checkout', '-q', '-b', 'side')
      write(repo, 'side.txt', 'x')
      const side = commitAll(repo)
      git(repo, 'checkout', '-q', 'main')
      setBaseline(model, side)
      expect(refusal(await run(model))).toBe('ancestry-broken')
    })

    it.each([
      ['an option', '--output=/tmp/dethereal-drift-injected'],
      ['a ref name', 'HEAD'],
      ['a short hex', 'abc1234'],
      ['a command substitution', '$(id)'],
      ['41 hex', 'a'.repeat(41)],
      ['a number', 1234567],
      ['an object', { sha: 'x' }],
    ])('refuses a baseline that is %s, before git sees it', async (_label, baseline) => {
      git(repo, 'init', '-q', '-b', 'main')
      write(repo, 'README.md', 'x')
      commitAll(repo)
      write(repo, '.dethereal/state.json', JSON.stringify({ lastReconcileCommit: baseline }))
      expect(refusal(await run(repo))).toBe('invalid-baseline')
      expect(fs.existsSync('/tmp/dethereal-drift-injected')).toBe(false)
    })

    it('refuses a symlinked state file without reading it', async () => {
      const model = SCENARIOS[0]!.build(repo)
      const target = path.join(tmp, 'secret.json')
      fs.writeFileSync(target, JSON.stringify({ lastReconcileCommit: 'b'.repeat(40) }))
      fs.rmSync(path.join(model, '.dethereal', 'state.json'))
      fs.symlinkSync(target, path.join(model, '.dethereal', 'state.json'))
      const out = await run(model)
      expect(refusal(out)).toBe('missing-baseline')
      expect(JSON.stringify(out)).not.toContain('b'.repeat(40))
    })

    it('never passes a path or git message in a refusal', async () => {
      const out = await run(path.join(repo, 'nope'))
      expect(out.error).toMatch(/^[a-z-]+: [a-z0-9 .,-]+$/i)
      expect(JSON.stringify(out)).not.toContain(tmp)
    })
  })

  describe('output', () => {
    it('leaves out file names with control or invisible characters, and says so', async () => {
      const model = SCENARIOS[0]!.build(repo)
      write(repo, 'k8s/evil\nname.yaml', 'x')
      write(repo, 'k8s/evil\u202ename.yaml', 'x')
      write(repo, 'k8s/fine.yaml', 'x')
      const out = await run(model)
      expect(out.data).toMatchObject({ scoped: ['k8s/fine.yaml'], omitted: 2 })
      expect(out.data!.note).toMatch(/do not report "no drift"/)
    })

    it('caps the list and says so', async () => {
      const model = SCENARIOS[0]!.build(repo)
      for (let i = 0; i < MAX_SCOPED + 5; i++) write(repo, `k8s/f${String(i).padStart(5, '0')}.yaml`, 'x')
      const out = await run(model)
      expect(out.data!.scoped).toHaveLength(MAX_SCOPED)
      expect(out.data).toMatchObject({ truncated: true })
      expect(out.data!.note).toBeTruthy()
    }, 60_000)

    it('never runs a repository filter while listing', async () => {
      const marker = path.join(tmp, 'filter.marker')
      const script = path.join(tmp, 'filter.sh')
      fs.writeFileSync(script, `#!/bin/sh\ntouch "${marker}"\ncat\n`, { mode: 0o755 })
      const model = SCENARIOS[1]!.build(repo)
      write(repo, '.gitattributes', '*.tf filter=x\n')
      git(repo, 'config', 'filter.x.clean', script)
      const old = new Date('2000-01-01')
      fs.utimesSync(path.join(repo, '.git', 'index'), old, old)
      const out = await run(model)
      expect(out.success).toBe(true)
      expect(fs.existsSync(marker)).toBe(false)
    })
  })
})
