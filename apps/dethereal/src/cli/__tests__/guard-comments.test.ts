/**
 * The secret guard reads a `#` as an ordinary character, so a quote inside a comment desyncs its quote tracking and
 * hides the commands after it, which the shell runs. Each command is judged twice — as written and with its comments
 * removed — and refused if either reaches a secret, on every harness.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rawEventFrom } from '../config-guard.js'
import { commentReadings, decideCodexAccess, decideOpenCodeAccess, decideSecretAccess, type SecretGuardEnv } from '../secret-guard.js'
import { allJoined, seeded } from '../../test-setup/crafted-input.js'

let tmp: string
let home: string
let project: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'guard-comments-')))
  home = path.join(tmp, 'home')
  project = path.join(tmp, 'project')
  mkdirSync(home, { recursive: true })
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, '.env'), 'x')
  writeFileSync(path.join(project, 'src', 'a.ts'), 'export {}\n')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const env = (): SecretGuardEnv => ({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, cwd: project, platform: process.platform, now: Date.now })
const ev = (command: string) => rawEventFrom(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: project }))
const claude = (command: string) => decideSecretAccess(ev(command), env())
const codex = (command: string) => decideCodexAccess(ev(command), env())
const opencode = (command: string) => decideOpenCodeAccess(rawEventFrom(JSON.stringify({ tool: 'bash', args: { command }, directory: project })), env())

describe('a secret read hidden behind a comment', () => {
  const hidden = [
    "echo x # it's\ncat .env # '",
    'echo a # "\ncat .env # "',
    "echo x #'\ncat .env\n#'",
    'ls # `\ncat .env # `',
    'echo ok # a "comment" with a quote\ncat .env',
    "grep x src # don't\ncat .env # do",
    // A line continuation before the comment: the shell removes it, so the `#` is still a comment and the next line runs.
    "echo x \\\n# a '\ncat .env # '",
    'echo a \\\n#"\ncat .env # "',
    "echo x \\\n\\\n# c '\ncat .env # '",
  ]
  it.each(hidden)('is refused on Claude for %j', (command) => {
    expect(claude(command)).toMatchObject({ deny: true })
  })
  it.each(hidden)('is refused on Codex and OpenCode for %j', (command) => {
    expect(codex(command)).toMatchObject({ deny: true })
    expect(opencode(command)).toMatchObject({ deny: true })
  })
})

describe('ordinary commands with comments still read', () => {
  it.each([
    'cat src/a.ts # a comment',
    "echo 'a # b' src/a.ts",
    'cat "src/a.ts" # a comment with a quote \'',
    'echo "$#" src/a.ts',
    'cat ${X:-src/a.ts}',
    'cat <<EOF\n# not a comment\nEOF',
    'echo hi#there src/a.ts',
    'cat src/a.ts',
  ])('lets %j read', (command) => {
    expect(claude(command).deny).toBe(false)
  })
})

describe('commentReadings', () => {
  it('removes a comment at a word start, and leaves one that is not', () => {
    expect(commentReadings('echo x # c\ncat y')).toEqual(['echo x # c\ncat y', 'echo x \ncat y'])
    expect(commentReadings('echo a#b')).toEqual(['echo a#b'])
    expect(commentReadings('cat src/a.ts')).toEqual(['cat src/a.ts'])
    // A `#` attached to a word (after a closed quote or text) is no comment.
    expect(commentReadings("echo 'x'#y")).toEqual(["echo 'x'#y"])
    expect(commentReadings('echo "x"#y')).toEqual(['echo "x"#y'])
  })

  it('does not strip a `#` inside a quote, a here-document, arithmetic or a parameter', () => {
    for (const command of ["echo 'a # b'", 'echo "a # b"', 'echo $(( 1 # keep\n ))', 'echo ${x:-#keep}', 'echo $#', 'cat <<E\n#body\nE',
      // A `\"` inside double quotes does not close them, so the `#` after it stays inside the string, not a comment.
      'echo "a \\" # b" ; cat x']) {
      expect([command, commentReadings(command)]).toEqual([command, [command]])
    }
  })

  it('never removes a real comment: the guard\'s stripped reading drops at least what a shell-faithful reference does', () => {
    // The reference removes a `#` to end of line at a word start, outside '…', "…", $'…', an escape, $( )/${ }/$[ ],
    // and a here-document body. The guard may remove more (erring toward a comment is safe, since the as-written
    // reading is judged too); it must never remove less, or a real comment would survive in both readings.
    const reference = (s: string): string => {
      let out = ''
      let wordStart = true
      for (let i = 0; i < s.length; i++) {
        const c = s[i]!
        if (c === "'") {
          const close = s.indexOf("'", i + 1)
          const end = close < 0 ? s.length : close
          out += s.slice(i, end + 1)
          i = end
          wordStart = false
        } else if (c === '"') {
          // A backslash escapes the next character inside double quotes, so `\"` does not close the string.
          let j = i + 1
          while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1
          out += s.slice(i, (j < s.length ? j : s.length - 1) + 1)
          i = j
          wordStart = false
        } else if (c === '\\') {
          out += s.slice(i, i + 2)
          i++
          if (s[i] !== '\n') wordStart = false
        } else if (c === '$' && (s[i + 1] === '(' || s[i + 1] === '{' || s[i + 1] === '[')) {
          const open = s[i + 1]!
          const shut = open === '(' ? ')' : open === '{' ? '}' : ']'
          let depth = 0
          let j = i + 1
          for (; j < s.length; j++) {
            if (s[j] === open) depth++
            else if (s[j] === shut && --depth === 0) break
          }
          out += s.slice(i, (j < s.length ? j : s.length - 1) + 1)
          i = j
          wordStart = false
        } else if (c === '#' && wordStart) {
          const nl = s.indexOf('\n', i)
          i = nl < 0 ? s.length : nl - 1
        } else {
          out += c
          wordStart = /[\s;&|()`]/.test(c)
        }
      }
      return out
    }
    const random = seeded(23)
    const pieces = ['#', ' ', '\n', "'", '"', '\\', 'a', ';', '$', '(', ')', '{', '}', 'x', '#c', '$(', '${']
    const cases = [...allJoined(['#', ' ', '\n', "'", 'a', ';'], 4)]
    for (let r = 0; r < 20_000; r++) {
      let s = ''
      for (let k = 1 + random.int(14); k > 0; k--) s += random.pick(pieces)
      cases.push(s)
    }
    let stripped = 0
    const differs: string[] = []
    for (const s of cases) {
      const [, strippedReading = s] = commentReadings(s)
      if (strippedReading !== s) stripped++
      // The guard keeps a subset of what the reference keeps (both are subsequences of `s`).
      if (!keepsSubsetOf(strippedReading, reference(s))) differs.push(s)
    }
    expect(differs).toEqual([])
    expect(stripped).toBeGreaterThan(1_000)
  })
})

/** Whether `a` is a subsequence of `b`: the guard kept no character the reference removed. */
function keepsSubsetOf(a: string, b: string): boolean {
  let j = 0
  for (const ch of a) {
    while (j < b.length && b[j] !== ch) j++
    if (j >= b.length) return false
    j++
  }
  return true
}
