/**
 * The two shell checks of Codex's Bash hook. No caller runs a command that runs input sent to it
 * later (Codex sends it with no hook to check it). A read-only agent's shell runs only commands that read: an allowlist of readers, every
 * command a line runs judged (a `sh -c` script, an `eval`, a substitution), and anything it cannot read
 * refused. The refusal names what it refused, so the agent can read another way.
 */
import { describe, expect, it } from 'vitest'
import { commandText, notOnlyReading, runsLaterInput, sedScriptOnlyPrints } from '../shell-check.mjs'
import { shellModelWrites } from '../../acceptance/transcripts/replay.js'
import { allJoined, crafted, timed } from '../../test-setup/crafted-input.js'
import { bitOf, bracketRisk, sedFuzzHash, sedFuzzInputs } from './fixtures/sed-fuzz-inputs.js'
import sedVerdicts from './fixtures/sed-reference-verdicts.json' with { type: 'json' }

const REFUSED: Array<[string, string]> = [
  ['echo x > child-write.txt', '`> child-write.txt`'],
  ['cat f >> log.txt', '`>> log.txt`'],
  ['cat f 2> err.log', '`2> err.log`'],
  ['ls &> out', '`&> out`'],
  ['exec 3>f', '`3> f`'],
  ['>f', '`> f`'],
  ['( echo x ) > f', '`> f`'],
  ['cat <> f', '`<>`'],
  ['cat <<EOF\nx\nEOF', 'a heredoc'],
  ['grep x <<< y', 'a here-string'],
  ['cat >(tee f)', '`>( )`'],
  ['tee f', '`tee`'],
  ['echo x | tee f', '`tee`'],
  ['/usr/bin/tee f', '`/usr/bin/tee`'],
  ['cp a b', '`cp`'],
  ['mv a b', '`mv`'],
  ['rm -rf x', '`rm`'],
  ['mkdir d', '`mkdir`'],
  ['touch f', '`touch`'],
  ['ln -s a b', '`ln`'],
  ["sed -i 's/a/b/' f", '`-i`'],
  ["sed -n 'w out' f", 'the sed script `w out`'],
  ["sed 's/a/b/w out' f", 'the sed script'],
  ['perl -i -pe s/a/b/ f', '`perl`'],
  ['python3 -c "open(1)"', '`python3`'],
  ['node -e 1', '`node`'],
  ['awk 1 f', '`awk`'],
  ['yq . f', '`yq`'],
  ['vim -c wq f', '`vim`'],
  ['make', '`make`'],
  ['npm run build', '`npm`'],
  ['bash x.sh', '`bash` without `-c`'],
  ['sh', '`sh` without `-c`'],
  ['./x', '`./x`'],
  ['sh -c "echo x > f"', '`> f`'],
  ["bash -lc 'rm f'", '`rm`'],
  ["eval 'rm f'", '`rm`'],
  ['env FOO=1 cat f', 'the assignment `FOO=`'],
  ['GIT_PAGER=sh git log', 'the assignment `GIT_PAGER=`'],
  ['xargs rm', '`rm`'],
  ['find . -delete', '`find -delete`'],
  ['find . -exec rm {} +', '`find -exec`'],
  ['find . -fprint f', '`find -fprint`'],
  ['echo $(touch f)', '`touch`'],
  ['echo `touch f`', '`touch`'],
  ['$x f', 'the command name'],
  ["$'\\x74ee' f", "`$'…'` quoting"],
  ['{tee,f}', 'the command name'],
  ['git commit -m x', '`git commit`'],
  ['git -C x commit', '`git commit`'],
  ['git -c core.pager=sh log', '`git -c`'],
  ['git diff --output=f', '`git diff --output=f`'],
  ['git grep -O x', '`git grep -O`'],
  ['rg --pre sh x', '`--pre`'],
  ['sort -o f x', '`-o`'],
  ['uniq a b', '`uniq` with an output file'],
  ['tree -o f', '`-o`'],
  ['kubectl delete pod x', '`kubectl delete`'],
  ['kubectl apply -f x', '`kubectl apply`'],
  ['curl -o f https://example.invalid', '`curl`'],
  ['for f in *; do cat $f; done', '`for`'],
]

