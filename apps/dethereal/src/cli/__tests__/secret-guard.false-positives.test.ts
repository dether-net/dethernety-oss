/**
 * Commands the secret guard refused although they reach no secret, and the commands next to them that it must still
 * refuse, on every harness: a quoted multi-line argument (a commit message) read as a file name. Also pinned, as the
 * guard is conservative there by design: the body of a here-document is read as commands, whatever writes it, and an
 * interpreter's here-document after a word the guard cannot read stays refused; the workaround passes.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type GuardDecision, rawEventFrom } from '../config-guard.js'
import { decideCodexAccess, decideOpenCodeAccess, decideSecretAccess, type SecretGuardEnv } from '../secret-guard.js'

let tmp: string
let home: string
let project: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'guard-false-positives-')))
  // The home folder apart from the project's parent, so a `..` from the project reaches no home folder by accident.
  home = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'guard-false-positives-home-')))
  project = path.join(tmp, 'project')
  mkdirSync(path.join(home, '.dethernety'), { recursive: true })
  mkdirSync(path.join(project, 'deploy'), { recursive: true })
  writeFileSync(path.join(project, 'notes.md'), 'x\n')
  writeFileSync(path.join(project, '.env'), 'A=1\n')
  writeFileSync(path.join(project, 'deploy', 'secrets.yaml'), 'kind: Secret\n')
  mkdirSync(path.join(project, 'cli'), { recursive: true })
  writeFileSync(path.join(project, 'cli', '.env'), 'A=1\n')
  mkdirSync(path.join(project, 'a'), { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  rmSync(home, { recursive: true, force: true })
})

const env = (): SecretGuardEnv => ({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, cwd: project, platform: process.platform, now: Date.now })
const ev = (command: string) => rawEventFrom(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: project }))
const harnesses: Record<string, (command: string) => GuardDecision> = {
  claude: (command) => decideSecretAccess(ev(command), env()),
  codex: (command) => decideCodexAccess(ev(command), env()),
  opencode: (command) => decideOpenCodeAccess(rawEventFrom(JSON.stringify({ tool: 'bash', args: { command }, directory: project })), env()),
}
/** The verdict on each harness: `allow`, or the kind of refusal. */
const verdicts = (command: string) =>
  Object.fromEntries(
    Object.entries(harnesses).map(([name, decide]) => {
      const d = decide(command.replaceAll('@HOME@', home).replaceAll('@PROJ@', project))
      return [name, !d.deny ? 'allow' : /own folder in the home directory/.test(d.reason) ? 'state' : /is a secret file/.test(d.reason) ? 'secret' : 'other']
    }),
  )
const everywhere = (v: string) => ({ claude: v, codex: v, opencode: v })

const MESSAGE = 'docs: plan the next step\n\nCo-Authored-By: A Writer <writer@example.com>'
const NOTES = '@PROJ@/docs/state/notes.md'

