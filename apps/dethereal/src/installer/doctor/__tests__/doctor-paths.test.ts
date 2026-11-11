import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { probeServer } from '../../core/server-probe.js'
import { runInstaller } from '../../cli/index.js'
import { doctorSuite, root, nodeBin, node, seq, home, version, io, deps, doctor, find, installAll, trustHooks } from './doctor-harness.js'

doctorSuite()

describe('doctor: PATH entries, projects and folders', () => {
  it('checks a project install without the project\'s own PATH entries, and shows the home as ~', async () => {
    const project = path.join(home, 'proj')
    await fs.mkdir(path.join(project, 'bin'), { recursive: true })
    // A node the repository itself ships, first on PATH: never the one doctor starts the server with.
    const marker = path.join(root, `project-node-ran-${seq}`)
    await fs.writeFile(path.join(project, 'bin', 'node'), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 })
    const r = io()
    expect(await runInstaller('install', ['--harness', 'claude', '--scope', 'project', '--project', project, '--platform-url', 'http://127.0.0.1:9'], r.io, deps() as never), r.text() + r.err()).toBe(0)
    const before = process.env.PATH
    process.env.PATH = [path.join(project, 'bin'), before].join(path.delimiter)
    try {
      const { checks } = await doctor(['--harness', 'claude', '--project', project])
      expect(find(checks, 'claude', 'server starts'), JSON.stringify(checks)).toMatchObject({ status: 'ok' })
      expect(checks.filter((c) => c.subject.startsWith('claude')).map((c) => c.subject)).toContain('claude (project ~/proj)')
      expect(JSON.stringify(checks)).not.toContain(home)
      await expect(fs.access(marker)).rejects.toThrow()
    } finally {
      process.env.PATH = before
    }
  })

  it('asks Codex about its plugins with the project\'s own PATH entries left out', async () => {
    const project = path.join(home, 'cx')
    await fs.mkdir(path.join(project, 'bin'), { recursive: true })
    const marker = path.join(root, `project-codex-ran-${seq}`)
    await fs.writeFile(path.join(project, 'bin', 'codex'), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexit 1\n`, { mode: 0o755 })
    const r = io()
    expect(await runInstaller('install', ['--harness', 'codex', '--scope', 'user', '--platform-url', 'http://127.0.0.1:9'], r.io, deps() as never), r.text() + r.err()).toBe(0)
    const before = process.env.PATH
    process.env.PATH = [path.join(project, 'bin'), before].join(path.delimiter)
    try {
      const { checks } = await doctor(['--harness', 'codex', '--project', project])
      expect(find(checks, 'codex', 'plugin')).toMatchObject({ status: 'ok' })
      await expect(fs.access(marker)).rejects.toThrow()
    } finally {
      process.env.PATH = before
    }
  })

  it('leaves out the PATH entries of the project asked about for a user install too', async () => {
    const project = path.join(home, 'asked')
    await fs.mkdir(path.join(project, 'bin'), { recursive: true })
    const marker = path.join(root, `asked-node-ran-${seq}`)
    await fs.writeFile(path.join(project, 'bin', 'node'), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\nexec ${JSON.stringify(process.execPath)} "$@"\n`, { mode: 0o755 })
    const r = io()
    expect(await runInstaller('install', ['--harness', 'claude', '--scope', 'user', '--platform-url', 'http://127.0.0.1:9'], r.io, deps() as never), r.text()).toBe(0)
    const before = process.env.PATH
    process.env.PATH = [path.join(project, 'bin'), before].join(path.delimiter)
    try {
      const { checks } = await doctor(['--harness', 'claude', '--project', project])
      expect(find(checks, 'claude', 'server starts')).toMatchObject({ status: 'ok' })
      await expect(fs.access(marker)).rejects.toThrow()
    } finally {
      process.env.PATH = before
    }
  })

  it('checks another recorded project statically, OpenCode\'s version included', async () => {
    const project = path.join(home, 'other')
    await fs.mkdir(project)
    const r = io()
    expect(await runInstaller('install', ['--harness', 'opencode', '--scope', 'project', '--project', project], r.io, deps() as never), r.text()).toBe(0)
    // Asked without --project: that project is another one, and nothing runs in it.
    const probed: string[] = []
    const spy: typeof probeServer = async (launch, e, o) => { probed.push(launch.cwd); return probeServer(launch, e, o) }
    const { checks } = await doctor(['--harness', 'opencode'], { probe: spy })
    expect(find(checks, 'opencode', 'OpenCode version')).toMatchObject({ status: 'ok' })
    expect(find(checks, 'opencode', 'server starts')).toBeUndefined()
    expect(probed).toEqual([])
  })

  it('names the cause when the codex CLI is not found, and says when one that is there could not be asked', async () => {
    await installAll()
    const bins = path.join(root, 'bins')
    const notFound = 'the codex CLI was not found on PATH (PATH folders inside node_modules, or inside the project, are skipped)'
    // The only codex on PATH sits in a node_modules folder: skipped, as for every harness CLI.
    const modules = path.join(root, 'node_modules', '.bin')
    await fs.mkdir(modules, { recursive: true })
    await fs.copyFile(path.join(bins, 'codex-bin', 'codex'), path.join(modules, 'codex'))
    await fs.chmod(path.join(modules, 'codex'), 0o755)
    const before = process.env.PATH
    process.env.PATH = [nodeBin, path.join(bins, 'claude-bin'), modules].join(path.delimiter)
    try {
      const { checks } = await doctor(['--harness', 'codex'])
      expect(find(checks, 'codex', 'plugin')).toMatchObject({ status: 'fail', detail: notFound, fix: 'install Codex, or put the folder holding codex on PATH' })
      expect(find(checks, 'codex', 'Codex MCP list')).toMatchObject({ status: 'warn', detail: notFound })
    } finally {
      process.env.PATH = before
    }
    // A codex that is there but fails to answer.
    const control = path.join(bins, 'codex-bin', 'control.json')
    await fs.writeFile(control, JSON.stringify({ fail: ['plugin list', 'mcp list'] }))
    try {
      const { checks } = await doctor(['--harness', 'codex'])
      expect(find(checks, 'codex', 'plugin')).toMatchObject({ status: 'fail', detail: 'Codex could not be asked (codex plugin list failed)' })
      expect(find(checks, 'codex', 'Codex MCP list')).toMatchObject({ status: 'warn', detail: 'codex mcp list could not be run' })
    } finally {
      await fs.rm(control)
    }
  })

  it('runs nothing for a user install from a temporary folder, and OpenCode there with no project configuration', async () => {
    await installAll()
    await trustHooks()
    // Stand-ins that record where they run: a configuration planted above that folder is what they would read.
    const bin = path.join(root, `cwd-bin-${seq}`)
    await fs.mkdir(bin)
    const log = path.join(root, `cwd-log-${seq}.jsonl`)
    await fs.writeFile(path.join(bin, 'opencode.mjs'), `
      import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url'
      const a = process.argv.slice(2).join(' ')
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cmd: 'opencode', cwd: process.cwd(), noProject: process.env.OPENCODE_DISABLE_PROJECT_CONFIG ?? null, a }) + '\\n')
      const plugin = pathToFileURL(path.join(process.env.HOME, '.config', 'opencode', 'plugins', 'dethereal.ts')).href
      if (a === 'debug config') process.stdout.write(JSON.stringify({ plugin: [plugin] }))
      else if (a === 'debug agent build --print-logs') { process.stdout.write('{}'); process.stderr.write('INFO plugin loaded\\n') }
      else if (a !== 'mcp list --pure') process.stdout.write('{}')`)
    await fs.writeFile(path.join(bin, 'opencode'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(bin, 'opencode.mjs'))} "$@"\n`, { mode: 0o755 })
    await fs.writeFile(path.join(bin, 'codex'), `#!/bin/sh\nprintf '{"cmd":"codex","cwd":"%s"}\\n' "$(pwd -P)" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(path.join(root, 'bins', 'codex-bin', 'codex'))} "$@"\n`, { mode: 0o755 })
    const probed: string[] = []
    const spy: typeof probeServer = async (launch, e, o) => { probed.push(launch.cwd); return probeServer(launch, e, o) }
    const before = process.env.PATH
    process.env.PATH = [bin, before].join(path.delimiter)
    try {
      await doctor(['--live-opencode'], { probe: spy, openCodeMcpList: undefined })
    } finally {
      process.env.PATH = before
    }
    const fsRoot = path.parse(process.cwd()).root
    const tmp = await fs.realpath(os.tmpdir())
    const runs = (await fs.readFile(log, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { cmd: string; cwd: string; noProject?: string | null; a?: string })
    const opencode = runs.filter((r) => r.cmd === 'opencode')
    // mcp list, debug config, debug agent build --print-logs, and the two pure agent views.
    expect(opencode.map((r) => r.a).sort()).toEqual(['debug agent build --print-logs', 'debug agent build --pure', 'debug agent plan --pure', 'debug config', 'mcp list --pure'])
    for (const r of opencode) expect(r, r.a).toMatchObject({ cwd: fsRoot, noProject: '1' })
    expect(runs.filter((r) => r.cmd === 'codex').length).toBeGreaterThan(0)
    for (const r of runs.filter((r) => r.cmd === 'codex')) expect(r.cwd).toBe(fsRoot)
    // The server probes of all three harnesses.
    expect(probed).toHaveLength(3)
    for (const c of [...probed, ...runs.map((r) => r.cwd)]) expect(c.startsWith(tmp + path.sep) || c === tmp, c).toBe(false)
    expect(probed.every((c) => c === fsRoot), probed.join(', ')).toBe(true)
  })
})