const READ: string[] = [
  'cat f',
  'cat f > /dev/null',
  'cat f 2>&1',
  'cat f 2>/dev/null',
  'cat f &>/dev/null',
  'cat f | grep x | head -5',
  'head -n 20 f',
  'tail -n 5 f',
  'wc -l f',
  "sed -n '1,5p' f",
  'sed -n -e 1p f',
  "sed -n '/begin/,/end/p' f",
  'grep -rn x .',
  "grep '>' f",
  'grep -lwF -d skip -- "name: x" f',
  'rg -n foo src',
  'ls -la',
  "find 'd' -type f",
  'find . -name "*.tf"',
  'jq .a f.json',
  'jq -r .x f',
  'git log --oneline',
  'git -C sub show HEAD:x',
  "git ls-files --format='%(objectmode) %(path)' -- 'p'",
  'git status',
  'git diff HEAD~1',
  'kubectl get pods -o name',
  'kubectl -n ns get pods',
  'kubectl describe secret s',
  'cd x && cat f',
  '( cd d && ls )',
  '{ cat a; cat b; }',
  'sh -c "cat f"',
  "bash -lc 'grep -n x f'",
  'timeout 5 cat f',
  'xargs cat',
  'LC_ALL=C sort f',
  'terraform --version',
  'echo hi',
  'diff a b',
  'stat f',
]

const LATER: Array<[string, string]> = [
  ['while read -r l; do eval "$l"; done', '`read` with `eval`'],
  ['while read l; do $l; done', '`read` with `eval` or a variable as the command'],
  ['read x; eval "$x"', '`read` with `eval`'],
  ['xargs -I{} sh -c {}', '`xargs … sh`'],
  ['xargs -I % bash -c "%"', '`xargs … bash`'],
  ['xargs sh -c "echo"', '`xargs … sh`'],
  ['sh -s', '`sh -s`'],
  ['bash -s -- a', '`bash -s`'],
  ['/bin/bash -s', '`bash -s`'],
  ['env bash -s', '`bash -s`'],
  ['bash /dev/stdin', '`bash /dev/stdin`'],
  ['source /dev/stdin', '`source /dev/stdin`'],
  ['. /dev/stdin', '`. /dev/stdin`'],
  ['bash', '`bash` with no script'],
  ['exec bash', '`bash` with no script'],
  ['cat q | sh', '`sh` with no script'],
  ['python3', '`python3` with no script'],
  ['python3 -', '`python3 -`'],
  ['node', '`node` with no script'],
  ['bash -c \'while read l; do eval "$l"; done\'', '`read` with `eval`'],
]

const NOT_LATER: string[] = [
  'git status',
  'git log | head',
  'rg foo src',
  'cat src/a.ts',
  'node scripts/build.mjs',
  'python3 tools/gen.py --flag',
  'pnpm test',
  'bash scripts/x.sh',
  'sh -c "echo hi"',
  'node -e "console.log(1)"',
  'python3 -c "print(1)"',
  'bash --version',
  '"$PY" script.py',
  'while read f; do cat "$f"; done < list',
  'for f in *; do echo $f; done',
  'echo x > out.txt',
  'cat <<EOF > f\nread x\neval y\nEOF',
  'xargs cat',
  'xargs -I{} cat {}',
]

describe('a command that runs input sent to it later, from any caller', () => {
  it.each(LATER)('refuses %j, naming %s', (command, named) => {
    expect(runsLaterInput(command)).toContain(named)
  })

  it.each(NOT_LATER)('leaves %j to the other checks', (command) => {
    expect(runsLaterInput(command)).toBeNull()
  })

  it('leaves a line it cannot read to the secret guard', () => {
    expect(runsLaterInput('cat "f')).toBeNull()
    expect(runsLaterInput('')).toBeNull()
    expect(runsLaterInput(undefined)).toBeNull()
  })
})

