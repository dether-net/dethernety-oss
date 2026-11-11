/**
 * The secret guard reads a crafted command, path or file in time linear in its length: each rewritten step answers as
 * the expression or loop it stands for (kept here as the reference), and a long crafted input is judged in time. A
 * brace expansion past its bound is refused, not cut short.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rawEventFrom } from '../config-guard.js'
import {
  VALUE_PRINTER_SOURCES,
  bareCommand,
  braces,
  bracesMayExpand,
  decideSecretAccess,
  expandSource,
  firstBraceGroup,
  rootPatternSources,
  simpleGlobSource,
  withVariable,
  withoutQuoted,
  type SecretGuardEnv,
} from '../secret-guard.js'
import { linearPattern } from '../../utils/linear-pattern.js'
import { allJoined, crafted, seeded, timed } from '../../test-setup/crafted-input.js'

let tmp: string
let home: string
let project: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'secret-guard-linear-')))
  home = path.join(tmp, 'home')
  project = path.join(tmp, 'project')
  mkdirSync(home, { recursive: true })
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, 'src', 'app.ts'), 'export {}\n')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const env = (): SecretGuardEnv => ({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, cwd: project, platform: 'linux', now: () => 0 })
const bash = (command: string) => decideSecretAccess(rawEventFrom(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: project })), env())
const read = (file: string) => decideSecretAccess(rawEventFrom(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: file }, cwd: project })), env())

/** Each string from `pieces`, every one up to `length` long and `count` random ones up to `longest`. */
function* inputs(pieces: readonly string[], length: number, count: number, longest: number, seed = 1): Generator<string> {
  yield* allJoined(pieces, length)
  const random = seeded(seed)
  for (let r = 0; r < count; r++) {
    let s = ''
    for (let k = random.int(longest + 1); k > 0; k--) s += random.pick(pieces)
    yield s
  }
}

/** The inputs on which `now` answers otherwise than `reference`, and how many `reference` counts as a hit. */
function compare<T>(all: Iterable<string>, reference: (s: string) => T, now: (s: string) => T, hit: (v: T, s: string) => boolean) {
  const differs: string[] = []
  let hits = 0
  for (const s of all) {
    const want = reference(s)
    if (hit(want, s)) hits++
    if (JSON.stringify(want) !== JSON.stringify(now(s))) differs.push(s)
  }
  return { differs: differs.slice(0, 5), hits }
}

