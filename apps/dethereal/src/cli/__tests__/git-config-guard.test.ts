/**
 * git's own configuration, hooks and attributes, which can make git run a program when the operator next runs it: an
 * agent's write of them is refused by path on every harness; a shell command that sets a key that runs a program is
 * refused on every harness; Codex's shell does not change, copy or link them. git's ordinary work, and the undo
 * workflow's commands, go on as before.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { decideConfigWrite, openCodeWriteEvent, rawEventFrom, type GuardEnv } from '../config-guard.js'
import { decideCodexAccess, decideOpenCodeAccess, decideSecretAccess, type SecretGuardEnv } from '../secret-guard.js'

let tmp: string
let home: string
let project: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'git-config-guard-')))
  home = path.join(tmp, 'home')
  project = path.join(tmp, 'project')
  mkdirSync(path.join(home, '.config', 'git'), { recursive: true })
  mkdirSync(path.join(project, '.git', 'hooks'), { recursive: true })
  mkdirSync(path.join(project, '.git', 'info'), { recursive: true })
  mkdirSync(path.join(project, 'src'), { recursive: true })
  writeFileSync(path.join(project, '.git', 'config'), '[core]\n')
  writeFileSync(path.join(home, '.gitconfig'), '[user]\n')
  writeFileSync(path.join(project, 'src', 'app.ts'), 'export {}\n')
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const configEnv = (overrides: Partial<GuardEnv> = {}): GuardEnv => ({ env: {}, home, platform: 'linux', cwd: project, readFile: () => '', ...overrides })
const write = (tool: string, input: Record<string, unknown>, g = configEnv()) =>
  decideConfigWrite(rawEventFrom(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd: project })), g)
const patch = (body: string, g = configEnv()) => write('apply_patch', { command: `*** Begin Patch\n${body}\n*** End Patch` }, g)
const GIT = /git's configuration, hooks or attributes/

const shellEnv = (more: Record<string, string> = {}): SecretGuardEnv => ({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home, ...more }, cwd: project, platform: 'linux', now: Date.now })
const bash = (command: string) => rawEventFrom(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd: project }))
/** Each harness's answer to a shell command, as a reason or null. */
function shell(command: string, g = shellEnv()): Record<'claude' | 'codex' | 'opencode', string | null> {
  const reason = (d: { deny: boolean; reason?: string }) => (d.deny ? d.reason! : null)
  return {
    claude: reason(decideSecretAccess(bash(command), g)),
    codex: reason(decideCodexAccess(bash(command), g)),
    opencode: reason(decideOpenCodeAccess(rawEventFrom(JSON.stringify({ tool: 'bash', directory: project, args: { command } })), g)),
  }
}

