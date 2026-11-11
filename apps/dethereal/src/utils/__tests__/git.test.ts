/**
 * The git runner: what it passes to git, what it refuses, and — against real
 * hostile repositories — that no repository-configured program ever runs.
 *
 * Every hostile case has a control: the same git command with git's defaults does
 * run the planted program, so a clean result is the runner's doing.
 *
 * Fake gits (shell scripts on an absolute PATH entry) stand in where a real git
 * cannot show the behaviour: the environment and arguments it receives, an old
 * version, a hang, a flood. Every repository is a scratch repository with its own
 * `.git`, built without user or system configuration; HOME is a sandbox.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  runGit,
  resolveGitBinary,
  resolveBinary,
  assertGitUsable,
  openRepository,
  GitRefusal,
  NEUTRAL_DIR,
} from '../git.js'
import { HERMETIC_GIT_ENV, git as fixtureGit, write, commitAll } from '../../tools/__tests__/fixtures/drift-scenarios.js'

const REAL_PATH = process.env.PATH ?? ''

describe('git runner', () => {
  let tmp: string
  let bins: string
  let home: string
  const saved = { home: process.env.HOME, path: process.env.PATH }

  const mkdir = (...parts: string[]) => {
    const p = path.join(...parts)
    fs.mkdirSync(p, { recursive: true })
    return fs.realpathSync.native(p)
  }
  /** A marker script: running it creates `marker` (and passes stdin through, like a filter). */
  const evil = (name: string, passThrough = true) => {
    const marker = path.join(tmp, `${name}.marker`)
    const script = path.join(tmp, `${name}.sh`)
    // A filter passes content through; a transport helper or ssh command just fails.
    fs.writeFileSync(script, `#!/bin/sh\ntouch "${marker}"\n${passThrough ? 'cat' : 'exit 1'}\n`, { mode: 0o755 })
    return { marker, script }
  }
  /** A fake git in its own directory; `body` is shell. Outside the temp directories: PATH entries there are dropped. */
  const fakeGit = (body: string) => {
    const dir = mkdir(bins, `fake-${Math.random().toString(36).slice(2)}`)
    fs.writeFileSync(path.join(dir, 'git'), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
    process.env.PATH = `${dir}${path.delimiter}${REAL_PATH}`
    return dir
  }
  const repo = (name: string, files: Record<string, string> = { 'a.tf': 'x' }) => {
    const dir = mkdir(tmp, name)
    fixtureGit(dir, 'init', '-q', '-b', 'main')
    for (const [rel, content] of Object.entries(files)) write(dir, rel, content)
    commitAll(dir)
    return dir
  }
  /** Make every index entry racily clean: git must re-read (and filter) the files. */
  const makeRacy = (dir: string) => {
    const old = new Date('2000-01-01')
    fs.utimesSync(path.join(dir, '.git', 'index'), old, old)
  }
  /** git with its defaults (no runner): the control. */
  const plainGit = (cwd: string, args: string[], env: NodeJS.ProcessEnv = { PATH: REAL_PATH, HOME: home }) =>
    spawnSync('git', args, { cwd, env, stdio: 'ignore', timeout: 5000 })

  beforeEach(() => {
    tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-git-')))
    bins = fs.realpathSync.native(fs.mkdtempSync(path.join(process.cwd(), '.test-git-bins-')))
    home = mkdir(tmp, 'home')
    process.env.HOME = home
    process.env.PATH = REAL_PATH
  })
  afterEach(() => {
    process.env.HOME = saved.home
    process.env.PATH = saved.path
    fs.rmSync(tmp, { recursive: true, force: true })
    fs.rmSync(bins, { recursive: true, force: true })
  })

  describe('process', () => {
    it('passes exactly the hardened flags and an allow-listed environment', async () => {
      const out = path.join(tmp, 'seen')
      fakeGit(`env > "${out}.env"\nprintf '%s\\n' "$@" > "${out}.args"`)
      process.env.GIT_DIR = '/elsewhere'
      process.env.GIT_SSH_COMMAND = 'evil'
      try {
        await runGit(tmp, ['status'], { configOverrides: [['filter.x.clean', '']] })
      } finally {
        delete process.env.GIT_DIR
        delete process.env.GIT_SSH_COMMAND
      }
      const env = Object.fromEntries(
        fs.readFileSync(`${out}.env`, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
      )
      const allowed = new Set([
        'PATH', 'HOME', 'LANG', 'GIT_CONFIG_NOSYSTEM', 'GIT_NO_LAZY_FETCH', 'GIT_TERMINAL_PROMPT',
        'GIT_TRACE2', 'GIT_TRACE2_EVENT', 'GIT_TRACE2_PERF', 'GIT_CONFIG_GLOBAL',
        'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0',
        // Set by the shell itself.
        'PWD', 'SHLVL', '_', 'OLDPWD',
      ])
      expect(Object.keys(env).filter((k) => !allowed.has(k))).toEqual([])
      expect(env).toMatchObject({
        GIT_CONFIG_NOSYSTEM: '1', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
        GIT_TRACE2: '0', GIT_TRACE2_EVENT: '0', GIT_TRACE2_PERF: '0',
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'filter.x.clean', GIT_CONFIG_VALUE_0: '',
      })
      const args = fs.readFileSync(`${out}.args`, 'utf8').trim().split('\n')
      for (const flag of [
        'core.fsmonitor=false', 'core.hooksPath=/dev/null', 'safe.bareRepository=explicit', 'protocol.allow=never',
        'protocol.ext.allow=never', 'protocol.ssh.allow=never', 'protocol.file.allow=never',
        'protocol.git.allow=never', 'protocol.http.allow=never', 'protocol.https.allow=never',
      ]) {
        expect(args).toContain(flag)
      }
      expect(args).toContain('--no-optional-locks')
      expect(args.at(-1)).toBe('status')
    })

    it('drops the global config when HOME is a sandbox, and keeps it for the account home', async () => {
      const out = path.join(tmp, 'seen.env')
      fakeGit(`env > "${out}"`)
      await runGit(tmp, ['x'])
      expect(fs.readFileSync(out, 'utf8')).toContain(`GIT_CONFIG_GLOBAL=${os.devNull}`)
      process.env.HOME = os.userInfo().homedir
      await runGit(tmp, ['x'])
      expect(fs.readFileSync(out, 'utf8')).not.toContain('GIT_CONFIG_GLOBAL')
    })

    it('gives git only absolute PATH entries outside the project', async () => {
      const root = mkdir(tmp, 'project')
      const inside = mkdir(root, 'node_modules', '.bin')
      const out = path.join(tmp, 'seen.env')
      const fake = fakeGit(`env > "${out}"`)
      process.env.PATH = ['.', '', 'relative/bin', inside, fake, REAL_PATH].join(path.delimiter)
      await runGit(tmp, ['x'], { projectRoot: root })
      const childPath = /^PATH=(.*)$/m.exec(fs.readFileSync(out, 'utf8'))![1]!.split(path.delimiter)
      expect(childPath.every((e) => path.isAbsolute(e))).toBe(true)
      expect(childPath).not.toContain(inside)
      expect(childPath[0]).toBe(fake)
    })

    it('resolves any named binary by the same rule, and git through it', () => {
      // Outside the temp directories, which are never searched.
      const root = mkdir(bins, 'project-bins')
      const inside = mkdir(root, 'bin')
      const outside = mkdir(bins, 'outside-bin')
      const linkDir = mkdir(bins, 'link-bin')
      for (const dir of [inside, outside]) fs.writeFileSync(path.join(dir, 'tool-x'), '#!/bin/sh\n', { mode: 0o755 })
      fs.writeFileSync(path.join(outside, 'not-exec'), '#!/bin/sh\n', { mode: 0o644 })
      fs.symlinkSync(path.join(inside, 'tool-x'), path.join(linkDir, 'tool-x'))
      process.env.PATH = ['.', 'relative', inside, linkDir, outside, REAL_PATH].join(path.delimiter)
      expect(resolveBinary('tool-x', root)).toBe(path.join(outside, 'tool-x'))
      expect(resolveBinary('not-exec', root)).toBeNull()
      expect(resolveBinary('tool-x')).toBe(path.join(inside, 'tool-x'))
      expect(resolveGitBinary(root)).toBe(resolveBinary(process.platform === 'win32' ? 'git.exe' : 'git', root))
    })

    it('never takes a binary from a temp directory', () => {
      const temp = mkdir(tmp, 'temp-bin')
      fs.writeFileSync(path.join(temp, 'tool-t'), '#!/bin/sh\n', { mode: 0o755 })
      process.env.PATH = [temp, REAL_PATH].join(path.delimiter)
      expect(resolveBinary('tool-t')).toBeNull()
      const saved = process.env.TMPDIR
      try {
        // $TMPDIR counts by its real path, wherever it points.
        const custom = mkdir(bins, 'custom-tmp')
        fs.writeFileSync(path.join(custom, 'tool-u'), '#!/bin/sh\n', { mode: 0o755 })
        process.env.TMPDIR = custom
        process.env.PATH = [custom, REAL_PATH].join(path.delimiter)
        expect(resolveBinary('tool-u')).toBeNull()
      } finally {
        if (saved === undefined) delete process.env.TMPDIR
        else process.env.TMPDIR = saved
      }
    })

    it('never runs a git planted in the working directory or the project', async () => {
      const root = mkdir(tmp, 'project')
      const { marker, script } = evil('planted-git')
      fs.copyFileSync(script, path.join(root, 'git'))
      fs.chmodSync(path.join(root, 'git'), 0o755)
      const bin = mkdir(root, 'bin')
      fs.copyFileSync(script, path.join(bin, 'git'))
      fs.chmodSync(path.join(bin, 'git'), 0o755)
      for (const PATH of [`.${path.delimiter}${REAL_PATH}`, `${path.delimiter}${REAL_PATH}`, `${bin}${path.delimiter}${REAL_PATH}`]) {
        process.env.PATH = PATH
        const result = await runGit(root, ['version'], { projectRoot: root })
        expect(result.stdout).toMatch(/^git version/)
      }
      expect(fs.existsSync(marker)).toBe(false)
      expect(resolveGitBinary(root)).not.toContain(root)
    })

    it('kills git and everything it started on a timeout', async () => {
      const pidFile = path.join(tmp, 'grandchild.pid')
      fakeGit(`sleep 30 &\necho $! > "${pidFile}"\nwait`)
      const t0 = Date.now()
      // Long enough for the fake git to start its grandchild and write its PID, even under load.
      const result = await runGit(tmp, ['x'], { timeoutMs: 1500 })
      expect(result).toMatchObject({ code: -1, failure: 'timeout', stdout: '' })
      expect(Date.now() - t0).toBeLessThan(10_000)
      const pid = Number(fs.readFileSync(pidFile, 'utf8'))
      expect(pid).toBeGreaterThan(0)
      // The grandchild goes within a short while of the kill: polled, not a fixed wait.
      const alive = () => {
        try {
          process.kill(pid, 0)
          return true
        } catch {
          return false
        }
      }
      for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 50))
      expect(alive()).toBe(false)
    })

    it('reports too much output as a failure, never as partial output', async () => {
      fakeGit(`head -c 200000 /dev/zero | tr '\\0' 'a'`)
      expect(await runGit(tmp, ['x'], { maxBytes: 1024 })).toMatchObject({ code: -1, failure: 'overflow', stdout: '' })
    })

    it('never passes git stderr on', async () => {
      fakeGit(`echo "SECRET-STDERR" >&2\necho out\nexit 3`)
      const result = await runGit(tmp, ['x'])
      expect(JSON.stringify(result)).not.toContain('SECRET-STDERR')
      expect(result).toMatchObject({ code: 3, stdout: 'out\n' })
    })

    it.each([
      ['2.37.9', false],
      ['2.38.0', true],
      ['3.0.0', true],
    ])('requires git 2.38 or later (%s)', async (version, ok) => {
      fakeGit(`echo "git version ${version}"`)
      const check = assertGitUsable()
      if (ok) await expect(check).resolves.toBeDefined()
      else await expect(check).rejects.toMatchObject({ code: 'git-unavailable' })
    })
  })

  describe('openRepository preflight', () => {
    /** A fake git answering the preflight: version, work tree, config listing, top level. */
    const scriptedGit = (version: string, configNames: string[]) => {
      const listing = configNames.map((n) => `${n}\\0`).join('')
      fakeGit(`for a in "$@"; do last="$a"; done
case "$*" in
  *" version") echo "git version ${version}";;
  *"--is-inside-work-tree") echo true;;
  *"--get-regexp"*) if [ -n "${listing}" ]; then printf '${listing}'; else exit 1; fi;;
  *"--show-toplevel") pwd;;
esac`)
    }

    it('refuses a partial clone on a git without GIT_NO_LAZY_FETCH', async () => {
      scriptedGit('2.44.1', ['extensions.partialclone'])
      await expect(openRepository(tmp)).rejects.toMatchObject({ code: 'git-unavailable' })
      scriptedGit('2.44.1', ['remote.origin.promisor'])
      await expect(openRepository(tmp)).rejects.toMatchObject({ code: 'git-unavailable' })
    })

    it('accepts a partial clone on git 2.45 or later', async () => {
      scriptedGit('2.45.0', ['extensions.partialclone'])
      await expect(openRepository(tmp)).resolves.toBeDefined()
    })

    it('refuses a repository that sets core.worktree', async () => {
      scriptedGit('2.55.0', ['core.worktree'])
      await expect(openRepository(tmp)).rejects.toMatchObject({ code: 'unsupported-repository' })
    })

    it('refuses a directory that is not in a work tree', async () => {
      await expect(openRepository(mkdir(tmp, 'plain'))).rejects.toMatchObject({ code: 'not-a-git-repo' })
    })

    it('reports an unreadable configuration as a failure, never as "no drivers"', async () => {
      const dir = repo('broken-include')
      fs.writeFileSync(path.join(tmp, 'broken.cfg'), '[[[not config\n')
      fixtureGit(dir, 'config', 'include.path', path.join(tmp, 'broken.cfg'))
      // Refused at the first git call that reads it; never read as "no drivers".
      await expect(openRepository(dir)).rejects.toBeInstanceOf(GitRefusal)
    })

    it('refuses a repository whose top level is the home directory', async () => {
      fixtureGit(home, 'init', '-q', '-b', 'main')
      const dir = mkdir(home, 'project')
      await expect(openRepository(dir)).rejects.toMatchObject({ code: 'unsupported-repository' })
    })
  })

  describe('hostile repositories (real git)', () => {
    it('never runs a clean filter, even on racily clean files', async () => {
      const { marker, script } = evil('filter')
      const dir = repo('filter', { 'a.tf': 'x', 'b.tf': 'y' })
      fs.writeFileSync(path.join(dir, '.gitattributes'), '*.tf filter=x\n')
      fixtureGit(dir, 'config', 'filter.x.clean', script)
      fixtureGit(dir, 'config', 'filter.x.process', script)
      makeRacy(dir)
      const r = await openRepository(dir)
      await r.run(['diff-files', '--name-only', '-z', '--ignore-submodules=all'])
      expect(fs.existsSync(marker)).toBe(false)
      // Control: git's defaults run the driver.
      makeRacy(dir)
      plainGit(dir, ['diff-files', '--name-only'])
      expect(fs.existsSync(marker)).toBe(true)
    })

    it.each([
      ['an empty driver name', '', '* filter=\n'],
      ['a mixed-case name with a dot', 'Evil.Drv', '*.tf filter=Evil.Drv\n'],
    ])('neutralises %s', async (_label, driver, attributes) => {
      const { marker, script } = evil(`driver-${driver || 'empty'}`)
      const dir = repo(`drv-${driver || 'empty'}`)
      fs.writeFileSync(path.join(dir, '.gitattributes'), attributes)
      fs.appendFileSync(path.join(dir, '.git', 'config'), `[filter "${driver}"]\n\tclean = ${script}\n\tprocess = ${script}\n`)
      makeRacy(dir)
      const r = await openRepository(dir)
      await r.run(['diff-files', '--name-only', '-z'])
      expect(fs.existsSync(marker)).toBe(false)
      makeRacy(dir)
      plainGit(dir, ['diff-files', '--name-only'])
      expect(fs.existsSync(marker)).toBe(true)
    })

    it('never looks into a submodule whose name matches a glob', async () => {
      const { marker, script } = evil('submodule')
      const dir = repo('super')
      const sub = mkdir(dir, 'evil.tf')
      fixtureGit(sub, 'init', '-q', '-b', 'main')
      write(sub, 'inner.txt', 'x')
      commitAll(sub)
      fixtureGit(dir, 'add', 'evil.tf')
      commitAll(dir)
      // Armed only after the fixture's own commits, which would otherwise trip it.
      fs.writeFileSync(path.join(sub, '.git', 'info', 'attributes'), '* filter=x\n')
      fixtureGit(sub, 'config', 'filter.x.clean', script)
      // Unchanged but racily clean: a status inside the submodule must re-read it.
      makeRacy(sub)
      const r = await openRepository(dir)
      await r.run(['diff-files', '--name-only', '-z', '--ignore-submodules=all', '--', ':(top,glob)**/*.tf'])
      await r.run(['diff-index', '--cached', '--name-only', '-z', '--ignore-submodules=all', 'HEAD', '--', ':(top,glob)**/*.tf'])
      expect(fs.existsSync(marker)).toBe(false)
      makeRacy(sub)
      plainGit(dir, ['diff-files', '--name-only', '--', ':(top,glob)**/*.tf'])
      expect(fs.existsSync(marker)).toBe(true)
    })

    it('never fetches for a partial clone, whatever transport the repository enables', async () => {
      const { marker, script } = evil('helper', false)
      const helperDir = mkdir(tmp, 'helpers')
      fs.copyFileSync(script, path.join(helperDir, 'git-remote-evil'))
      fs.chmodSync(path.join(helperDir, 'git-remote-evil'), 0o755)
      process.env.PATH = `${REAL_PATH}${path.delimiter}${helperDir}`
      const dir = repo('promisor')
      for (const [k, v] of [
        ['core.repositoryformatversion', '1'],
        ['extensions.partialClone', 'origin'],
        ['remote.origin.url', 'evil::x'],
        ['remote.origin.promisor', 'true'],
        ['protocol.evil.allow', 'always'],
        ['core.sshCommand', script],
      ]) fixtureGit(dir, 'config', k!, v!)
      // A git older than 2.45 cannot read a partial clone without fetching: the repository is refused,
      // before any command that could fetch. A newer one reads it with lazy fetching off.
      const [major, minor] = await assertGitUsable()
      if (major < 2 || (major === 2 && minor < 45)) {
        await expect(openRepository(dir)).rejects.toThrow(/a partial clone needs git 2\.45 or later/)
      } else {
        const r = await openRepository(dir)
        expect(await r.resolveCommit('d'.repeat(40))).toBeNull()
      }
      expect(fs.existsSync(marker)).toBe(false)
      // Control: git's defaults do call the helper.
      plainGit(dir, ['rev-parse', '--verify', '--quiet', `${'d'.repeat(40)}^{commit}`], { PATH: process.env.PATH, HOME: home })
      expect(fs.existsSync(marker)).toBe(true)
    }, 30_000)

    it('never uses a bare repository planted in the model directory', async () => {
      const { marker, script } = evil('bare', false)
      const dir = repo('outer')
      const model = mkdir(dir, 'model')
      mkdir(model, 'objects')
      mkdir(model, 'refs')
      fs.writeFileSync(path.join(model, 'HEAD'), 'ref: refs/heads/main\n')
      fs.writeFileSync(path.join(model, 'config'), [
        '[core]', '\trepositoryformatversion = 1', '\tbare = true', `\tfsmonitor = ${script}`, `\tsshCommand = ${script}`,
        '[extensions]', '\tpartialClone = origin',
        '[remote "origin"]', '\turl = ssh://example.invalid/x.git', '\tpromisor = true',
      ].join('\n'))
      const r = await openRepository(model).catch((e: unknown) => e)
      if (!(r instanceof GitRefusal)) await (r as Awaited<ReturnType<typeof openRepository>>).resolveCommit('d'.repeat(40))
      expect(fs.existsSync(marker)).toBe(false)
      plainGit(model, ['rev-parse', '--verify', '--quiet', `${'d'.repeat(40)}^{commit}`], {
        PATH: REAL_PATH, HOME: home, GIT_TERMINAL_PROMPT: '0',
      })
      expect(fs.existsSync(marker)).toBe(true)
    }, 30_000)

    it('ignores a trace2 target in a sandbox home config', async () => {
      const target = path.join(tmp, 'trace.json')
      fs.writeFileSync(path.join(home, '.gitconfig'), `[trace2]\n\teventTarget = ${target}\n`)
      const dir = repo('trace')
      const r = await openRepository(dir)
      await r.run(['rev-parse', 'HEAD'])
      expect(fs.existsSync(target)).toBe(false)
      plainGit(dir, ['rev-parse', 'HEAD'])
      expect(fs.existsSync(target)).toBe(true)
    })

    it('ignores the parent environment (GIT_DIR, GIT_WORK_TREE)', async () => {
      const dir = repo('env')
      const other = repo('other', { 'z.tf': 'z' })
      process.env.GIT_DIR = path.join(other, '.git')
      process.env.GIT_WORK_TREE = other
      try {
        const r = await openRepository(dir)
        expect(r.toplevel).toBe(dir)
      } finally {
        delete process.env.GIT_DIR
        delete process.env.GIT_WORK_TREE
      }
    })
  })

  describe('assertGitUsable', () => {
    it('checks the git version outside every repository: a .git planted in $TMPDIR is never found', async () => {
      const planted = mkdir(tmp, 'planted-tmp')
      fixtureGit(planted, 'init', '-q', '-b', 'main')
      const out = path.join(tmp, 'seen.cwd')
      fakeGit([
        `printf '%s|%s|%s\\n' "$(pwd -P)" "\${GIT_CEILING_DIRECTORIES-unset}" "$*" >> "${out}"`,
        'case "$*" in',
        '  *version*) echo "git version 2.50.0" ;;',
        '  *) exit 1 ;;',
        'esac',
      ].join('\n'))
      const saved = process.env.TMPDIR
      process.env.TMPDIR = planted
      try {
        await assertGitUsable()
      } finally {
        if (saved === undefined) delete process.env.TMPDIR
        else process.env.TMPDIR = saved
      }
      const runs = fs.readFileSync(out, 'utf8').trim().split('\n').map((l) => l.split('|'))
      const neutral = runs.filter(([, , args]) => /version/.test(args!))
      expect(neutral.length).toBeGreaterThanOrEqual(1)
      for (const [cwd, ceiling] of neutral) {
        expect(cwd).toBe(fs.realpathSync.native(NEUTRAL_DIR))
        expect(ceiling).toBe(NEUTRAL_DIR)
      }
    })
  })
})

// The fixture module's hermetic env is what builds every repository here.
void HERMETIC_GIT_ENV
void execFileSync
