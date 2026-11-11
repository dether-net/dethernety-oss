import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { runInstaller } from '../../cli/index.js'
import { doctorSuite, root, node, seq, home, codexHome, io, deps, doctor, find, installAll } from './doctor-harness.js'

doctorSuite()

describe('doctor: what the harness CLIs list', () => {
  it('reads the dethereal server as OpenCode lists it, every layer applied', async () => {
    await installAll()
    expect(find((await doctor(['--harness', 'opencode'])).checks, 'opencode', 'OpenCode MCP list')).toMatchObject({ status: 'ok', detail: 'connected' })
    const listing = (status: string, command: string) => async () => `\u25cf  \u2713 dethereal \x1b[90m${status}\n\u2502      \x1b[90m${command}\n`
    const launch = JSON.parse(await fs.readFile(path.join(home, '.config', 'opencode', 'opencode.json'), 'utf8')).mcp.dethereal.command.join(' ')
    const cases: Array<[unknown, string, string]> = [
      [listing('disabled', launch), 'fail', 'OpenCode shows the dethereal server as disabled'],
      [listing('connected', '/bin/sh -c evil'), 'fail', 'a configuration layer redefines the dethereal server'],
      [async () => '\u2514  0 server(s)\n', 'fail', 'OpenCode does not list the dethereal server'],
      [async () => 'missing', 'warn', 'OpenCode was not found; not checked'],
      [async () => null, 'warn', 'opencode mcp list could not be run'],
    ]
    for (const [fake, status, detail] of cases) {
      expect(find((await doctor(['--harness', 'opencode'], { openCodeMcpList: fake })).checks, 'opencode', 'OpenCode MCP list'), detail).toMatchObject({ status, detail })
    }
  })

  it('lists a project\'s servers only with --live-opencode, since listing starts them', async () => {
    const project = path.join(home, 'oc-proj')
    await fs.mkdir(project)
    const r = io()
    expect(await runInstaller('install', ['--harness', 'opencode', '--scope', 'project', '--project', project], r.io, deps() as never), r.text()).toBe(0)
    const asked: string[] = []
    const spy = async (_e: unknown, cwd: string) => { asked.push(cwd); return null }
    await doctor(['--harness', 'opencode', '--project', project], { openCodeMcpList: spy })
    expect(asked).toEqual([])
  })

  it('reads the dethereal server as Codex lists it from the project asked about, trusted layers merged', async () => {
    await installAll()
    expect(find((await doctor(['--harness', 'codex'])).checks, 'codex', 'Codex MCP list')).toMatchObject({ status: 'ok', detail: 'enabled, as installed' })
    const project = path.join(home, 'cx-layer')
    await fs.mkdir(path.join(project, '.codex'), { recursive: true })
    await fs.appendFile(path.join(codexHome, 'config.toml'), `\n[projects.${JSON.stringify(project)}]\ntrust_level = "trusted"\n`)
    const layer = path.join(project, '.codex', 'config.toml')
    for (const [text, detail] of [
      ['[mcp_servers.dethereal]\nenabled = false\n', 'a configuration layer disables the dethereal server'],
      ['[mcp_servers.dethereal]\ncommand = "/bin/sh"\n', 'a configuration layer redefines the dethereal server'],
      // Only the URL changed: sign-in would go to another platform.
      ['[mcp_servers.dethereal.env]\nDETHERNETY_URL = "https://elsewhere.example"\n', 'a configuration layer redefines the dethereal server'],
      ['[mcp_servers.dethereal]\ncwd = "/tmp"\n', 'a configuration layer redefines the dethereal server'],
    ] as const) {
      await fs.writeFile(layer, text)
      expect(find((await doctor(['--harness', 'codex', '--project', project])).checks, 'codex', 'Codex MCP list'), detail).toMatchObject({ status: 'fail', detail })
    }
    // From anywhere else, the project's layer does not apply.
    expect(find((await doctor(['--harness', 'codex'])).checks, 'codex', 'Codex MCP list')).toMatchObject({ status: 'ok' })
    // A server Codex does not list at all.
    const file = path.join(codexHome, 'config.toml')
    await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace(/\[mcp_servers\.dethereal[^\n]*\][^[]*/g, ''))
    expect(find((await doctor(['--harness', 'codex'])).checks, 'codex', 'Codex MCP list')).toMatchObject({ status: 'fail', detail: 'Codex does not list the dethereal server' })
  })

  it('with --live-opencode, says whether OpenCode loads the plugin', async () => {
    await installAll()
    // A stand-in OpenCode: registers the plugin file unless told not to, and logs a load failure when told to.
    const bin = path.join(root, `oc-bin-${seq}`)
    await fs.mkdir(bin)
    await fs.writeFile(path.join(bin, 'opencode.mjs'), `
      import fs from 'node:fs'; import path from 'node:path'; import { pathToFileURL } from 'node:url'
      const home = process.env.HOME, mode = fs.readFileSync(path.join(home, 'oc-mode'), 'utf8').trim(), a = process.argv.slice(2).join(' ')
      const plugin = pathToFileURL(path.join(home, '.config', 'opencode', 'plugins', 'dethereal.ts')).href
      if (a === 'debug config') process.stdout.write(JSON.stringify({ plugin: mode === 'unregistered' ? [] : [plugin] }))
      else if (a === 'debug agent build --print-logs') { process.stdout.write('{}'); process.stderr.write(mode === 'failed' ? 'ERROR failed to load plugin dethereal\\n' : 'INFO plugin loaded\\n') }
      else process.stdout.write('{}')`)
    await fs.writeFile(path.join(bin, 'opencode'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(bin, 'opencode.mjs'))} "$@"\n`, { mode: 0o755 })
    const before = process.env.PATH
    process.env.PATH = [bin, before].join(path.delimiter)
    try {
      for (const [mode, status, detail] of [['ok', 'ok', undefined], ['unregistered', 'fail', 'OpenCode does not register the Dethereal plugin'], ['failed', 'fail', 'OpenCode reported a plugin that failed to load or configure']] as const) {
        await fs.writeFile(path.join(home, 'oc-mode'), mode)
        const c = find((await doctor(['--harness', 'opencode', '--live-opencode'])).checks, 'opencode', 'plugin loaded')
        expect(c, mode).toMatchObject({ status, ...(detail ? { detail } : {}) })
      }
    } finally {
      process.env.PATH = before
    }
  })
})