describe('each rewritten step answers as the reference it stands for', () => {
  it('finds a word\'s first brace group as `^(.*?)\\{([^{}]*,[^{}]*)\\}(.*)$` does', () => {
    const reference = (w: string) => {
      const m = /^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/.exec(w)
      return m ? [m[1], m[2], m[3]] : null
    }
    const { differs, hits } = compare(inputs(['{', '}', ',', 'a', '\n', '\r', '\u2028', ' '], 6, 100_000, 16), reference, firstBraceGroup, (v) => v !== null)
    expect(differs).toEqual([])
    expect(hits).toBeGreaterThan(2_000)
  })

  it('strips a simple command\'s grouping and keywords as the replace loop did', () => {
    const reference = (segment: string) => {
      let s = segment
      let prev
      do {
        prev = s
        s = s.replace(/^(?:\(+|\{(?=\s)|!(?=\s)|(?:if|then|elif|else|do|while|until|time)(?=\s|$))\s*/, '')
        s = s.replace(/\s*\)+\s*$/, '').replace(/^(?:\}|fi|done|esac)$/, '')
      } while (s !== prev)
      return s.trim()
    }
    const pieces = ['(', ')', '{', '}', '!', ' ', '\t', '\n', '\u00a0', 'if', 'do', 'done', 'fi', 'esac', 'then', 'time', 'x', 'i', 'f']
    const { differs, hits } = compare(inputs(pieces, 4, 100_000, 12), reference, bareCommand, (v, s) => v !== s)
    expect(differs).toEqual([])
    expect(hits).toBeGreaterThan(10_000)
  })

  it('drops quoted parts as `/\'[^\']*\'|"(?:[^"\\\\]|\\\\.)*"/g` does', () => {
    const reference = (s: string) => s.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, '')
    const { differs, hits } = compare(inputs(["'", '"', '\\', 'a', '\n', '\r', '\u2028', '>'], 6, 100_000, 18), reference, withoutQuoted, (v, s) => v !== s)
    expect(differs).toEqual([])
    expect(hits).toBeGreaterThan(10_000)
  })

  it('writes a variable\'s forms as its value as the replace did', () => {
    const pieces = ['$', '{', '}', 'H', 'HOME', ':', '-', '=', '?', '+', 'x', '_', ' ', '$HOME', '${HOME', '\n']
    for (const name of ['HOME', 'H']) {
      const reference = (s: string) => s.replace(new RegExp(`\\$\\{${name}(?::?[-=?+][^}]*)?\\}|\\$${name}(?![A-Za-z0-9_])`, 'g'), () => '/h')
      const { differs, hits } = compare(inputs(pieces, 3, 100_000, 10), reference, (s) => withVariable(s, name, '/h'), (v, s) => v !== s)
      expect([name, differs]).toEqual([name, []])
      expect(hits).toBeGreaterThan(500)
    }
  })

  it('tells a value printer as its expression does', () => {
    const pieces = ['kubectl', 'get', 'describe', 'secret', 'secrets', 'secretsx', ' ', '  ', '\t', '-o', '-oyaml', '--output', '--output=', '=', 'yaml', 'json',
      'jsonpath', 'go-template', 'docker', 'docker-compose', 'compose', 'config', 'configs', 'terraform', 'show', 'output', 'printenv', 'env', 'helm',
      'values', 'all', 'manifest', 'sops', '-d', '--decrypt', 'decrypt', 'x', '_', '\n', '\r', '\u00e9',
      // Whole heads, so each expression's shape comes up often enough to compare its hits too.
      'docker compose', 'docker-compose ', ' config', 'kubectl get secrets', 'kubectl describe secret', 'terraform show', 'helm get values', 'sops -d']
    for (const re of VALUE_PRINTER_SOURCES) {
      const pattern = linearPattern(re.source, re.flags)
      const { differs, hits } = compare(inputs(pieces, 2, 60_000, 9, re.source.length), (s) => re.test(s), (s) => pattern.test(s), (v) => v)
      expect([re.source, differs]).toEqual([re.source, []])
      expect([re.source, hits > 20]).toEqual([re.source, true])
    }
  })

  it('reads a rewritten expression\'s language as the one it replaced', () => {
    const pairs: Array<[RegExp, RegExp, string[]]> = [
      [/^\s*(?:\d+|\$)?(?:\s*,\s*(?:\d+|\$))?\s*p\s*$/, /^\s*(?:(?:\d+|\$)\s*)?(?:,\s*(?:\d+|\$)\s*)?p\s*$/, [' ', '\t', '1', '2', '$', ',', 'p', 'x']],
      [/^-[A-Za-z]*c[A-Za-z]*$/, /^-[A-Zabd-z]*c[A-Za-z]*$/, ['-', 'c', 'C', 'a', 'z', '!', '\n']],
      [/\([^()|\s]*D[^()|\s]*\)?(?=[\s;&|]|$)/, /\([^()|\sD]*D[^()|\s]*\)?(?=[\s;&|]|$)/, ['(', ')', 'D', 'a', ' ', '|', ';', '\n']],
      [/\{[^{}]*,[^{}]*\}/, /\{[^{},]*,[^{}]*\}/, ['{', '}', ',', 'a', ' ']],
    ]
    for (const [before, now, pieces] of pairs) {
      const { differs, hits } = compare(inputs(pieces, 6, 50_000, 16), (s) => before.test(s), (s) => now.test(s), (v) => v)
      expect([before.source, differs]).toEqual([before.source, []])
      expect([before.source, hits > 1_000]).toEqual([before.source, true])
    }
  })

  it('reads a run of `*` or of `**` segments as one, as the reference builder\'s pattern does', () => {
    // The reference builder: every `*` and every `**` segment written out.
    const segmentReference = (seg: string) => seg.split('').map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : c.replace(/[.+^$(){}|\\]/g, '\\$&'))).join('')
    const reference = (segs: readonly string[]) =>
      `^${segs.map((x) => (x === '**' ? '(?:[^/]+/)*' : `${segmentReference(x)}/`)).join('').replace(/\/$/, '').replace(/\(\?:\[\^\/\]\+\/\)\*$/, '.*')}$`
    const random = seeded(41)
    const segPieces = ['**', '*', '**', 'a', '*a', 'a*', '?', '**']
    const pathPieces = ['a', 'b', '/', '\n', 'aa', '/a/']
    const differs: string[] = []
    let matched = 0
    for (let r = 0; r < 4_000; r++) {
      const segs = Array.from({ length: 1 + random.int(5) }, () => random.pick(segPieces))
      const want = new RegExp(reference(segs))
      const got = new RegExp(expandSource(segs))
      for (let q = 0; q < 10; q++) {
        let rel = ''
        for (let k = random.int(6); k > 0; k--) rel += random.pick(pathPieces)
        if (want.test(rel)) matched++
        if (want.test(rel) !== got.test(rel)) differs.push(`${segs.join('/')} ${JSON.stringify(rel)}`)
      }
    }
    expect(differs).toEqual([])
    expect(matched).toBeGreaterThan(1_000)
  })

  it('builds glob patterns that the linear matcher reads as the regular expression does', () => {
    const random = seeded(77)
    const globPieces = ['*', '?', '[', ']', '[!', 'a', 'b', '.', '(', ')', '|', '?(', '*(', '+(', '@(', '!(', '\\', '{', '^', '-', 'A']
    const names = ['a', 'b', 'A', '.', '-', 'ab', '.a', 'ba', '(', ')', '|', '[', ']', '\\', 'x']
    let compared = 0
    const differs: string[] = []
    const check = (source: string, flags: string) => {
      let expected: RegExp
      try {
        expected = new RegExp(source, flags)
      } catch {
        expect(() => linearPattern(source, flags), source).toThrow()
        return
      }
      const pattern = linearPattern(source, flags)
      for (let q = 0; q < 10; q++) {
        let name = ''
        for (let k = random.int(6); k > 0; k--) name += random.pick(names)
        compared++
        if (expected.test(name) !== pattern.test(name)) differs.push(`/${source}/${flags} ${JSON.stringify(name)}`)
      }
    }
    for (let r = 0; r < 6_000; r++) {
      let glob = ''
      for (let k = 1 + random.int(6); k > 0; k--) glob += random.pick(globPieces)
      const flags = r % 2 ? 'i' : ''
      const simple = simpleGlobSource(glob)
      if (simple) check(simple, 'i')
      const root = rootPatternSources(glob, r % 3 === 0)
      if (Array.isArray(root)) for (const source of root) check(source, flags)
      check(expandSource(glob.split('/').concat(r % 4 === 0 ? ['**'] : [])), flags)
    }
    expect(differs).toEqual([])
    expect(compared).toBeGreaterThan(50_000)
  })
})

