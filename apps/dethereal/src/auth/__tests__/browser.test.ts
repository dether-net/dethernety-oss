/**
 * The browser launcher: it opens only the local sign-in URL, through a fixed
 * system launcher chosen per platform, with an allowlisted environment and no
 * stdio, and its errors are fixed texts. Platforms and the spawner are injected,
 * so no browser starts here.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchCommand, openBrowser, signInPort, type LaunchCommand } from '../browser.js'

const URL_OK = 'http://127.0.0.1:43123/start'
const originalPath = process.env.PATH

afterEach(() => {
  process.env.PATH = originalPath
})

const hostileEnv: NodeJS.ProcessEnv = {
  HOME: '/home/u',
  DISPLAY: ':0',
  WAYLAND_DISPLAY: 'wayland-0',
  DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1/bus',
  BROWSER: '/tmp/evil',
  LD_PRELOAD: '/tmp/evil.so',
  LD_LIBRARY_PATH: '/tmp',
  DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
  NODE_OPTIONS: '--require /tmp/evil.js',
  BASH_ENV: '/tmp/evil.sh',
  ENV: '/tmp/evil.sh',
  SystemRoot: 'C:\\Windows',
}

function command(url: string, context: Parameters<typeof launchCommand>[1]): LaunchCommand {
  const result = launchCommand(url, context)
  if (result instanceof Error) throw result
  return result
}

describe('signInPort', () => {
  it('accepts exactly the local sign-in URL', () => {
    expect(signInPort('http://127.0.0.1:1/start')).toBe(1)
    expect(signInPort('http://127.0.0.1:65535/start')).toBe(65535)
    expect(signInPort(URL_OK)).toBe(43123)
  })

  it.each([
    'http://127.0.0.1:0/start',
    'http://127.0.0.1:65536/start',
    'http://127.0.0.1:080/start',
    'http://127.0.0.1/start',
    'https://127.0.0.1:43123/start',
    'http://localhost:43123/start',
    'http://[::1]:43123/start',
    'http://127.0.0.1:43123/start?x=1',
    'http://127.0.0.1:43123/start#x',
    'http://127.0.0.1:43123/start/',
    'http://127.0.0.1:43123/callback',
    'http://user@127.0.0.1:43123/start',
    'HTTP://127.0.0.1:43123/start',
    ' http://127.0.0.1:43123/start',
    'http://127.0.0.1:43123/start\n',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://evil.example/start',
  ])('refuses %j', (url) => {
    expect(signInPort(url)).toBeNull()
    const result = launchCommand(url, { platform: 'darwin' })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toBe('Refused to open a browser: only the local sign-in page can be opened.')
  })

  it('refuses a value that is not a string', () => {
    for (const value of [undefined, null, 43123, { toString: () => URL_OK }]) expect(signInPort(value)).toBeNull()
  })
})

describe('launchCommand', () => {
  it('uses /usr/bin/open on macOS, from the home directory, with an allowlisted environment', () => {
    const cmd = command(URL_OK, { platform: 'darwin', env: hostileEnv, home: '/home/u', projectRoot: '/work/p' })
    expect(cmd).toMatchObject({ file: '/usr/bin/open', args: [URL_OK], cwd: '/home/u' })
    for (const key of ['BROWSER', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS', 'BASH_ENV', 'ENV']) {
      expect(cmd.env, key).not.toHaveProperty(key)
    }
    expect(cmd.env).toMatchObject({ HOME: '/home/u', DISPLAY: ':0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1/bus' })
  })

  it('refuses a home directory inside the project, whose configuration the project would supply', () => {
    const inHome = launchCommand(URL_OK, { platform: 'linux', env: {}, home: '/work/p/home', projectRoot: '/work/p', isExecutable: () => true })
    expect(inHome).toBeInstanceOf(Error)
    expect((inHome as Error).message).toMatch(/home directory is inside the project/)
    const winProfile = launchCommand(URL_OK, { platform: 'win32', env: { USERPROFILE: 'D:\\work\\p\\u' }, home: 'C:\\Users\\u', projectRoot: 'D:\\work\\p' })
    expect(winProfile).toBeInstanceOf(Error)
  })

  it('passes no path inside the project, and a session bus only as a plain socket outside it', () => {
    const env = {
      XDG_DATA_DIRS: '/work/p/share:/usr/share:relative/share::/usr/local/share',
      XDG_CONFIG_DIRS: '/work/p/xdg',
      XDG_CONFIG_HOME: '/work/p/.config',
      XDG_RUNTIME_DIR: '/run/user/1',
      XAUTHORITY: '/work/p/.Xauthority',
    }
    const cmd = command(URL_OK, { platform: 'linux', env, home: '/home/u', projectRoot: '/work/p', isExecutable: () => true })
    expect(cmd.env.XDG_DATA_DIRS).toBe('/usr/share:/usr/local/share')
    for (const key of ['XDG_CONFIG_DIRS', 'XDG_CONFIG_HOME', 'XAUTHORITY']) expect(cmd.env, key).not.toHaveProperty(key)
    expect(cmd.env.XDG_RUNTIME_DIR).toBe('/run/user/1')
    const bus = (address: string) => command(URL_OK, { platform: 'linux', env: { DBUS_SESSION_BUS_ADDRESS: address }, home: '/home/u', projectRoot: '/work/p', isExecutable: () => true }).env.DBUS_SESSION_BUS_ADDRESS
    expect(bus('unix:path=/run/user/1/bus')).toBe('unix:path=/run/user/1/bus')
    expect(bus(`unix:abstract=/tmp/dbus-x,guid=${'a'.repeat(32)}`)).toBe(`unix:abstract=/tmp/dbus-x,guid=${'a'.repeat(32)}`)
    for (const bad of ['unix:path=/work/p/bus', 'unixexec:path=/bin/sh', 'tcp:host=evil,port=1', 'unix:path=/run/bus;unixexec:path=/bin/sh', 'unix:path=relative']) {
      expect(bus(bad), bad).toBeUndefined()
    }
    const win = command(URL_OK, { platform: 'win32', env: { APPDATA: 'D:\\work\\p\\AppData', TEMP: 'C:\\Temp' }, home: 'C:\\Users\\u', projectRoot: 'D:\\work\\p' })
    expect(win.env).not.toHaveProperty('APPDATA')
    expect(win.env.TEMP).toBe('C:\\Temp')
  })

  it('compares paths as the file system resolves them: a symlinked parent, dotted names, letter case on Windows', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-launch-')))
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), '.test-launch-out-')))
    try {
      fs.symlinkSync(root, path.join(outside, 'into-project'))
      const env = { XDG_CONFIG_HOME: path.join(outside, 'into-project', 'cfg'), XDG_DATA_DIRS: `${path.join(root, '..share')}:${outside}` }
      const cmd = command(URL_OK, { platform: 'linux', env, home: outside, projectRoot: root, isExecutable: () => true })
      expect(cmd.env).not.toHaveProperty('XDG_CONFIG_HOME')
      expect(cmd.env.XDG_DATA_DIRS).toBe(outside)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
    const win = command(URL_OK, {
      platform: 'win32', env: { LOCALAPPDATA: 'd:\\WORK\\P\\local', TMP: 'D:\\work\\p\\..tmp', TEMP: 'D:\\work\\p\\tmp' },
      home: 'C:\\Users\\u', projectRoot: 'D:\\work\\p',
    })
    for (const key of ['LOCALAPPDATA', 'TMP', 'TEMP']) expect(win.env, key).not.toHaveProperty(key)
  })

  it('drops a runtime directory inside the project, and a bus address the library would unescape', () => {
    const cmd = command(URL_OK, { platform: 'linux', env: { XDG_RUNTIME_DIR: '/work/p/run', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/work%2fp/bus' }, home: '/home/u', projectRoot: '/work/p', isExecutable: () => true })
    expect(cmd.env).not.toHaveProperty('XDG_RUNTIME_DIR')
    expect(cmd.env).not.toHaveProperty('DBUS_SESSION_BUS_ADDRESS')
    const guid = command(URL_OK, { platform: 'linux', env: { DBUS_SESSION_BUS_ADDRESS: `unix:path=/tmp/dbus-X,guid=${'b'.repeat(32)}` }, home: '/home/u', projectRoot: '/work/p', isExecutable: () => true })
    expect(guid.env.DBUS_SESSION_BUS_ADDRESS).toBe(`unix:path=/tmp/dbus-X,guid=${'b'.repeat(32)}`)
    // The HOME the environment names is checked too.
    expect(launchCommand(URL_OK, { platform: 'linux', env: { HOME: '/work/p/h' }, home: '/home/u', projectRoot: '/work/p', isExecutable: () => true })).toBeInstanceOf(Error)
  })

  it('gives the child no PATH entry in a temp directory', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-launch-')))
    const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-launch-tmpbin-')))
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), '.test-launch-out-')))
    try {
      process.env.PATH = [temp, outside].join(path.delimiter)
      const cmd = command(URL_OK, { platform: 'darwin', env: {}, projectRoot: root })
      expect(cmd.env.PATH).toBe(outside)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(temp, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('gives the child only absolute PATH entries outside the project and the temporary directories', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-launch-')))
    // Neither the project (root) nor a temporary directory: a directory beside this package's sources.
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), '.test-launch-out-')))
    const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-launch-tmp-')))
    try {
      process.env.PATH = [path.join(root, 'bin'), 'relative/bin', '', '.', temp, outside].join(path.delimiter)
      const cmd = command(URL_OK, { platform: 'darwin', env: {}, projectRoot: root })
      expect(cmd.env.PATH).toBe(outside)
      fs.rmSync(temp, { recursive: true, force: true })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('uses rundll32 under a valid SystemRoot on Windows, else C:\\Windows', () => {
    const at = (systemRoot: string | undefined, projectRoot = 'D:\\work\\p') =>
      command(URL_OK, { platform: 'win32', env: { SystemRoot: systemRoot }, projectRoot, home: 'C:\\Users\\u' })
    const good = at('D:\\WINNT')
    expect(good).toMatchObject({ file: 'D:\\WINNT\\System32\\rundll32.exe', args: ['url.dll,FileProtocolHandler', URL_OK], cwd: 'C:\\Users\\u' })
    expect(good.env.SystemRoot).toBe('D:\\WINNT')
    for (const bad of [undefined, '', 'Windows', '\\\\server\\share\\Windows', 'C:\\Windows\\..\\Temp', 'C:\\.\\Windows', 'C:/Windows',
      'C:', 'C:\\', 'C:\\Win*', 'D:\\work\\p\\sys', 'D:\\work\\p\\..sys', 'd:\\WORK\\P']) {
      const cmd = at(bad)
      expect(cmd.file, String(bad)).toBe('C:\\Windows\\System32\\rundll32.exe')
      expect(cmd.env.SystemRoot).toBe('C:\\Windows')
    }
  })

  it('prefers the fixed xdg-open locations, then a PATH entry outside the project', () => {
    const resolve = vi.fn(() => '/opt/bin/xdg-open')
    const fixed = command(URL_OK, { platform: 'linux', env: {}, projectRoot: '/work/p', isExecutable: (f) => f === '/usr/local/bin/xdg-open', resolve })
    expect(fixed).toMatchObject({ file: '/usr/local/bin/xdg-open', args: [URL_OK] })
    expect(resolve).not.toHaveBeenCalled()
    const fallback = command(URL_OK, { platform: 'freebsd', env: {}, projectRoot: '/work/p', isExecutable: () => false, resolve })
    expect(fallback.file).toBe('/opt/bin/xdg-open')
    expect(resolve).toHaveBeenCalledWith('xdg-open', '/work/p')
    const none = launchCommand(URL_OK, { platform: 'linux', env: {}, isExecutable: () => false, resolve: () => null })
    expect((none as Error).message).toMatch(/^Failed to open browser: no browser launcher found\./)
  })

  it('never takes xdg-open from the project, even through PATH', () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-launch-')))
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(process.cwd(), '.test-launch-out-')))
    try {
      for (const dir of [path.join(root, 'bin'), outside]) {
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'xdg-open'), '#!/bin/sh\n', { mode: 0o755 })
      }
      // A link from outside into the project is refused by its real path.
      const linked = fs.mkdtempSync(path.join(process.cwd(), '.test-launch-link-'))
      fs.symlinkSync(path.join(root, 'bin', 'xdg-open'), path.join(linked, 'xdg-open'))
      process.env.PATH = [path.join(root, 'bin'), linked].join(path.delimiter)
      expect(launchCommand(URL_OK, { platform: 'linux', env: {}, projectRoot: root, isExecutable: () => false })).toBeInstanceOf(Error)
      process.env.PATH = [path.join(root, 'bin'), linked, outside].join(path.delimiter)
      expect(command(URL_OK, { platform: 'linux', env: {}, projectRoot: root, isExecutable: () => false }).file).toBe(path.join(outside, 'xdg-open'))
      fs.rmSync(linked, { recursive: true, force: true })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })
})

class FakeChild extends EventEmitter {
  unref = vi.fn()
}

describe('openBrowser', () => {
  it('starts the launcher detached, without a shell or stdio, and resolves once it has started', async () => {
    const child = new FakeChild()
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit('spawn'))
      return child
    })
    await openBrowser(URL_OK, { platform: 'darwin', env: {}, home: '/home/u', spawn: spawn as never })
    expect(spawn).toHaveBeenCalledTimes(1)
    const [file, args, options] = spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>]
    expect(file).toBe('/usr/bin/open')
    expect(args).toEqual([URL_OK])
    expect(options).toMatchObject({ cwd: '/home/u', stdio: 'ignore', detached: true, windowsHide: true, shell: false })
    expect(child.unref).toHaveBeenCalled()
    // An error after the start is still handled (an unhandled 'error' would end the server).
    expect(() => child.emit('error', Object.assign(new Error('late'), { code: 'EPIPE' }))).not.toThrow()
  })

  it('refuses any other URL before starting a process', async () => {
    const spawn = vi.fn()
    await expect(openBrowser('https://evil.example/start', { platform: 'darwin', spawn: spawn as never })).rejects.toThrow(/^Refused to open a browser/)
    expect(spawn).not.toHaveBeenCalled()
  })

  it.each([
    ['ENOENT', /^Failed to open browser: no browser launcher found\./],
    ['EACCES', /^Failed to open browser: the browser launcher could not be started\./],
    ['EOTHER', /^Failed to open browser\. Sign-in needs/],
  ])('rejects with a fixed message on %s, never quoting the URL or a path', async (code, message) => {
    const child = new FakeChild()
    const spawn = vi.fn(() => {
      queueMicrotask(() => child.emit('error', Object.assign(new Error(`spawn /usr/bin/open ${URL_OK} ${code}`), { code })))
      return child
    })
    const error = await openBrowser(URL_OK, { platform: 'darwin', env: {}, spawn: spawn as never }).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(message)
    expect((error as Error).message).not.toMatch(/43123|127\.0\.0\.1|\/usr\/bin/)
    expect((error as Error).cause).toBeUndefined()
  })

  it('rejects when the spawner throws', async () => {
    const spawn = vi.fn(() => {
      throw Object.assign(new Error(`bad ${URL_OK}`), { code: 'ENOENT' })
    })
    await expect(openBrowser(URL_OK, { platform: 'darwin', env: {}, spawn: spawn as never })).rejects.toThrow(/no browser launcher found/)
  })
})
