/**
 * The two shell checks of Codex's Bash hook. No caller runs a command that runs input sent to it
 * later (Codex sends it with no hook to check it). A read-only agent's shell runs only commands that read: an allowlist of readers, every
 * command a line runs judged (a `sh -c` script, an `eval`, a substitution), and anything it cannot read
 * refused. The refusal names what it refused, so the agent can read another way.
 */
import { describe, expect, it } from 'vitest'
import { commandText, notOnlyReading, runsLaterInput } from '../shell-check.mjs'
import { shellModelWrites } from '../../acceptance/transcripts/replay.js'

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