describe('a brace expansion past its bound', () => {
  it('is refused, not cut short: every word it names would have to be checked', () => {
    expect(bash(`cat ${'{a,b}'.repeat(6)}`).deny).toBe(false)
    const past = bash(`cat ${'{a,b}'.repeat(7)}`)
    expect(past).toMatchObject({ deny: true, reason: expect.stringContaining('a brace expansion past 64 words') })
    const words = (n: number) => `cat {${Array.from({ length: n }, (_, i) => `f${i}`).join(',')}}`
    expect(bash(words(64)).deny).toBe(false)
    expect(bash(words(65))).toMatchObject({ deny: true, reason: expect.stringContaining('a brace expansion past 64 words') })
    // The 65th word would have been dropped before: a secret named there is refused either way.
    expect(bash(`cat {${Array.from({ length: 64 }, (_, i) => `f${i}`).join(',')},.env}`).deny).toBe(true)
  })

  // JSON's braces, quoted or in a here-document, which the shell never expands: four objects of three keys are 81 words.
  const json = JSON.stringify(Array.from({ length: 4 }, (_, i) => ({ id: i, name: `n${i}`, ok: true })))
  const flat = JSON.stringify(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i])))

  it('reads braces the shell does not expand as before: quoted, or in a here-document', () => {
    for (const command of [
      `cat > seed.json <<'EOF'\n${json}\nEOF`,
      `cat > seed.json <<EOF\n${json}\nEOF\nls`,
      `echo '${json}' > seed.json`,
      `curl -d '${json}' http://localhost:3000/x`,
      `echo '${flat}'`,
      `printf '%s' "${json.replace(/"/g, '\\"')}" > seed.json`,
    ]) expect([command.slice(0, 30), bash(command).deny]).toEqual([command.slice(0, 30), false])
  })

  it('refuses braces past the bound wherever the shell expands them, a shell run again included', () => {
    const many = `{${Array.from({ length: 65 }, (_, i) => `f${i}`).join(',')}}`
    for (const command of [
      `cat ${many}`,
      `bash -c 'cat ${many}'`,
      `sh -c "cat ${many}"`,
      `zsh -c 'cat ${many}'`,
      `eval 'cat ${many}'`,
      `ls | xargs sh -c 'cat ${many}'`,
      `find . -exec sh -c 'cat ${many}' \\;`,
      `env A=1 sh -c 'cat ${many}'`,
      `ssh host 'cat ${many}'`,
      `sudo sh -c 'cat ${many}'`,
      `su -c 'cat ${many}'`,
      `watch 'cat ${many}'`,
      `bash <<'EOF'\ncat ${many}\nEOF`,
      `echo "$(cat ${many})"`,
      `echo 'x' ; cat ${many}`,
      `echo $((1<<2))\ncat ${many}`,
      `(( x = 1 << 2 ))\ncat ${many}`,
      `echo $[1<<2]\ncat ${many}`,
      `cat <<'EOF' >/dev/null\n{"a":1}\nEOF\necho $((1<<2))\ncat ${many}`,
      `cat <<EOF\\\n; cat ${many}\nEOF`,
      `cat <<$'EOF'\nx\nEOF\ncat ${many}\n$EOF`,
      `cat <<E\\F\nE\\F\ncat ${many}\nEF`,
      `echo $$'\\'; cat ${many}; echo '\\'`,
      `# a<<b\ncat ${many}`,
      `echo x # it's\ncat ${many} # '`,
      `env -S 'bash -c "cat ${many}"'`,
      `cat <<EOF\r\nEOF\r\ncat ${many}\nEOF\n`,
      `cat <<EOF $(\ncat ${many}\nEOF\n)`,
      `cat <<EOF \`\ncat ${many}\nEOF\n\``,
      `trap 'cat ${many}' EXIT`,
      `. /dev/stdin <<< 'cat ${many}'`,
      `echo 'cat ${many}' | source /dev/stdin`,
      `echo 'cat ${many}' | $SHELL`,
      `rbash -c 'cat ${many}'`,
    ]) expect([command.slice(0, 24), bash(command)]).toEqual([command.slice(0, 24), expect.objectContaining({ deny: true })])
  })

  it('reads a brace group without a comma as zsh does with BRACE_CCL too: a set of characters', () => {
    writeFileSync(path.join(project, '.env'), 'x')
    expect(bash('setopt braceccl; cat .en{v}')).toMatchObject({ deny: true })
    expect(bash('cat .e{n}{v}')).toMatchObject({ deny: true })
    expect(bash('cat .{a-e}nv')).toMatchObject({ deny: true })
    expect(bash('cat src/app.{t}s').deny).toBe(false)
  })

  it('tells where the shell may expand braces', () => {
    for (const [command, may] of [
      ['cat {a,b}', true], ["echo '{a,b}'", false], ['echo "{a,b}"', false], ["echo $'{a,b}'", false], ['echo \\{a,b}', false],
      [`cat <<'EOF'\n{a,b}\nEOF`, false], ['cat <<-EOF\n\t{a,b}\n\tEOF\nls', false], ['cat <<EOF\n{a,b}\nEOF\ncat {c,d}', true],
      ['grep x <<< "{a,b}"', false], ["bash -c 'x'", true], ["ssh h 'x'", true], ['/bin/sh -c x', true], ['echo "$(ls)"', true],
      ["echo 'open", true], ['cat <<EOF\n{a,b}', false], ['echo ${HOME}', true],
      // Where its reading may part from the shell's, it says may.
      ['cat <<"E"F\n{a,b}\nEF', true], ['echo $((1<<2))\n{a,b}', true], ['(( x = 1 << 2 ))', true], ['echo $[1<<2]', true], ['cat <<EOF\\\n; {a,b}\nEOF', true],
      ["cat <<$'EOF'\nx\nEOF", true], ['cat <<E\\F\nE\\F', true], ["echo $$'\\'; {a,b}; echo '\\'", true], ['# a<<b\n{a,b}', true], ["echo x # it's", true],
      ['env -S \'bash -c "x"\'', true], ['cat <<EOF-1.x\n{a,b}\nEOF-1.x', false],
      ['cat <<EOF\r\nEOF\r\n{a,b}\nEOF', true], ['cat <<EOF\v\n{a,b}', true], ['cat <<EOF $(\nx\nEOF\n)', true], ['cat <<EOF `\nx\nEOF\n`', true],
      ['cat <<EOF <(\nx\nEOF\n)', true], ["trap 'x' EXIT", true], ['source /dev/stdin', true], ['. ./x.sh', true], ['rbash -c x', true],
      ['echo x | $SHELL', true], ['"$b" -c x', true],
    ] as const) expect([command, bracesMayExpand(command)]).toEqual([command, may])
  })

  it('reads quoted braces as the bounded reference expansion does: the same words, in the same order', () => {
    // The reference: every alternative expanded, the first 64 words kept.
    const reference = (word: string, budget = 64): string[] => {
      word = word.replace(/\{([A-Za-z])\.\.([A-Za-z])(?:\.\.-?\d+)?\}/g, (_m, a: string, b: string) => (a <= b ? `[${a}-${b}]` : `[${b}-${a}]`))
        .replace(/\{-?\d+\.\.-?\d+(?:\.\.-?\d+)?\}/g, '*')
      const m = /^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/.exec(word)
      if (!m) return [word]
      const out: string[] = []
      for (const alt of m[2]!.split(',')) for (const w of reference(`${m[1]}${alt}${m[3]}`, budget)) if (out.length < budget) out.push(w)
      return out
    }
    const random = seeded(31)
    const pieces = ['{', '}', ',', 'a', 'b', '.env', '/', '{a,b}', '{x,y,z}', '{1..3}', '{a..c}', '\n']
    let compared = 0
    let past = 0
    for (let r = 0; r < 20_000; r++) {
      let word = ''
      for (let k = 1 + random.int(10); k > 0; k--) word += random.pick(pieces)
      const want = reference(word)
      const got = braces(word, false)
      compared++
      if (want.length === 64) past++
      // Past the bound, the work bound may stop it a little earlier: what it reads is then the reference's start.
      expect([word, got]).toEqual([word, want.length < 64 ? want : want.slice(0, got.length)])
    }
    expect(compared).toBe(20_000)
    expect(past).toBeGreaterThan(20)
  })

  it('stops after its bound, however many groups the word holds', () => {
    expect(timed(() => bash(`cat .env ${'{a,b}'.repeat(26)}`))).toBeLessThan(250)
    expect(timed(() => bash(`cat ${'{a,b}'.repeat(10_000)}`))).toBeLessThan(250)
  })
})

