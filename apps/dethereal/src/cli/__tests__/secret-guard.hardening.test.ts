/**
 * What a shell command may reach through a folder, on every harness: a folder holding what no command may read (the
 * server's folder, a harness's sign-in, Codex's config.toml) is refused to any command that does more than list names,
 * and to every part of a line that feeds one part's output to another; a command that only reads passes what it may
 * read. Also: macOS keychain secrets, the reads that count as reads, and one deadline for the whole decision.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rawEventFrom } from '../config-guard.js'
import { decideCodexAccess, decideOpenCodeAccess, decideSecretAccess, type SecretGuardEnv } from '../secret-guard.js'
import { commandNamesGuarded, guardedHomes } from '../../utils/secret-fallback.mjs'

/** A value only a secret file holds: it must never appear in anything the guard says. */
const CANARY = 'test-canary-5b21e0'

let tmp: string
let home: string
let project: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'secret-guard-hardening-')))
  home = path.join(tmp, 'home')
  project = path.join(tmp, 'project')
  for (const f of ['.dethernety/tokens.json', '.claude/.credentials.json', '.codex/auth.json', '.codex/config.toml', '.local/share/opencode/auth.json', '.local/share/opencode/mcp-auth.json']) {
    mkdirSync(path.dirname(path.join(home, f)), { recursive: true })
    writeFileSync(path.join(home, f), CANARY)
  }
  writeFileSync(path.join(home, '.claude', 'settings.json'), '{}')
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, 'src', 'app.ts'), 'export {}\n')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function env(more: Record<string, string> = {}, overrides: Partial<SecretGuardEnv> = {}): SecretGuardEnv {
  return { env: { DETHEREAL_PROJECT_ROOT: project, HOME: home, ...more }, cwd: project, platform: 'linux', now: Date.now, ...overrides }
}
const bash = (command: string, cwd = project) => rawEventFrom(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }))
/** The decision of each harness's guard on one shell command, as a reason or null. */
function decisions(command: string, g = env(), cwd = project): Record<'claude' | 'codex' | 'opencode', string | null> {
  const reason = (d: { deny: boolean; reason?: string }) => (d.deny ? d.reason! : null)
  return {
    claude: reason(decideSecretAccess(bash(command, cwd), g)),
    codex: reason(decideCodexAccess(bash(command, cwd), g)),
    opencode: reason(decideOpenCodeAccess(rawEventFrom(JSON.stringify({ tool: 'bash', directory: cwd, args: { command } })), g)),
  }
}
const refusedEverywhere = (command: string, g = env(), cwd = project) => {
  const d = decisions(command, g, cwd)
  for (const [harness, r] of Object.entries(d)) {
    expect([command, harness, r === null]).toEqual([command, harness, false])
    expect(r).not.toContain(CANARY)
  }
}
const allowedEverywhere = (command: string, g = env(), cwd = project) => {
  expect([command, decisions(command, g, cwd)]).toEqual([command, { claude: null, codex: null, opencode: null }])
}