describe("an agent's write of git's configuration, hooks or attributes", () => {
  const targets = () => [
    '.git/config', '.git/config.worktree', '.git/hooks/pre-commit', '.git/hooks', '.git/info/attributes', '.git/modules/lib/config',
    '.git/modules/lib/hooks/post-checkout', '.git/worktrees/w/config.worktree', 'sub/.git/config', '.git/commondir', '.git/worktrees/w/gitdir',
    'wt/.git',
    path.join(home, '.gitconfig'), path.join(home, '.config', 'git', 'config'), path.join(home, '.config', 'git', 'attributes'),
  ]

  it('is refused by path on every tool and in every patch operation', () => {
    for (const f of targets()) {
      for (const d of [
        write('Write', { file_path: f, content: '[core]\n\tfsmonitor = x\n' }),
        write('Edit', { file_path: f, old_string: '[core]', new_string: '[core]\n\tpager = x' }),
        write('MultiEdit', { file_path: f, edits: [{ old_string: '[core]', new_string: '[x]' }] }),
        patch(`*** Add File: ${f}\n+x`),
        patch(`*** Update File: ${f}\n@@\n-a\n+b`),
        patch(`*** Delete File: ${f}`),
      ]) expect([f, d]).toEqual([f, { deny: true, reason: expect.stringMatching(GIT) }])
    }
  })

  it('is refused to OpenCode, through a link and in any case where the disk folds it', () => {
    const oc = openCodeWriteEvent({ tool: 'write', directory: project, args: { filePath: '.git/hooks/pre-push', content: 'x' } })!
    expect(decideConfigWrite(rawEventFrom(oc.text), configEnv())).toMatchObject({ deny: true, reason: expect.stringMatching(GIT) })
    symlinkSync(path.join(project, '.git'), path.join(project, 'g'))
    expect(write('Write', { file_path: 'g/config', content: 'x' })).toMatchObject({ deny: true })
    expect(write('Write', { file_path: '.GIT/Config', content: 'x' }, configEnv({ platform: 'darwin' }))).toMatchObject({ deny: true })
    // The disk folds the long s as it folds case; a full-width dot is a name, never a step up.
    expect(write('Write', { file_path: '.git/hook\u017f/pre-commit', content: 'x' }, configEnv({ platform: 'darwin' }))).toMatchObject({ deny: true })
    expect(write('Write', { file_path: path.join(home, '.dethernety', '\uff0e\uff0e', 'x'), content: 'x' }, configEnv({ platform: 'darwin' }))).toMatchObject({ deny: true })
    for (const f of ['.git/con\ufb01g', path.join(home, '.gitcon\ufb01g'), '.git/modules/m/con\ufb01g']) {
      expect([f, write('Write', { file_path: f, content: 'x' }, configEnv({ platform: 'darwin' }))]).toEqual([f, { deny: true, reason: expect.stringMatching(GIT) }])
    }
    const xdg = path.join(tmp, 'xdg')
    expect(write('Write', { file_path: path.join(xdg, 'git', 'config'), content: 'x' }, configEnv({ env: { XDG_CONFIG_HOME: xdg } }))).toMatchObject({ deny: true })
    // With XDG's folder set elsewhere, the default one is still git's too.
    expect(write('Write', { file_path: path.join(home, '.config', 'git', 'attributes'), content: 'x' }, configEnv({ env: { XDG_CONFIG_HOME: xdg } }))).toMatchObject({ deny: true })
  })

  it('leaves what is not configuration alone: the project\'s files, its .gitattributes, git\'s other files', () => {
    for (const f of ['src/app.ts', 'src/config', '.gitattributes', '.gitignore', '.git/HEAD', '.git/COMMIT_EDITMSG', 'config/git/config.ts',
      '.git/refs/heads/hooks', 'src/.github/config']) {
      expect([f, write('Write', { file_path: f, content: 'x' })]).toEqual([f, { deny: false }])
    }
  })
})