describe('a read-only agent\'s shell on Codex', () => {
  it.each(REFUSED)('refuses %j, naming %s', (command, named) => {
    const why = notOnlyReading(command)
    expect(why).not.toBeNull()
    expect(why).toContain(named)
  })

  it.each(READ)('lets %j read', (command) => {
    expect(notOnlyReading(command)).toBeNull()
  })

  it('refuses what it cannot read: no command, an open quote, nesting too deep, a line too long', () => {
    expect(notOnlyReading('')).toBe('no command to check')
    expect(notOnlyReading(undefined)).toBe('no command to check')
    expect(notOnlyReading('cat "f')).toBe('an unclosed quote')
    expect(notOnlyReading('cat $(ls')).toBe('an unclosed parenthesis')
    let deep = 'cat f'
    for (let i = 0; i < 10; i++) deep = `sh -c ${JSON.stringify(deep)}`
    expect(notOnlyReading(deep)).toBe('commands nested too deep to check')
    expect(notOnlyReading(`cat ${'f'.repeat(40 * 1024)}`)).toBe('a command too long to check')
  })

  it("reads Codex's argv form as the command it runs", () => {
    expect(commandText(['bash', '-lc', "sed -n '1,2p' f"])).toBe("bash -lc 'sed -n '\\''1,2p'\\'' f'")
    expect(notOnlyReading(commandText(['bash', '-lc', "sed -n '1,2p' f"]))).toBeNull()
    expect(notOnlyReading(commandText(['bash', '-lc', 'rm f']))).toContain('`rm`')
    expect(commandText([])).toBeUndefined()
    expect(commandText([1])).toBeUndefined()
  })

  it('refuses every write the acceptance replay sees to a model file', () => {
    const writes = [
      'echo x > m/manifest.json',
      'cat a >> m/structure.json',
      'tee m/manifest.json',
      'echo x | tee -a m/dataflows.json',
      "sed -i 's/a/b/' m/manifest.json",
      "perl -i -pe 's/a/b/' m/manifest.json",
      'cp a m/manifest.json',
      'mv a m/manifest.json',
      'rm m/manifest.json',
      'rmdir m/attributes',
      'touch m/manifest.json',
      'install a m/manifest.json',
      'truncate -s 0 m/manifest.json',
      'ln -sf x m/manifest.json',
      'unlink m/manifest.json',
      'dd if=a of=m/manifest.json',
      'python3 -c "open(\'m/manifest.json\',\'w\')"',
      'node -e "require(\'fs\').writeFileSync(\'m/manifest.json\', \'\')"',
      'git checkout -- m/manifest.json',
      'git restore m/manifest.json',
      'git rm m/manifest.json',
      'sh -c "echo x > m/manifest.json"',
    ]
    for (const command of writes) {
      expect(shellModelWrites(command, '', ['m']), command).not.toEqual([])
      expect(notOnlyReading(command), command).not.toBeNull()
    }
    // Where the two differ: the replay counts these, which only read (a `>` or `rm` inside a pattern, jq's options).
    for (const command of ["grep '>' m/manifest.json", 'grep -n rm m/manifest.json', 'jq -c . m/manifest.json']) {
      expect(shellModelWrites(command, '', ['m']), command).not.toEqual([])
      expect(notOnlyReading(command), command).toBeNull()
    }
  })
})