describe('a quoted multi-line argument is no file name', () => {
  it.each([
    ['a commit message', `cd @PROJ@ && git add notes.md && git commit -q -m "${MESSAGE}" && git log -1`],
    ['a message starting with a line end', 'git commit -q -m "\ndocs: x"'],
    ['a message naming paths', 'git commit -q -m "fix(cli): src/a.ts and docs/b.md\n\n- see lib/x and ./y\n\nCo-Authored-By: A <a@example.com>"'],
    ['a multi-line script', `python3 -I -c "import json, os\np = os.path.expanduser('~/x/a.jsonl')\nfor l in open(p):\n    print(json.loads(l).get('type'))"`],
  ])('passes on every harness: %s', (_what, command) => {
    expect(verdicts(command)).toEqual(everywhere('allow'))
  })

  it.each([
    ['a one-line message naming .env', 'git commit -q -m "update .env"', 'secret'],
    ['a multi-line message naming .env', 'git commit -q -m "update .env\n\nbody"', 'secret'],
    ['a multi-line message naming a secret manifest', 'git commit -q -m "touch deploy/secrets.yaml\n\nbody"', 'secret'],
    ['a multi-line message naming the server folder', 'git commit -q -m "fix ~/.dethernety handling\n\nbody"', 'state'],
  ])('still refuses %s', (_what, command, kind) => {
    expect(verdicts(command)).toEqual(everywhere(kind))
  })

  it('still refuses a file whose name holds a line end', () => {
    writeFileSync(path.join(project, 'nl\nname'), 'x')
    expect(verdicts('cat "nl\nname"')).toEqual(everywhere('secret'))
  })

  // A name made in the same command, before the read: the link's target is what the guard judges.
  it.each([
    ['.env', 'secret'],
    ['deploy/secrets.yaml', 'secret'],
    ['~/.dethernety/tokens.json', 'state'],
    ['@HOME@/.dethernety/tokens.json', 'state'],
  ])('still refuses a link to %s made and read in one command', (target, kind) => {
    for (const command of [
      `ln -s ${target} "$(printf 'a\\nb')" && cat "$(printf 'a\\nb')"`,
      `ln -s ${target} $'a\\nb' && cat $'a\\nb'`,
      `ln -s ${target} "a\nb" && cat "a\nb"`,
      `cp ${target} "a\nb" && cat "a\nb"`,
    ]) expect([command, verdicts(command)]).toEqual([command, everywhere(kind)])
  })

  // A folder holding a secret, made under a control-character name in the same command, then read below it.
  const names = [['line-end', '"d\n"', '"d\n/.env"'], ['\\x01', "$'d\\x01'", "$'d\\x01/.env'"], ['\\n', "$'d\\n'", "$'d\\n/.env'"]]
  it.each(names)('still refuses a folder made under a %s name and read below it', (_what, name, below) => {
    for (const make of ['ln -s cli', 'mv cli', 'cp -R cli']) {
      for (const read of [`cat ${below}`, `head ${below}`, `cp ${below} out.txt`]) {
        const command = `${make} ${name} && ${read}`
        expect([command, verdicts(command)]).toEqual([command, everywhere('secret')])
      }
    }
  })

  it.each([
    ['a leading control character', "$'\\x01d'", "$'\\x01d/.env'"],
    ['a run of mixed control characters', "$'d\\x01\\x02\\n'", "$'d\\x01\\x02\\n/.env'"],
    ['a tab', "$'d\\t'", "$'d\\t/.env'"],
    ['a DEL', "$'d\\x7f'", "$'d\\x7f/.env'"],
  ])('still refuses a folder made under a name with %s and read below it', (_what, name, below) => {
    expect(verdicts(`ln -s cli ${name} && cat ${below}`)).toEqual(everywhere('secret'))
  })

  it.each([
    ['a glob below it', "ln -s cli $'d\\x01' && cat $'d\\x01'/.env*"],
    ['a glob below a line-end name', 'ln -s cli "d\n" && cat "d\n"/.e*'],
    ['a recursive search of it', "ln -s cli $'d\\x01' && grep -r A $'d\\x01'"],
    ['an archive of it', "ln -s cli $'d\\x01' && tar cf - $'d\\x01' | cat"],
    ['a secret known by its content below it', "ln -s deploy $'d\\x01' && cat $'d\\x01/app.yaml'"],
    ['a space-free control-character message', "git commit -q -m $'fix\\x01'"],
  ])('still refuses a control-character name with no space: %s', (_what, command) => {
    writeFileSync(path.join(project, 'deploy', 'app.yaml'), 'kind: Secret\n')
    expect(verdicts(command)).toEqual(everywhere('secret'))
  })

  // A spaced name, where a run of control characters reaches a `/` or ends the name: the pieces lose the way there.
  it.each([
    ['a space, then a line end', '"x \n"', '"x \n/.env"'],
    ['a line end, then a space', '"d\n x"', '"d\n x/.env"'],
    ['a line end, then a space before the slash', '"x\n "', '"x\n /.env"'],
    ['a space, then a tab', "$'x \\t'", "$'x \\t/.env'"],
    ['a space, then a CR', "$'x \\r'", "$'x \\r/.env'"],
    ['a space, then a form feed', "$'x \\f'", "$'x \\f/.env'"],
    ['a leading space and line end', "$' \\n'", "$' \\n/.env'"],
    ['a line end, then =', '"x \n="', '"x \n=/.env"'],
    ['a line end, then :', '"x \n:"', '"x \n:/.env"'],
    ['a line end, then @', '"x \n@"', '"x \n@/.env"'],
    ['a space and a \\x01', "$'a b\\x01'", "$'a b\\x01/.env'"],
    ['a line end, then a no-break space', '"x \n\u00a0"', '"x \n\u00a0/.env"'],
  ])('still refuses a folder made under a name with %s and read below it', (_what, name, below) => {
    expect(verdicts(`ln -s cli ${name} && cat ${below}`)).toEqual(everywhere('secret'))
  })

  // A spaced name with no control run at a `/`: judged as the same name with a plain character for each run.
  it.each([
    ['a line end, then ..', 'ln -s . "x \n.." && cat "x \n../cli/.env"'],
    ['a $\'\\n\' name, then ..', "ln -s . $'x \\n..' && cat $'x \\n../cli/.env'"],
    ['a tab, then ..', "ln -s . $'x \\t..' && cat $'x \\t../cli/.env'"],
    ['a copy out through ..', 'ln -s . "x \n.." && cp "x \n../cli/.env" a/o'],
  ])('still refuses a folder made under a spaced name with %s', (_what, command) => {
    const v = verdicts(command)
    // Codex refuses a link to the project's own folder on its plugin-folder rule before it judges the secret.
    expect([v.claude, v.opencode, v.codex === 'allow']).toEqual(['secret', 'secret', false])
  })

  it.each([
    ['a secret known by its content', 'ln -s deploy "x \n" && cat "x \n/app.yaml"'],
    ['a recursive search', 'ln -s cli "x \n" && grep -r A "x \n"'],
    ['a folder made, then moved into', 'mkdir -p "x \n" && mv cli "x \n/c" && cat "x \n/c/.env"'],
  ])('still refuses a spaced control-character name: %s', (_what, command) => {
    writeFileSync(path.join(project, 'deploy', 'app.yaml'), 'kind: Secret\n')
    expect(verdicts(command)).toEqual(everywhere('secret'))
  })

  // A name whose plain twin the classifier still cannot read (a letter and a colon first): judged once, as secret.
  it.each([
    ['a glob', 'git commit -q -m "a: b\nc" && cat cli/.e*'],
    ['a recursive search', 'git commit -q -m "a: b\nc" && grep -r A= .'],
    ['a secret known by its content', 'git commit -q -m "a: b\nc" && cat deploy/app.yaml'],
    ['a $\'…\' name and a glob', "cat $'z: a\\nb' cli/.e*"],
  ])('still refuses a twin that stays unclassifiable, before %s', (_what, command) => {
    writeFileSync(path.join(project, 'deploy', 'app.yaml'), 'kind: Secret\n')
    expect(verdicts(command)).toEqual(everywhere('secret'))
  })

  it('still refuses the home folder linked under a control-character name and read below it', () => {
    expect(verdicts("ln -s ~ $'d\\x01' && cat $'d\\x01/.dethernety/tokens.json'")).toEqual(everywhere('state'))
    expect(verdicts("cd ~ && ln -s . $'d\\x01' && cat $'d\\x01/.dethernety/tokens.json'")).toEqual(everywhere('state'))
  })

  it('still refuses a link to the server folder read through its line-end name', () => {
    expect(verdicts('ln -s ~/.dethernety "a\nb" && cat "a\nb/tokens.json"')).toEqual(everywhere('state'))
  })
})