describe('a shell command that sets git configuration', () => {
  it.each([
    'git -c core.fsmonitor=/tmp/x status', 'git -c core.pager=less log', 'git -ccore.sshCommand=x fetch', 'git --config-env=core.editor=E commit',
    'git -c alias.x=!sh x', 'git -c include.path=/tmp/evil status', 'git -C . -c diff.x.textconv=sh diff',
    'git config core.hooksPath /tmp/h', 'git config --global core.fsmonitor x', 'git config --local filter.lfs.smudge "sh x"', 'git config set merge.x.driver x',
    'git config --add credential.helper "!x"', 'git config --file .git/config diff.external x', 'git config alias.x "!sh -c x"', 'git config -e', 'git config edit',
    'git config includeIf.gitdir:~/.path /tmp/x', 'git config hook.pre-commit.command x', 'git config difftool.x.cmd x', 'git config gpg.program x',
    'sh -c "git config core.pager x"', 'GIT_PAGER=less git log', 'env GIT_SSH_COMMAND=x git fetch', 'export GIT_EXTERNAL_DIFF=x; git diff',
    'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=x git log', 'GIT_CONFIG_PARAMETERS=x git log', 'git -c core.pager=$P log',
    // Every key in a part read by its text, each by its own value.
    'git -c core.pager=cat -c pager.log=/tmp/x log "$PWD"', 'git -c core.pager=/tmp/x -c a.b=cat log "$PWD"',
    // A key the shell fills in.
    'K=core.fsmonitor; git config "$K" /tmp/x', 'K=core.fsmonitor; git -c $K=/tmp/x status',
    // Every mode and abbreviation git's own parser reads as a write or an edit.
    'git config --rename-section foo core', 'git config rename-section inc include', 'git config --comment --get core.fsmonitor /tmp/x',
    'git config --local set core.fsmonitor /tmp/x', 'git config --typ bool core.hooksPath x', 'git config -- core.editor x -l', 'git config --edi',
    'git config -ze', 'git config --fil .git/config core.pager x',
    // An alias that passes git options or runs git config.
    'git -c alias.p="config core.fsmonitor /tmp/x" p', 'git config alias.st "-c core.fsmonitor=/tmp/x status"', 'git config alias.c config',
    // git behind another command, or a script.
    'GIT_EDITOR=/tmp/x sh -c "git commit"', 'export GIT_EDITOR=/tmp/x; sh -c "git commit"', 'GIT_SSH_COMMAND=/tmp/x xargs git fetch',
    'echo /tmp/x | xargs git config core.fsmonitor', 'find src -exec git config core.fsmonitor /tmp/x \\;', 'xcrun git config core.pager x',
    '/usr/libexec/git-core/git-config core.fsmonitor x',
    // Hooks copied from a template, or a clone's configuration.
    'git init --template=../tpl .', 'git init --templ ../tpl', 'GIT_TEMPLATE_DIR=/tmp/t git init', 'git config init.templateDir /tmp/t',
    'git clone -c core.fsmonitor=x u d', 'git clone --config=core.hooksPath=x u d',
    // Configuration or programs read from elsewhere.
    'GIT_CONFIG_GLOBAL=./x.cfg git status', 'PAGER=less git log', 'EDITOR=/tmp/x git commit', 'git --exec-path=/opt/x log', 'GIT_EDITOR+=/tmp/x git commit',
    // A value that only starts as one that runs nothing, in a part read by its text.
    "git config core.editor 'true ; touch ~/p' $X", "git config core.pager 'cat|sh -c x' $X", "git -c core.editor='true ; x' commit --allow-empty $X",
    "GIT_EDITOR='true ; x' git commit --allow-empty $X", 'git config core.editor "true $(x)"', 'git -c core.pager="c\\at" log $X',
    // git, its subcommand or its key behind a substitution.
    'git config $(echo core.pager) x', 'git $(echo config) core.pager x', '$(which git) config core.pager x',
    "git commit -m \"$(cat <<'EOF'\nx\nEOF\ngit config core.pager x\n)\"", 'echo $(true; GIT_PAGER=less git log)',
    // A here-document the shell expands.
    'cat <<EOF\n$(git config core.pager x)\nEOF',
    // Assignments and wrappers in layers, and a quote inside a word.
    'nice env GIT_PAGER=x git log', 'sudo GIT_PAGER=x git log', 'X=1 env git -c core.pager=less log', 'x=1 nice git config core.pager less',
    'find src -exec env GIT_PAGER=x git log \\;', 'command export GIT_PAGER=x; git log', '$(echo git) "co"nfig core.pager less',
    '$(echo git) -c "core".pager=less log',
  ])('refuses %s on every harness', (command) => {
    // On Codex a command naming the repository's configuration file is refused first by its shell's own pass.
    for (const [harness, r] of Object.entries(shell(command))) expect([command, harness, r]).toEqual([command, harness, expect.stringMatching(/makes git run a program|git's configuration, hooks or attributes/)])
  })

  it.each([
    'git status', 'git add .', 'git commit -m "x"', 'git log --oneline', 'git config user.email', 'git config --get core.pager', 'git config --list',
    'git config user.name "A B"', 'git config alias.st status', 'git config --unset core.pager', 'git config unset core.hooksPath', 'git -c core.pager=cat log',
    'GIT_PAGER=cat git log', 'git -C src status', 'git init', 'echo core.pager', 'git -c core.pager=cat log "$PWD"', 'git config user.name "$NAME"',
    'git clone https://example.com/r.git', 'git --exec-path', 'GIT_CONFIG_GLOBAL=/dev/null git status', 'git config --unset alias.x', 'git config filter.lfs.required true',
    // A pager or editor that runs nothing, and a pager switched off.
    'GIT_EDITOR=true git rebase --continue', 'git -c core.editor=true merge --continue', 'GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash HEAD~3',
    'GIT_PAGER= git log', 'git -c core.pager= log', 'git -c pager.log=false log', 'git config pager.branch false',
    // A commit message that names a key-like file and the word config.
    "git commit -m \"$(cat <<'EOF'\nrefactor filter.ts to read the config\nEOF\n)\"",
    "git commit -m \"$(cat <<'EOF'\nFix git config core.pager handling; set GIT_PAGER=less\nEOF\n)\"", "git commit -F - <<'EOF'\nSet GIT_PAGER=less\nEOF",
    'git commit -m "$(cat <<EOF\nAdd pager.ts and alias.ts, config\nEOF\n)"', "grep -rn 'EDITOR=' src && git status", 'git config core.whitespace -indent-with-non-tab',
    // The undo workflow's commands.
    'git diff', 'git diff HEAD', 'git checkout -- src/app.ts', 'git stash push -- src/app.ts', 'git revert HEAD', 'git revert --no-edit HEAD',
  ])('leaves %s alone on every harness', (command) => {
    expect([command, shell(command)]).toEqual([command, { claude: null, codex: null, opencode: null }])
  })
})

it('refuses a command whose git check runs past the deadline', () => {
  let calls = 0
  const g = { ...shellEnv(), now: () => (calls++ === 0 ? 1_000_000 : 1_007_000) }
  expect(decideSecretAccess(bash('git status'), g)).toMatchObject({ deny: true, reason: expect.stringMatching(/ran out of time/) })
})

it('judges a long command in time on every harness', () => {
  const command = `cat .env; git -c $X ${'difftool.'.repeat(45_000)}`
  const started = Date.now()
  const answers = shell(command)
  expect(Date.now() - started).toBeLessThan(3_000)
  expect(answers.claude).not.toBeNull()
})

describe("Codex's shell over git's configuration", () => {
  it('refuses a change, copy or link of it; lets it be read', () => {
    for (const command of ['echo x >> .git/config', 'cp x .git/hooks/pre-commit', 'ln -s /tmp/x .git/hooks/pre-push', 'sed -i s/a/b/ ~/.gitconfig',
      'tee .git/info/attributes', 'cp ~/.gitconfig /tmp/g', 'mv x ~/.config/git/config']) {
      expect([command, shell(command).codex]).toEqual([command, expect.stringMatching(GIT)])
    }
    for (const command of ['cat .git/config', 'ls .git/hooks', 'cat ~/.gitconfig', 'head .git/info/attributes']) expect([command, shell(command).codex]).toEqual([command, null])
  })

  it("reaches a submodule's configuration, and a home folder's .gitconfig by its name", () => {
    mkdirSync(path.join(project, '.git', 'modules', 'lib'), { recursive: true })
    expect(shell('echo x >> .git/modules/lib/config').codex).toMatch(GIT)
    expect(shell('echo x >> .git/modules/vendor/lib/config').codex).toMatch(GIT)
    expect(shell('cd "$X" && echo x >> .gitconfig').codex).toMatch(GIT)
  })

  it("follows a linked work tree's .git file to the repository's configuration", () => {
    const main = path.join(tmp, 'main')
    const wt = path.join(tmp, 'wt')
    mkdirSync(path.join(main, '.git', 'hooks'), { recursive: true })
    mkdirSync(path.join(main, '.git', 'worktrees', 'w'), { recursive: true })
    mkdirSync(wt)
    writeFileSync(path.join(main, '.git', 'config'), '[core]\n')
    writeFileSync(path.join(main, '.git', 'worktrees', 'w', 'commondir'), '../..\n')
    writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'w')}\n`)
    const g = { ...shellEnv({ DETHEREAL_PROJECT_ROOT: wt }), cwd: wt }
    const codex = (command: string) => decideCodexAccess(rawEventFrom(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: wt })), g)
    for (const command of ['echo x >> ../main/.git/config', 'cp x ../main/.git/hooks/pre-commit', 'echo x >> ../main/.git/worktrees/w/config.worktree',
      'echo gitdir: /tmp/x > .git']) {
      expect([command, codex(command)]).toEqual([command, { deny: true, reason: expect.stringMatching(GIT) }])
    }
    expect(codex('cat ../main/.git/config')).toEqual({ deny: false })
  })

  it('reaches the repository\'s configuration from a folder below its root too', () => {
    const g = { ...shellEnv(), cwd: path.join(project, 'src') }
    const d = decideCodexAccess(rawEventFrom(JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo x >> ../.git/config' }, cwd: path.join(project, 'src') })), g)
    expect(d).toMatchObject({ deny: true, reason: expect.stringMatching(GIT) })
  })
})