describe('the sed script check', () => {
  it.each([
    '', '1,40p', '$p', '=', 'n;p', 'p\nq', ' 1 , 5 ! p ; ', '/begin/,/end/p', '/a\\/b/p', '1,+3p', '/x/,~4d', '{p}', '1{p;q}',
    's/a/b/', 's|a/b|c|g', 's/a\\/b/c/2p', 's/a/b/1,3p', 's/a/b/12!d', 's/a/b/I;l', 'pp',
  ])('accepts %j', (script) => {
    expect(sedScriptOnlyPrints(script)).toBe(true)
  })

  it.each([
    'w out', 's/a/b/w out', 's/a/b/e', 'p;w x', 'e date', '1~2p', 'r f', 'y/a/b/', 'a text', '1,', 's/a/b', 's/a\\', 's\na\nb\n', '/a\\\n/p', '#n', 'p!', 'q5',
  ])('refuses %j', (script) => {
    expect(sedScriptOnlyPrints(script)).toBe(false)
  })

  it('refuses a backslash as the s delimiter, which the former reference took only by backtracking', () => {
    expect(sedScriptOnlyPrints('s\\a\\b\\')).toBe(false)
  })

  // Three narrowings, each refusing where the reference accepts: a backslash or a character past printable ASCII as the s
  // delimiter (sed compares bytes), and a bracket expression (`[…]`) holding the delimiter, a backslash or a line end, or
  // left open, which BSD and GNU sed end in different places. The former reference expressions backtracked
  // exponentially, so their verdicts are recorded as data (fixtures/sed-reference-verdicts.json), not evaluated here.
  it('accepts no more than the reference, and the same but for the two narrowings: every script of up to four characters, and random ones of up to twelve', () => {
    const inputs = sedFuzzInputs()
    expect(sedFuzzHash(inputs)).toBe(sedVerdicts.inputsHash)
    expect(inputs.length).toBe(sedVerdicts.n)
    const backtracks = bitOf(sedVerdicts.backtracking)
    const reference = bitOf(sedVerdicts.reference)
    const differs: string[] = []
    let accepted = 0
    inputs.forEach((s, i) => {
      const now = sedScriptOnlyPrints(s)
      if (now) accepted++
      if (now && !backtracks(i)) differs.push(`wider: ${s}`)
      if (now !== reference(i) && !bracketRisk(s)) differs.push(s)
    })
    expect(differs).toEqual([])
    expect(accepted).toBeGreaterThan(5_000)
  })

  it('reads a long crafted script within a tight bound', () => {
    const KB100 = 100 * 1024
    const inputs = [
      crafted(KB100, '\t=', '=', 'X'), crafted(KB100, ' =', '', 'X'), crafted(KB100, ' p', '', 'X'), crafted(KB100, ';', '', 'X'), crafted(KB100, '\n', '', 'X'),
      crafted(KB100, '\u00a0', '', 'X'), crafted(KB100, '{', '', 'X'), crafted(KB100, 'pp', '', '!'), crafted(KB100, 'a', 's/'), crafted(KB100, '\\/', 's/'),
      crafted(KB100, '\\/', '/'), crafted(KB100, 'a', 's/x/'), crafted(KB100, '1', 's/a/b/', 'X'), crafted(KB100, 'g1', 's/a/b/', ',X'),
      crafted(KB100, 's/a/b/1 ', '', '!'), crafted(KB100, 's/a/b/g;'), crafted(KB100, 's/a/b/ ', '', 'X'), crafted(KB100, ' ', '1,', 'X'),
      crafted(KB100, ' ', '/x/', 'X'), crafted(KB100, '1,2p;', '', 'X'), crafted(KB100, 's|a|b|p'),
    ]
    for (const s of inputs) expect([s.slice(0, 12), timed(() => sedScriptOnlyPrints(s)) < 50]).toEqual([s.slice(0, 12), true])
  })

  it('judges a crafted script in a read-only agent\'s command quickly, and still lets a printing one through', () => {
    const script = `=${'\t='.repeat(16 * 1024 - 20)}X`
    expect(notOnlyReading(`sed -n '${script}' f`)).toContain('the sed script')
    expect(timed(() => notOnlyReading(`sed -n '${script}' f`))).toBeLessThan(50)
    expect(notOnlyReading("sed -n 's/a/b/1,3p' f")).toBeNull()
  })
})

describe('the option words a shell or interpreter is read by', () => {
  it('reads each as the reference expression does, in time linear in the word', () => {
    const pairs: Array<[RegExp, RegExp, string[]]> = [
      [/^-[a-z]*c[a-z]*$/, /^-[abd-z]*c[a-z]*$/, ['-', 'c', 'C', 'a', 'b', 'd', 'z', '!']],
      [/^-[a-zA-Z]*s[a-zA-Z]*$/, /^-[a-rt-zA-Z]*s[a-zA-Z]*$/, ['-', 's', 'S', 'r', 't', 'z', 'Z', '!']],
      [/^-[a-zA-Z]*[ce][a-zA-Z]*$/, /^-[abdf-zA-Z]*[ce][a-zA-Z]*$/, ['-', 'c', 'e', 'd', 'f', 'b', 'C', 'E', '!']],
    ]
    for (const [reference, now, pieces] of pairs) {
      const words = [...allJoined(pieces, 6)]
      expect([reference.source, words.filter((w) => reference.test(w) !== now.test(w))]).toEqual([reference.source, []])
      expect(words.filter((w) => reference.test(w)).length).toBeGreaterThan(500)
    }
    expect(timed(() => notOnlyReading(`bash -${'c'.repeat(30_000)}! x`))).toBeLessThan(50)
    expect(timed(() => runsLaterInput(`bash -${'s'.repeat(30_000)}! x`))).toBeLessThan(50)
  })
})