describe('a long crafted input is judged in time', () => {
  const KB100 = 100 * 1024
  it.each([
    ['a run of blanks', crafted(KB100, ' ', 'cat .env', 'x')],
    ['a brace with many commas', crafted(KB100, ',', 'cat {')],
    ['a qualifier run of D', crafted(KB100, 'D', 'cat (', 'x')],
    ['escaped quotes left open', crafted(KB100, '\\"', 'cat "')],
    ['open variable forms', crafted(KB100, '${HOME:-', 'cat ')],
    ['a run of [', crafted(KB100, '[', 'cat ')],
    ['a run of stars', crafted(KB100, '*', 'cat src/', 'Q')],
    ['stars between letters', crafted(KB100, '*e', 'cat ~/', 'Q')],
    ['a deep relative path', crafted(KB100, 'a/', 'cat ')],
    ['a sed script of blanks', crafted(KB100, ' ', "sed -n '", "x' f")],
    ['a long option word', crafted(KB100, 'c', 'bash -', '! x')],
    ['keywords before a command', crafted(KB100, 'if ', '', 'cat x')],
    ['closing brackets', crafted(KB100, ' )', 'cat x')],
    ['keywords, then a run of blanks', crafted(KB100 / 2, 'if ', '', 'cat x') + ' '.repeat(KB100 / 2)],
    ['subshells, then a run of blanks', crafted(KB100 / 2, '( ', '', 'cat x') + ' '.repeat(KB100 / 2)],
    ['a run of ** segments', crafted(KB100, '**/', 'cat src/', 'Q')],
  ])('%s', (_label, command) => {
    expect(timed(() => bash(command))).toBeLessThan(1000)
  })

  it('a kubectl line that names secrets many times', () => {
    expect(timed(() => bash(crafted(25 * 1024, 'describe secret ', 'kubectl ')))).toBeLessThan(1000)
  })

  it('a read of a deep path', () => {
    expect(timed(() => read(crafted(KB100, '/a', project)))).toBeLessThan(1000)
  })

  it('a read with a deep path in the model registry', () => {
    mkdirSync(path.join(project, '.dethernety'))
    writeFileSync(path.join(project, '.dethernety', 'models.json'), JSON.stringify({ models: [{ path: crafted(800 * 1024, 'a/') }] }))
    expect(timed(() => read(path.join(project, 'src', 'app.ts')))).toBeLessThan(1000)
  })
})