describe('a folder holding what no command may read', () => {
  it.each([
    'diff -rN ~/.claude /tmp/empty',
    'diff -ruN ~/.codex /tmp/empty',
    "find ~/.claude -name '.cred*' | xargs cat",
    'ls -A ~/.claude | xargs -I@ cat ~/.claude/@',
    "find ~/.claude -name '.cred*' | while read f; do cat \"$f\"; done",
    'for f in $(find ~/.codex); do cat "$f"; done',
    'pax -w ~/.claude',
    'bsdtar -cf - ~/.claude',
    '7z a -so x ~/.claude',
    'find ~/.codex | cpio -o',
    "grep -d recurse '' ~/.claude",
    'tar czf - --directory=$HOME/.codex auth.json',
    'git --work-tree=$HOME/.codex diff --no-index /dev/null auth.json',
    'find ~/.local/share/opencode | sh',
    'diff -r ~/.dethernety /tmp/empty',
    'echo "$(ls ~/.codex)" | xargs cat',
    'cat $XDG_DATA_HOME$HOME/.codex/auth.json',
    'cat ${XDG_DATA_HOME:-}$HOME/.codex/auth.json',
    'cd $XDG_DATA_HOME; cat .codex/auth.json',
    'cat $(find ~/.codex -name auth.json)',
    'cat `find ~/.codex -name config.toml`',
    'xargs cat < <(find ~/.codex -name auth.json)',
    'cat <(find ~/.codex -name config.toml -exec cat {} \\;)',
    'cd ~/.codex; cat $(ls)',
    'cd ~/.claude; cat $(ls -A)',
    'cd ~/.local/share/opencode && cat $(ls)',
    'cat ~/.codex/$(echo config.toml)',
    'cd ~/.claude && ls -A | xargs cat',
    'cd ~/.codex && ls | xargs cat',
    'cd ~ && find | xargs cat',
    'cd ~/.claude && for f in $(ls -A); do cat $f; done',
    'cd ~/.claude && find | pax -w',
    'cd "$(echo ~)" && diff -rN .claude /tmp/e',
    'D=~; cd $D && diff -rN .claude /tmp/e',
    'cd "$(echo ~)/.codex" && pax -w .',
    'cd ~/.codex 2>/dev/null && cat auth.json',
    'cd ~/.codex >/dev/null && cat a*',
    'cd ~/.codex 2>/dev/null && cat *',
    'cd ~/.codex/sessions >/dev/null && cat ../auth.json',
    'D=~/.codex; cd "$D" && cat ../.codex/auth.json',
    'git -C ~/.codex/sessions diff --no-index ../auth.json /dev/null',
    'git -C ~/.codex/plugins diff --no-index ../auth.json /dev/null',
    'make -C ~/.codex/sessions -f ../auth.json',
    'tar -cf - --directory=$HOME/.codex auth.json',
    'cd "$(echo ~/.codex)" && ls | xargs cat',
    'cat "it\'s $(find ~/.codex -name auth.json)" \'x\'',
    'cd . > ~/.dethernety/tokens.json',
    'D=~/.co; cd ${D}dex; cat ~+/auth.json',
    'D=~/.co; cd ${D}dex; cd /opt/x; cat ~-/auth.json',
    'D=~/.co; cd ${D}dex; cat "$PWD/auth.json"',
    'find ~/.codex -name auth.json -print0 | sort --files0-from=-',
  ])('is refused when a command reads through it: %s', (command) => {
    refusedEverywhere(command)
  })

  it.each(['ls ~/.claude', 'ls -la ~/.codex', 'du -sh ~', 'stat ~/.codex', 'tree ~/.claude', 'find ~/.claude -name settings.json', 'cd ~ && ls', 'cat ~/.claude/settings.json', 'echo ~/.claude', 'command -v ~/.codex/bin/x', 'command -v ~/.claude'])(
    'is still listed by a command that reads only names, or read around: %s',
    (command) => {
      allowedEverywhere(command)
    },
  )

  it('is not taken for any folder once a part could not be read, unless a change of folder was lost', () => {
    for (const command of [
      'X=$(date); cat src/app.ts', 'for n in a b; do echo "$n"; done | xargs echo',
      'cd "$(git rev-parse --show-toplevel)" && npm test', 'cd "$(git rev-parse --show-toplevel)" && git status', 'cd $(dirname package.json) && ls',
      'cd "$REPO" && echo "$(date)" && npm test', 'cd src 2>/dev/null && node ../x.js .', 'cd build 2>/dev/null || mkdir build && cmake .',
      'D=src; cd "$D" && rm -rf dist/*',
    ]) allowedEverywhere(command)
    // Known over-refusal: once a change of folder was lost, a later one to a folder named in full does not restore it
    // (a `cd` in a pipeline or in the background would not move the shell).
    refusedEverywhere(`cd "$X"; cd ${project} && npm test -- .`)
  })

  it('reads a folder option\'s value from where it runs, by its place, and takes a change to a folder the command names by a variable as lost', () => {
    // Known over-refusals: the folder the shell would land in could be spoofed (`PWD=$HOME; cd "$PWD"`).
    for (const command of ['cd "$(git rev-parse --show-toplevel)" && git diff .', 'PWD=$HOME; cd "$PWD" && cat .dethernety/tokens.json', 'PWD=~; cd "$PWD" && cat .codex/auth.json']) refusedEverywhere(command)
    const deep = path.join(project, 'packages', 'app')
    mkdirSync(deep, { recursive: true })
    for (const command of ['git -C .. status', 'pnpm -C ../.. build']) allowedEverywhere(command, env({}, { cwd: deep }), deep)
    // An operand spelled as the option's value is read from the folder the option names.
    const nested = path.join(home, 'Development', 'acme')
    mkdirSync(nested, { recursive: true })
    for (const command of ['tar -C .. -cf /tmp/o.tar ..', 'tar --directory=.. -czf /tmp/o.tgz ..', 'rsync -a --chdir=.. .. /tmp/x']) {
      expect([command, decisions(command, env({}, { cwd: nested }), nested).claude]).toEqual([command, expect.any(String)])
    }
  })

  it('reads an OpenCode data folder set as an absolute path through its variable', () => {
    refusedEverywhere('diff -r $XDG_DATA_HOME /tmp/empty', env({ XDG_DATA_HOME: path.join(home, '.local', 'share') }))
  })

  it('leaves the previous folder\'s variable alone where nothing reads through it', () => {
    for (const command of ['echo $OLDPWD', 'test -n "$OLDPWD" && echo yes', 'cd src && cd "$OLDPWD" && ls']) allowedEverywhere(command)
  })

  it('leaves a shell test and a return to a folder held before alone', () => {
    mkdirSync(path.join(project, 'packages', 'web'), { recursive: true })
    for (const command of ['npm test; [ $? -eq 0 ] && echo ok', '[ "$#" -eq 0 ] && echo usage', '[[ $i -lt 3 ]]', '[ a = b ]',
      'pushd packages/web && npm run build && popd && npx tsc -p .', 'cd packages/web && npm run build && cd - && git add .']) allowedEverywhere(command)
  })

  it('reads the current and previous folders and the folder stack, however the folder is known', () => {
    // A folder that is never an ancestor of the test's home, so the refusal is for the sign-in read, on Linux too.
    for (const command of ['cd ~/.codex && cat "$PWD/auth.json"', 'cd ~/.codex && cd /opt/x && cat ~-/auth.json', 'cd ~/.codex && cd /opt/x && cat "$OLDPWD"/auth.json',
      'pushd ~/.codex; pushd /opt/x; cat ~1/auth.json']) {
      refusedEverywhere(command)
      for (const [harness, r] of Object.entries(decisions(command))) expect([command, harness, r]).toEqual([command, harness, expect.stringMatching(/harness's own sign-in/)])
    }
  })

  it('judges a change of folder\'s redirect: its target is written', () => {
    for (const command of ['cd . > ~/.codex/config.toml', 'cd . 2>~/.claude/settings.json']) expect([command, decisions(command).codex]).toEqual([command, expect.any(String)])
  })

  it('reads every part of a fed line started in the home folder', () => {
    expect(decisions('du -a | cut -f2 | xargs cat', env({}, { cwd: home }), home).codex).not.toBeNull()
  })

  it('reports what no command may read before what it may, where a folder holds both', () => {
    rmSync(path.join(home, '.codex', 'auth.json'))
    for (const command of ['rg foo ~/.codex', 'grep -rn foo ~/.codex']) expect([command, decisions(command).codex]).toEqual([command, expect.stringMatching(/config\.toml/)])
  })
})

describe('a command that only reads, over what it may read', () => {
  it('searches a project holding Codex\'s and Claude Code\'s project folders, unless the project holds a secret file', () => {
    mkdirSync(path.join(project, '.codex', 'plugins'), { recursive: true })
    mkdirSync(path.join(project, '.claude', 'skills'), { recursive: true })
    for (const command of ['rg foo .', 'grep -rn foo .', 'rg foo']) expect([command, decisions(command).codex]).toEqual([command, null])
    writeFileSync(path.join(project, '.env'), `TOKEN=${CANARY}\n`)
    for (const command of ['grep -rn foo .', 'rg foo .']) {
      const r = decisions(command).codex
      expect([command, r]).toEqual([command, expect.stringMatching(/\.env/)])
      expect(r).not.toContain(CANARY)
    }
  })

  it('reads ripgrep\'s -L as following links, not as listing names: its search of a project holding a secret file is refused', () => {
    writeFileSync(path.join(project, '.env'), `TOKEN=${CANARY}\n`)
    for (const command of ['rg -L -uu CANARY .', 'rg -uuL CANARY', 'rg --no-ignore -L CANARY .', 'grep -rn -eTODO -eclient .', 'grep -ri -esecret .', 'rg --hidden -i -esecret .', "rg --hidden -rl '^' ."]) refusedEverywhere(command)
    // Its names-only flags still list names; grep's -L lists the files without a match.
    for (const command of ['rg -l CANARY .', 'rg -c CANARY .', 'rg --files .', 'grep -rL CANARY .']) allowedEverywhere(command)
  })

  it('does not search a project whose link reaches what no command may read, however its own folders read', () => {
    mkdirSync(path.join(project, '.claude', 'skills'), { recursive: true })
    rmSync(path.join(home, '.codex', 'auth.json'))
    symlinkSync(path.join(home, '.codex'), path.join(project, '.codex'))
    for (const command of ['grep -R foo .', 'grep -R foo', 'rg foo .']) expect([command, decisions(command).codex]).toEqual([command, expect.any(String)])
  })

  it('does not search a folder that also holds what no command may read: a home folder, or a session started in it', () => {
    expect(decisions('rg foo ~').codex).not.toBeNull()
    expect(decisions('grep -rn foo .', env(), home).codex).not.toBeNull()
    expect(decisions('rg foo .', env({}, { cwd: home }), home).codex).not.toBeNull()
  })

  it('still does not copy, link or archive a folder holding what it may only read', () => {
    mkdirSync(path.join(project, '.codex', 'plugins'), { recursive: true })
    for (const command of ['cp -r . /tmp/copy', 'tar cf /tmp/a.tar .', 'ln -s .codex/plugins p']) expect([command, decisions(command).codex]).toEqual([command, expect.any(String)])
  })
})

describe('the reads a read-only root lets through', () => {
  beforeEach(() => {
    mkdirSync(path.join(project, '.claude'), { recursive: true })
    writeFileSync(path.join(project, '.claude', 'settings.json'), '{}')
  })
  const codex = (command: string) => decisions(command).codex

  it('reads a quoted text as text: a word "security" in it is no call', () => {
    for (const command of ['git commit -m "fix security export of tokens"', 'git commit -m "Harden security import paths"', 'grep -rn "security error" src', 'echo "see: security help"']) {
      allowedEverywhere(command)
    }
  })

  it('lets jq read Claude Code\'s settings', () => {
    for (const command of ['jq . ~/.claude/settings.json', 'jq .permissions .claude/settings.json']) expect([command, codex(command)]).toEqual([command, null])
  })

  it('refuses what loads or runs more than it names: a jq module or filter file, a variable, git (it reads its repository), less or more', () => {
    for (const command of [
      'jq \'import "x" as x; .\' .claude/settings.json', 'jq \'include "x"; .\' .claude/settings.json', 'jq -L /tmp . .claude/settings.json',
      'jq -f f.jq .claude/settings.json', 'jq -rf f.jq .claude/settings.json', 'X=1 jq . .claude/settings.json',
      'git diff .claude/settings.json', 'git log -p -- .claude/settings.json', 'git show HEAD:.claude/settings.json', 'git -C . diff .claude/settings.json',
      'git -C ~/.codex/plugins diff --no-index ../auth.json /dev/null', 'less .claude/settings.json', 'more .claude/settings.json',
    ]) expect([command, codex(command)]).toEqual([command, expect.any(String)])
  })
})

describe('the macOS keychain', () => {
  it('reads a long run of stars in time, and still refuses the line', () => {
    for (const n of [36, 4000]) {
      const started = performance.now()
      const d = decideSecretAccess(bash(`cat .env; ${'*'.repeat(n)}x`), env())
      expect([n, d.deny, performance.now() - started < 50]).toEqual([n, true, true])
    }
  })

  it.each([
    'security find-generic-password -s "Claude Code-credentials" -w',
    'security find-generic-password -ga me',
    'security find-internet-password -s example.com -g',
    'security dump-keychain -d',
    'security export -k login.keychain -t identities -f pkcs12 -o out.p12',
    '/usr/bin/security find-generic-password -w -s x',
    'env security dump-keychain',
    'sh -c "security dump-keychain"',
    'echo dump-keychain | xargs security',
    'echo dump-keychain | /usr/bin/xargs security',
    'xcrun security dump-keychain',
    'caffeinate -i security find-generic-password -s x -w',
    'arch -arm64 security dump-keychain',
    'script -q /dev/null security dump-keychain',
    'find /usr -maxdepth 0 -exec security dump-keychain \\;',
    'S=security; $S dump-keychain',
    '${SECURITY:-security} dump-keychain',
    'pw=$(security find-generic-password -s "Claude Code-credentials" -w); echo $pw',
    'echo `security dump-keychain`',
    'cat <(security dump-keychain)',
    'echo "$(security dump-keychain)"',
    'if true; then security dump-keychain; fi',
    'while true; do security dump-keychain; done',
    'f() { security dump-keychain; }; f',
    'find /usr -maxdepth 0 -exec security dump-keychain \\;',
    'parallel -j1 security ::: dump-keychain',
    'security find-generic -w -s "Claude Code-credentials"',
    'security find-g -ws "Claude Code-credentials"',
    'security dump-k',
    'security dump -d',
    '/usr/bin/securit? find-generic-password -w -s x',
    'security $(printf dump-keychain)',
    'X=dump-keychain; security $X',
    'security `echo dump-keychain`',
    "sh -c 'security \"$1\"' sh dump-keychain",
    'f(){ security "$@"; }; f dump-keychain',
    '{security,dump-keychain}',
    '/usr/bin/s[!x]curity dump-keychain',
    'SECURITY dump-keychain',
    'security -p x',
    'security -qp x',
    'echo dump-keychain | xargs -J % security %',
    'xargs --max-args 1 security',
    'parallel -j 1 security ::: dump-keychain',
    'sudo -u root security dump-keychain',
    'security -- dump-keychain',
    'security -q -- find-generic-password -s x -w',
    'eval security dump-keychain',
    'case x in *) security dump-keychain;; esac',
    'true && security $X',
    'ls; security "$X"',
    'echo hi | security $X',
    // A folder that is never an ancestor of the test's home, which sits under the temp folder (/tmp on Linux).
    'cd /opt/x && security $(echo dump-keychain)',
    'security -i',
    'security unlock-keychain',
  ])('refuses %s', (command) => {
    for (const [harness, r] of Object.entries(decisions(command))) expect([command, harness, r]).toEqual([command, harness, expect.stringMatching(/macOS's `security`/)])
    expect(commandNamesGuarded(command)).toBe(true)
  })

  it.each(['security find-certificate -a -p', 'security find-identity -v -p codesigning', 'security list-keychains', 'security default-keychain', 'security show-keychain-info', 'security verify-cert -c cert.crt', 'security find-generic-password -s x',
    'echo security', 'grep -rn security src', 'git commit -m "fix security issue"', 'git log --grep security src', 'cat docs/security.md', 'security list-k',
    'export CI=1 && npm run security', 'export NODE_ENV=test; echo security', 'grep -l security src/*.ts | xargs wc -l',
    'grep -rn security "$DIR"', 'echo security $HOME', 'find . -name "*" -type f', 'git add security auth', 'ls security error', 'rg needle src/* -i',
    'grep -rn security -il src', 'security help', 'git commit -m "fix security export"'])(
    'leaves %s alone, which prints no secret',
    (command) => {
      allowedEverywhere(command)
      expect(commandNamesGuarded(command)).toBe(false)
    },
  )
})

describe("OpenCode's sign-in", () => {
  it('is refused to every tool, under ~/.local/share and an XDG_DATA_HOME set as an absolute path, and by name', () => {
    const data = path.join(tmp, 'data')
    mkdirSync(path.join(data, 'opencode'), { recursive: true })
    writeFileSync(path.join(data, 'opencode', 'mcp-auth.json'), CANARY)
    const set = env({ XDG_DATA_HOME: data })
    for (const f of [path.join(home, '.local/share/opencode/auth.json'), path.join(home, '.local/share/opencode/mcp-auth.json')]) {
      expect(decideSecretAccess(rawEventFrom(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: f }, cwd: project })), env())).toMatchObject({ deny: true, reason: expect.stringMatching(/a harness's own sign-in/) })
    }
    refusedEverywhere(`cat ${data}/opencode/mcp-auth.json`, set)
    refusedEverywhere('cat "$XDG_DATA_HOME/opencode/auth.json"', set)
    refusedEverywhere('cat ~/.codex/.credentials.json')
    const homes = guardedHomes({ XDG_DATA_HOME: 'rel' }, home)
    for (const command of ['cat rel/opencode/auth.json', 'cat "$XDG_DATA_HOME"/opencode/mcp-auth.json', 'cp ~/.local/share/opencode/auth.json /tmp/x']) {
      expect([command, commandNamesGuarded(command, homes.codexHome, homes.claudeConfig, homes.vars)]).toEqual([command, true])
    }
    // Only the variable's value names it here.
    const odd = guardedHomes({ XDG_DATA_HOME: '/x/opencode' }, home)
    expect(commandNamesGuarded('cat $XDG_DATA_HOME/auth.json', odd.codexHome, odd.claudeConfig, odd.vars)).toBe(true)
  })
})

describe('one deadline for the whole decision', () => {
  /** A clock that reads the start once, then a moment past the deadline. */
  const late = () => {
    let calls = 0
    return () => (calls++ === 0 ? 1_000_000 : 1_000_000 + 7_000)
  }

  it('refuses a command it has not finished judging by then, on every harness', () => {
    // Each harness's decision with a clock of its own.
    const command = 'cat src/app.ts README.md'
    const answers = {
      claude: decideSecretAccess(bash(command), env({}, { now: late() })),
      codex: decideCodexAccess(bash(command), env({}, { now: late() })),
      opencode: decideOpenCodeAccess(rawEventFrom(JSON.stringify({ tool: 'bash', directory: project, args: { command } })), env({}, { now: late() })),
    }
    for (const [harness, d] of Object.entries(answers)) {
      expect([harness, d]).toEqual([harness, { deny: true, reason: expect.stringMatching(/ran out of time/) }])
    }
  })

  it('never hangs on a FIFO it is asked to read', () => {
    const fifo = path.join(project, 'pipe')
    if (spawnSync('mkfifo', [fifo]).status !== 0) return
    const started = Date.now()
    decideSecretAccess(rawEventFrom(JSON.stringify({ tool_name: 'Read', tool_input: { file_path: fifo }, cwd: project })), env())
    decideSecretAccess(bash(`cat ${fifo}`), env())
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