describe('a sed command line', () => {
  it.each([
    // An attached script, a group ending in `e`, in-place and script-file options in every spelling, options after operands.
    ["sed -e'w out' 1p", 'the sed script `w out`'],
    ["sed -e 1p -ne 'w out' f", 'the sed script `w out`'],
    ["sed -n -I '' 1p f", '`-I`'],
    ['sed -n -I p 1p f', '`-I`'],
    ['sed -n -Ip 1p f', '`-Ip`'],
    ['sed -n -i.bak 1p f', '`-i.bak`'],
    ['sed -fx f', '`-fx`'],
    ['sed -n -f x f', '`-f`'],
    ['sed p -i f', '`-i`'],
    ['sed -n 1p f -i', '`-i`'],
    ["sed -n -e'e id' 1p", 'the sed script `e id`'],
    // GNU's long options and their abbreviations: none is read.
    ["sed --expression='e id' p", '`--expression=e id`'],
    ['sed --expression 1p f', '`--expression`'],
    ['sed --expr=1p f', '`--expr=1p`'],
    ['sed --fi=x f', '`--fi=x`'],
    ['sed --file=x f', '`--file=x`'],
    ['sed -n --i 1p f', '`--i`'],
    ['sed --in-pl 1p f', '`--in-pl`'],
    ['sed --in-place=.b 1p f', '`--in-place=.b`'],
    ['sed --quiet 1p f', '`--quiet`'],
    // Options GNU or BSD sed alone reads, and one with a value.
    ['sed -s -n 1p f', '`-s`'],
    ['sed -z -n 1p f', '`-z`'],
    ['sed -n -l 5 1p f', '`-l`'],
    ['sed -a -n 1p f', '`-a`'],
    // A bracket expression that BSD sed reads past a delimiter in.
    ["sed -n 's/[/]*/g/w ./p' f", 'the sed script'],
    ['sed -e', '`-e` with no script'],
    // BSD sed reads options only before the first operand: there the operand is the script.
    ["sed -n 's/.*/X/w out' in.txt -e p", '`-e` after an operand'],
    ["sed 'w out' in.txt -e p", '`-e` after an operand'],
    // A character past printable ASCII as the s delimiter.
    ['sed -n \'s\u00e9a\u00e9\u00c0w x\u00c0\u00e9\' f', 'the sed script'],
    // Bracket expressions read alike by both seds only when they hold no delimiter, backslash or line end.
    ["sed -n '/[\\n]/p' f", 'the sed script'],
    ["sed -n 's][x]]y]p' f", 'the sed script'],
    ["sed -n 's/[]/]/g' f", 'the sed script'],
  ])('refuses %j, naming %s', (command, named) => {
    expect(notOnlyReading(command)).toContain(named)
  })

  it.each([
    "sed -n '1,40p' f",
    'sed -ne 1p f',
    "sed -n -e 1p -e '$p' f",
    "sed -nE '/a+/p' f",
    "sed -n -e'1,3p' f",
    "sed -nre '/x/p' f",
    "sed -n -- '1p' f",
    "sed -n '/[0-9]/p' f",
    "sed -n '/^[[:space:]]*kind:/p' f",
    "sed -n 's/[a-z]*/X/p' f",
    "sed -n '/[^]x]/p' f",
    'sed -u -n 1p -',
    'sed -n -e 1p -- -name.txt',
  ])('lets %j read', (command) => {
    expect(notOnlyReading(command)).toBeNull()
  })

  it('refuses every command that writes, reads another file or runs a program, in every form a script takes', () => {
    const commands = ['e', 'e id', 'w out', 'W out', 'r f', 'R f', 's/a/b/w out', 's/a/b/e', 's|a|b|w out', 's,a,b,e', 's/a/b/gw out', 's/a/b/2e',
      's/a/b/ w out', 's/a/b/pw out', 's#a#b#we']
    const forms = (c: string) => [c, `1${c}`, `$${c}`, `/x/${c}`, `/x/!${c}`, `1,3${c}`, `{${c}}`, `p;${c}`, `p\n${c}`, ` ${c} `, `1{p;${c}}`, `/[x]/${c}`]
    const spellings = (s: string) => [`sed -n '${s}' f`, `sed '${s}' f`, `sed -n -e '${s}' f`, `sed -ne '${s}' f`, `sed -n -e'${s}' f`, `sed -e 1p -e '${s}' f`,
      `sed -n -- '${s}' f`, `sed -n "${s}" f`]
    const allowed: string[] = []
    let tried = 0
    for (const c of commands) {
      for (const s of forms(c)) {
        for (const command of spellings(s)) {
          tried++
          if (notOnlyReading(command) === null) allowed.push(command)
        }
      }
    }
    expect(allowed).toEqual([])
    expect(tried).toBe(commands.length * 12 * 8)
  })
})