describe('a here-document body is read as commands', () => {
  // A known over-refusal: text that names the server's folder or a secret, written with cat or tee. The Write tool
  // writes it instead.
  it.each([
    ['a backquoted folder name', `cat >> ${NOTES} <<'EOF'\n- the path holds \`.dethernety\` in its name\nEOF`],
    ['a $HOME path', `cat >> ${NOTES} <<'EOF'\n- $HOME/.dethernety is the server's folder\nEOF`],
    ['a secret file named as text', `cat > ${NOTES} <<'EOF'\n- \`deploy/secrets.yaml\` is reported by name\nEOF`],
    ['tee -a', `tee -a ${NOTES} <<'EOF'\n- \`.dethernety\` here\nEOF`],
    ['a mkdir -p before it', `mkdir -p @PROJ@/docs/state && cat > ${NOTES} <<"EOF"\n- \`.dethernety\` here\nEOF`],
    ['<<- with tabs', `cat > ${NOTES} <<-'EOF'\n\tcat ~/.dethernety/tokens.json\n\tEOF`],
    ['blank lines after the delimiter', `cat > ${NOTES} <<'EOF'\n- \`.dethernety\` here\nEOF\n\n  \t\n`],
  ])('stays refused on every harness: %s', (_what, command) => {
    for (const [name, decide] of Object.entries(harnesses)) {
      expect([name, decide(command.replaceAll('@HOME@', home).replaceAll('@PROJ@', project)).deny]).toEqual([name, true])
    }
  })

  it('still refuses a brace past the bound after a here-document', () => {
    const many = `{${Array.from({ length: 65 }, (_, i) => `f${i}`).join(',')}}`
    const command = `cat <<'EOF' >/dev/null\nnote\nEOF\necho $((1<<2))\ncat ${many}`
    for (const decide of Object.values(harnesses)) {
      expect(decide(command)).toMatchObject({ deny: true, reason: expect.stringContaining('a brace expansion past 64 words') })
    }
  })

  const refused: [string, string, string][] = [
    ['a plain read of the folder', 'cat ~/.dethernety/tokens.json', 'state'],
    ['the folder on the opener line', "cat > ~/.dethernety/x <<'EOF'\nhi\nEOF", 'state'],
    ['the folder on the opener line, tee', "tee ~/.dethernety/x <<'EOF'\nhi\nEOF", 'state'],
    ['a secret on the opener line', "cat >> .env <<'EOF'\nA=1\nEOF", 'secret'],
    ['a shell fed the body', "bash <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['a shell fed a secret name', "sh <<'EOF'\ncat deploy/secrets.yaml\nEOF", 'secret'],
    ['names fed to xargs', "xargs cat <<'EOF'\n~/.dethernety/tokens.json\nEOF", 'state'],
    ['an unquoted delimiter', `cat > ${NOTES} <<EOF\n$(cat ~/.dethernety/tokens.json)\nEOF`, 'state'],
    ['a command after the body', `cat > ${NOTES} <<'EOF'\nnote\nEOF\ncat ~/.dethernety/tokens.json`, 'state'],
    // What the body writes, a command after it can run.
    ['the body run with sh', "cat > a/x.sh <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF\nsh a/x.sh", 'state'],
    ['the body run with bash', "cat > a/x.sh <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF\nbash a/x.sh", 'state'],
    ['the body sourced with .', "cat > a/x.sh <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF\n. a/x.sh", 'state'],
    ['the body sourced', "cat > a/x.sh <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF\nsource a/x.sh", 'state'],
    ['the body made executable and run', "cat > a/x.sh <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF\nchmod +x a/x.sh && ./a/x.sh", 'state'],
    ['the body written by tee and run', "tee a/x.sh <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF\nsh a/x.sh", 'state'],
    ['a secret read by the body run', "cat > a/x.sh <<'EOF'\ncat deploy/secrets.yaml\nEOF\nsh a/x.sh", 'secret'],
    ['a separator line after the delimiter', "cat > a/x.sh <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF\n;", 'state'],
    ['a comment line after the delimiter', "cat > a/x.sh <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF\n# done", 'state'],
    ['a CR line after the delimiter', "cat > a/x.sh <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF\n\r", 'state'],
    ['a comment before the opener', "echo hi #; cat > a/f <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['a double quote across lines', "echo \"start\ncat > a/f <<'EOF'\n\" ; cat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['an opener inside quotes', "echo 'x && cat > a/f <<'EOF''\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['an escaped quote before the opener', 'echo "\\" ; cat >/dev/null <<"EOF"\n"; cat ~/.dethernety/tokens.json\nEOF', 'state'],
    ['a substitution around the opener', "echo \"$(echo \" ; cat >/dev/null <<'EOF'\n\")\" ; cat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['a backquote around the opener', "echo \"`echo \" ; cat >/dev/null <<'EOF'\n\"`\" ; cat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['cat hashed to a shell (zsh)', "hash cat=/bin/sh; cat <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['cat hashed to a shell (bash)', "hash -p /bin/sh cat; cat <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['cat aliased on the line', "alias cat=sh; cat <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['a bare word after the opener', "cat <<'EOF' Q\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['a line continuation', "xargs \\\ncat <<'EOF'\n~/.dethernety/tokens.json\nEOF", 'state'],
    ['a backslash before the delimiter', `cat > ${NOTES} <<'EOF'\nx\\\nEOF\ncat ~/.dethernety/tokens.json\nEOF`, 'state'],
    ['a substitution', "x=$(cat <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF\n)", 'state'],
    ['a process substitution', "cat <<'EOF' > >(sh)\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['a group', "{ cat; } <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['a here-document on the second line', `mkdir -p x\ncat > ${NOTES} <<'EOF'\n- \`.dethernety\` here\nEOF`, 'state'],
    ['no delimiter line', `cat > ${NOTES} <<'EOF'\ncat ~/.dethernety/tokens.json`, 'state'],
    ['two here-documents', "cat <<'A' <<'B'\nA\ncat ~/.dethernety/tokens.json\nB", 'state'],
    ['a CR on the opener line', `cat > ${NOTES} <<'EOF'\r\ncat ~/.dethernety/tokens.json\nEOF`, 'state'],
    ['a CR on the delimiter line', `cat > ${NOTES} <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF\r\nls`, 'state'],
    // The same exclusions with cat first, so the grammar's own refusal is what decides them.
    ['cat, then a comment', "cat a/x.md #x.md <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['cat, then a double quote', "cat \"a/x.md <<'EOF' \"a/y.md\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['cat, then a single quote', "cat 'a/x.md <<'EOF' 'a/y.md\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    // `\<` is a character, so the shell opens no here-document and runs the next line.
    ['cat, then an escaped opener', "cat a/x.md\\<<'EOF'\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['cat, then a variable', "cat $X.md <<'EOF'\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['cat, then a separator', "cat a/x.md <<'EOF'; sh a/y.md\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
    ['cat, then a group', "cat a/x.md <<'EOF' >(sh)\ncat ~/.dethernety/tokens.json\nEOF", 'state'],
  ]
  it.each(refused)('still refuses %s', (_what, command, kind) => {
    const v = verdicts(command)
    // Codex refuses a shell left waiting for input before it judges the paths.
    if (/^(?:bash|sh) /.test(command)) expect([v.claude, v.opencode, v.codex === 'allow']).toEqual([kind, kind, false])
    else expect(v).toEqual(everywhere(kind))
  })

  it('still refuses a body piped to a shell', () => {
    const v = verdicts("cat <<'EOF' | sh\ncat ~/.dethernety/tokens.json\nEOF")
    expect(v.claude).toBe('state')
    expect(v.opencode).toBe('state')
    expect(v.codex).not.toBe('allow')
  })
})

describe('a here-document body written to a file that runs later', () => {
  const HOOK = '{"hooks": {"SessionStart": [{"hooks": [{"type": "command", "command": "cat ~/.dethernety/tokens.json"}]}]}}'
  it.each([
    ['.claude/settings.local.json'],
    ['.claude/hooks/start.json'],
    ['.codex/hooks.json'],
    ['.opencode/plugin/x.json'],
    ['opencode.json'],
    ['opencode.jsonc'],
    ['.mcp.json'],
    ['.git/hooks/pre-commit'],
    ['.git/x.json'],
    ['~/.zshenv'],
    ['@HOME@/.zshenv'],
    ['../outside.json'],
    ['a/link.json'],
    ['a/live.json'],
  ])('is read as commands when it writes %s', (target) => {
    // A dangling link to a startup file, and a live one to a file outside the project.
    symlinkSync(path.join(home, '.zshenv'), path.join(project, 'a', 'link.json'))
    writeFileSync(path.join(home, '.profile'), '')
    symlinkSync(path.join(home, '.profile'), path.join(project, 'a', 'live.json'))
    for (const write of [`cat > ${target} <<'EOF'`, `cat >> ${target} <<'EOF'`, `tee ${target} <<'EOF'`, `cat > a/x.md 2>${target} <<'EOF'`]) {
      const command = `${write}\n${HOOK}\nEOF`
      const v = verdicts(command)
      // Codex refuses some of these paths on its own roots first.
      expect([command, v.claude, v.opencode, v.codex === 'allow']).toEqual([command, 'state', 'state', false])
    }
  })

  it.each([
    ['mkdir -p a/b&&tee ~/.zshenv'],
    ['mkdir -p a/b &&tee -a .git/hooks/pre-commit'],
    ['mkdir -p a/b&& tee .claude/settings.local.json'],
    ['mkdir -p a/b&&cat > ~/.zshenv'],
  ])('is read as commands when the line is %s', (opener) => {
    const command = `${opener} <<'EOF'\n${HOOK}\nEOF`
    const v = verdicts(command)
    expect([command, v.claude, v.opencode, v.codex === 'allow']).toEqual([command, 'state', 'state', false])
  })

  it('is refused when its target cannot be placed', () => {
    // A descriptor names a file by another name: the opener line is refused for it, before the body.
    for (const decide of Object.values(harnesses)) expect(decide(`cat > /dev/fd/3 <<'EOF'\n${HOOK}\nEOF`)).toMatchObject({ deny: true })
  })

  it.each([
    ["zsh's =cmd with tee", "tee =evil.sh <<'EOF'"],
    ["zsh's =cmd after a redirect", "cat >=evil.sh <<'EOF'"],
  ])('is read as commands with %s', (_what, opener) => {
    const v = verdicts(`${opener}\n${HOOK}\nEOF`)
    expect([v.claude, v.opencode, v.codex === 'allow']).toEqual(['state', 'state', false])
  })

  it.each([
    ['a startup file', '.zshenv'],
    ['a git hook', '.git/hooks/pre-commit'],
  ])('is read as commands when it writes a hard link to %s', (_what, file) => {
    const at = file.startsWith('.git') ? path.join(project, file) : path.join(home, file)
    mkdirSync(path.dirname(at), { recursive: true })
    writeFileSync(at, '')
    linkSync(at, path.join(project, 'hard'))
    const v = verdicts(`cat >> ./hard <<'EOF'\n${HOOK}\nEOF`)
    expect([v.claude, v.opencode, v.codex === 'allow']).toEqual(['state', 'state', false])
  })
})

describe('an internal fault in the Bash check', () => {
  it('never lets the call through, wherever it happens', () => {
    // A recursive search walks a folder, so the check's own clock runs inside the project's checks too.
    for (const f of ['n.md', 'm.md', 'o.md']) writeFileSync(path.join(project, 'a', f), 'x\n')
    for (let n = 1; n < 400; n++) {
      let calls = 0
      const g: SecretGuardEnv = {
        ...env(),
        now: () => {
          if (++calls === n) throw new TypeError('a fault')
          return Date.now()
        },
      }
      let d: GuardDecision | 'thrown'
      try {
        d = decideSecretAccess(ev('cat notes.md && grep -rn x a'), g)
      } catch {
        d = 'thrown'
      }
      // Past the last call there is no fault, and the command is allowed.
      if (calls < n) {
        expect(d).toEqual({ deny: false })
        break
      }
      expect([n, d === 'thrown' || d.deny]).toEqual([n, true])
    }
  })
})

describe('Codex\'s own roots in a here-document body that a command after it runs', () => {
  it.each([
    ["Codex's config", "cat > a/x.sh <<'EOF'\ncat ~/.codex/config.toml\nEOF\nsh a/x.sh"],
    ["Claude Code's settings", "cat > a/x.sh <<'EOF'\necho x > ~/.claude/settings.json\nEOF\nsh a/x.sh"],
  ])('are still refused on Codex: %s', (_what, command) => {
    expect(harnesses.codex!(command.replaceAll('@HOME@', home))).toMatchObject({ deny: true })
  })
})

describe('an interpreter\'s here-document after a word the guard cannot read', () => {
  const body = "import sys\nfor line in open(sys.argv[1]):\n    print(line[:80], '|', len(line))\nprint('====')\n"
  const file = '@HOME@/x/-Users-x-src-example/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.jsonl'

  it('stays refused: after `"$J"` the folder may be anywhere, and an unpaired bracket matches any name', () => {
    expect(verdicts(`J=${file}; python3 -I - "$J" <<'EOF'\n${body}EOF`)).toEqual(everywhere('state'))
  })

  it('passes with the path written out (Codex refuses an interpreter fed its input on its own rule)', () => {
    const v = verdicts(`python3 -I - "${file}" <<'EOF'\n${body}EOF`)
    expect(v.claude).toBe('allow')
    expect(v.opencode).toBe('allow')
  })
})

describe('a symbolic link target is read from the folder the link is made in', () => {
  // From the project, `../cli/.env` is outside it; from `a/`, where the link is made, it is the project's own cli/.env.
  it.each([
    ['ln -s ../cli/.env a/q && cat a/q'],
    ['ln -sf ../cli/.env a/q; cat a/q'],
    ['ln -s -- ../cli/.env a/q && cat a/q'],
    // The link alone: its name is the target's, but the link is refused for where its target leads.
    ['ln -s ../cli/.env a/'],
    ['ln -s ../cli/.env ../notes.md a'],
    ['ln -s -t a ../cli/.env'],
    ['ln --symbolic --target-directory=a ../cli/.env'],
    ['/bin/ln -ns ../cli/.env a/q && cat a/q'],
    // GNU's abbreviated long options.
    ['ln --sym ../cli/.env a/q && cat a/q'],
    ['ln -s --targ=a ../cli/.env && grep -R A a'],
    ['ln -s --target a ../cli/.env && grep -R A a'],
    // After assignments, wrappers and keywords, inside xargs, find and a substitution, and by its other names.
    ['X=1 ln -s ../cli/.env a/q && cat a/q'],
    ['command ln -s ../cli/.env a/q && cat a/q'],
    ['env ln -s ../cli/.env a/q && cat a/q'],
    ['sudo ln -s ../cli/.env a/q && cat a/q'],
    ['if true; then ln -s ../cli/.env a/q; fi; cat a/q'],
    ['echo | xargs ln -s ../cli/.env a/q; cat a/q'],
    ["find notes.md -exec ln -s ../cli/.env a/q ';' ; cat a/q"],
    ['x=$(ln -s ../cli/.env a/q); cat a/q'],
    ['gln -s ../cli/.env a/q && cat a/q'],
    ['busybox ln -s ../cli/.env a/q && cat a/q'],
    // A folder the line makes first, a link made through a link made before it, and a link moved after it is made.
    ['mkdir b && ln -s ../cli/.env b && cat b/.e*'],
    ['mkdir -p d1/d2 && ln -s d1/d2 s && ln -s ../../cli/.env s/q && cat s/q'],
    ['mkdir -p a/b/c && ln -s ../../../cli/.env a/b/l && mv a/b/l a/b/c/q && cat a/b/c/q'],
  ])('refuses %s', (command) => {
    expect(verdicts(command)).toEqual(everywhere('secret'))
  })

  // Each reading on its own: a secret known only by its content, so no name gives it away.
  it('reads a target from the destination as a folder: a link put into one', () => {
    writeFileSync(path.join(project, 'deploy', 'app.yaml'), 'kind: Secret\n')
    expect(verdicts('ln -s app.yaml deploy/ && cat deploy/app.yaml.bak')).toEqual(everywhere('secret'))
  })

  it('reads a target from the folder as the system resolves it, through a link to outside the project', () => {
    writeFileSync(path.join(project, 'deploy', 'app.yaml'), 'kind: Secret\n')
    mkdirSync(path.join(tmp, 'x', 'y', 'z'), { recursive: true })
    symlinkSync(path.join(tmp, 'x', 'y', 'z'), path.join(project, 'ext'))
    // Refused: the folder the link lands in is outside the project, which cannot be checked.
    for (const v of Object.values(verdicts('ln -s ../../../project/deploy/app.yaml ext/q && cat ext/q'))) expect(v).not.toBe('allow')
  })

  it('reads `..` from the folder as the system resolves it, through a link inside the project', () => {
    mkdirSync(path.join(project, 'deploy', 'sub', 'inner'), { recursive: true })
    writeFileSync(path.join(project, 'deploy', 'sub', 'app.yaml'), 'kind: Secret\n')
    symlinkSync(path.join(project, 'deploy', 'sub', 'inner'), path.join(project, 'a', 'l'))
    // By its text, `a/l/..` is `a`; the system reads it as `deploy/sub`.
    expect(verdicts('ln -s ../app.yaml a/l/q && cat a/l/q')).toEqual(everywhere('secret'))
  })

  it('reads a climbing target from every folder it may end up in: a link moved deeper than it climbs', () => {
    expect(verdicts('mkdir -p a/b/c/d && ln -s ../../../../cli/.env a/b/l && mv a/b/l a/b/c/d/q && cat a/b/c/d/q')).toEqual(everywhere('secret'))
  })

  it('reads the folder through the links already on disk, and over a link with -n', () => {
    mkdirSync(path.join(project, 'node_modules', '.pnpm', 'foo@1', 'node_modules', 'foo'), { recursive: true })
    symlinkSync(path.join(project, 'node_modules', '.pnpm', 'foo@1', 'node_modules', 'foo'), path.join(project, 'node_modules', 'foo'))
    expect(verdicts('ln -s ../../../../cli/.env node_modules/foo/q && cat node_modules/foo/q')).toEqual(everywhere('secret'))
    symlinkSync(path.join(project, 'deploy'), path.join(project, 'a', 'l'))
    expect(verdicts('ln -sf ../cli/.env a/l && cat a/l/x')).toEqual(everywhere('secret'))
    expect(verdicts('ln -sfn ../cli/.env a/l && cat a/l')).toEqual(everywhere('secret'))
  })

  it('refuses a link to the server folder moved after it is made, from a project outside the home folder', () => {
    const rel = path.relative(path.join(project, 'a', 'b'), path.join(home, '.dethernety'))
    expect(verdicts(`mkdir -p a/b/c/d && ln -s ${rel} a/b/c/d/l && mv a/b/c/d/l a/b/q && cat a/b/q/tokens.json`)).toEqual(everywhere('state'))
  })

  it('refuses a link to the server folder named from the link’s own folder', () => {
    const rel = path.relative(path.join(project, 'a'), path.join(home, '.dethernety'))
    expect(verdicts(`ln -s ${rel} a/s && cat a/s/tokens.json`)).toEqual(everywhere('state'))
  })

  it.each([
    ['a hard link, whose target is read from where the command runs', 'ln ../cli/x a/q'],
    ['a link to a plain file', 'ln -s ../notes.md a/n && cat a/n'],
    ['a link made in the folder the command runs in', 'ln -s notes.md n && cat n'],
    ['a link to a readme', 'ln -s ../README.md docs/README.md'],
    ['a tool link', 'ln -sf node_modules/.bin/tsc bin/tsc'],
    ['a release switch', 'ln -sfn releases/v2 current'],
    ['two links into a folder', 'ln -s ../notes.md ../README.md docs/'],
    ['a link to a folder of code', 'ln -s ../../packages/shared a/b/shared'],
  ])('still passes %s', (_what, command) => {
    expect(verdicts(command)).toEqual(everywhere('allow'))
  })
})