describe('an argument the shell expands, given to a reader whose options can write or run', () => {
  it.each([
    ["sed -n -e p {-e,'1w out'} in.txt", "`{-e,1w out}`"],
    ['sed -n -e p ${X:--e1wx} in.txt', 'a `${ }` with an operator or a flag'],
    ['sed -n -e p $(printf %s -e1wx) in.txt', 'an argument the shell expands'],
    ['sed -n -e p "$(printf %s -e1wx)" in.txt', 'an argument the shell expands'],
    ['sed -n -e p `printf %s -e1wx` in.txt', 'an argument the shell expands'],
    ['sed -n -e p * ', '`*`'],
    ['sed -n -e p x$(printf %s " -e1wx") in.txt', 'an argument the shell expands'],
    ['sort -n {-o,sorted.out} in.txt', 'an argument the shell expands'],
    ['find . {-delete,-print}', 'an argument the shell expands'],
    ['git diff {--output=x,HEAD}', 'an argument the shell expands'],
    ['rg {--pre=sh,x} f', 'an argument the shell expands'],
    ['tree ?o x', 'an argument the shell expands'],
    ['sed -n 1p "$HOME/x"', 'an argument the shell expands'],
    ['xxd in.txt out.txt', '`xxd` with an output file'],
    ['xxd -r -c 16 in.hex out.bin', '`xxd` with an output file'],
    ['xxd -r - out.bin', '`xxd` with an output file'],
    // A command substitution inside arithmetic or a parameter's default runs too.
    ['cat $(( $(id) ))', 'a command inside `$(( ))`'],
    ['echo $(( x$(id) ))', 'a command inside `$(( ))`'],
    ['echo $(( `id` ))', 'a command inside `$(( ))`'],
    ['echo ${x:-$(touch y)}', 'a `${ }` with an operator or a flag'],
    ['tail ${x:-$(touch y)}', 'a `${ }` with an operator or a flag'],
    ['cat ${x:-`id`}', 'a `${ }` with an operator or a flag'],
    ['cat ${x:-<(touch y)}', 'a `${ }` with an operator or a flag'],
    ["cat ${x:-'}'$(touch y)}\\'", 'a `${ }` with an operator or a flag'],
    ['echo ${(e):-\\$\\(touch y\\)}', 'a `${ }` with an operator or a flag'],
    ['echo ${HOME:-/tmp}', 'a `${ }` with an operator or a flag'],
    ["printf -v 'a[$(touch y)]' %s 1", '`-v`'],
    ['printf $X %s 1', 'an argument the shell expands'],
    ['cat $(( ${(e):-${(#):-36}${(#):-40}touch y${(#):-41}} ))', 'a command inside `$(( ))`'],
    ['cat $(( ${x:-1} ))', 'a command inside `$(( ))`'],
    ["cd 'x(e:touch y:)'; echo $~PWD", '`$~`'],
    ['echo $=x $^x', '`$=`'],
    ['file -C -m magic', '`-C`'],
  ])('refuses %j, naming %s', (command, named) => {
    expect(notOnlyReading(command)).toContain(named)
  })

  it.each([
    "sed -n '1,5p' src/*.ts",
    "sed -n '1p' ~/notes.txt",
    'cat "$HOME/x"',
    'cat *',
    'grep -rn x $(ls)',
    'ls {a,b}',
    'git log -n 5 -- src/a.ts',
    'find src -name "*.ts"',
    'xxd -c 16 in.bin',
    'echo $(( 1 + 2 ))',
    'echo $(( $x + $# * 2 ))',
    'grep x$ f',
    'grep "x$" f',
    'cat "${HOME}/x" ${#x} $1',
    "printf '%s\\n' a",
    'file -b x',
  ])('lets %j read', (command) => {
    expect(notOnlyReading(command)).toBeNull()
  })
})
