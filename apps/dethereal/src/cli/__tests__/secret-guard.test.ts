import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rawEventFrom, guardOutput } from '../config-guard.js'
import { decideCodexAccess, decideSecretAccess, decideOpenCodeAccess, commandSegments, shellWords, SECRET_GUARD_DEADLINE_MS, type SecretGuardEnv } from '../secret-guard.js'
import { SECRET_MANIFEST_PATTERN } from '../../utils/secret-paths.js'
import { runCli } from '../index.js'

/** A value only a secret file holds: it must never appear in anything the guard says. */
const CANARY = 'test-canary-7f3a9c'

let tmp: string
let project: string

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'secret-guard-')))
  project = path.join(tmp, 'project')
  mkdirSync(project, { recursive: true })
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function env(overrides: Partial<SecretGuardEnv> = {}): SecretGuardEnv {
  return { env: { DETHEREAL_PROJECT_ROOT: project }, cwd: project, platform: 'linux', now: Date.now, ...overrides }
}

function file(rel: string, content: string): string {
  const f = path.join(project, rel)
  mkdirSync(path.dirname(f), { recursive: true })
  writeFileSync(f, content)
  return f
}

const event = (tool: string, input: Record<string, unknown>, cwd = project) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input, cwd })
const decide = (text: string, g = env()) => decideSecretAccess(rawEventFrom(text), g)
const reason = (text: string, g = env()) => {
  const d = decide(text, g)
  return d.deny ? d.reason : null
}

/** A deploy folder like the synthetic fixture's: four manifests and one Secret. */
function orderdesk(): void {
  file('deploy/orders/orders-api.yaml', 'kind: Deployment\nmetadata:\n  name: orders-api\n')
  file('deploy/orders/network-policy.yaml', 'kind: NetworkPolicy\n')
  file('deploy/orders/legacy-reporting.yaml', 'kind: CronJob\n')
  file('deploy/orders/secrets.yaml', `apiVersion: v1\nkind: Secret\nmetadata:\n  name: orders-db-credentials\nstringData:\n  password: ${CANARY}\n`)
  file('deploy/orders/webhook-receiver.yaml', 'kind: Deployment\n')
}

describe('secret guard: Read', () => {
  it('denies only the secret file of a parallel batch of reads over a deploy folder', () => {
    orderdesk()
    const results = ['orders-api', 'network-policy', 'legacy-reporting', 'secrets', 'webhook-receiver'].map((n) => [n, decide(event('Read', { file_path: path.join(project, 'deploy/orders', `${n}.yaml`) })).deny])
    expect(results).toEqual([['orders-api', false], ['network-policy', false], ['legacy-reporting', false], ['secrets', true], ['webhook-receiver', false]])
  })

  it('names the file and its class, tells the agent to report it by name, and never quotes it', () => {
    orderdesk()
    const r = reason(event('Read', { file_path: 'deploy/orders/secrets.yaml' }))!
    expect(r).toMatch(/^dethereal-secret-guard: deploy\/orders\/secrets\.yaml is a secret file \(secret-values\)/)
    expect(r).toMatch(/Report it by name only \(unreadSecretFiles\)/)
    expect(r).not.toContain(CANARY)
    expect(guardOutput({ deny: true, reason: r })).not.toContain(CANARY)
  })

  it('denies a Secret manifest by its content, whatever its name (YAML and JSON)', () => {
    file('k8s/db.yml', `---\nkind: ConfigMap\n---\nkind: Secret\ndata:\n  x: ${CANARY}\n`)
    file('k8s/creds.json', `{\n  "apiVersion": "v1",\n  "kind": "Secret",\n  "data": { "x": "${CANARY}" }\n}\n`)
    file('k8s/config.yaml', 'kind: ConfigMap\ndata:\n  LOG_LEVEL: info\n')
    expect(reason(event('Read', { file_path: 'k8s/db.yml' }))).toMatch(/\(secret-manifest\)/)
    expect(reason(event('Read', { file_path: 'k8s/creds.json' }))).toMatch(/\(secret-manifest\)/)
    expect(decide(event('Read', { file_path: 'k8s/config.yaml' })).deny).toBe(false)
  })

  it('scans the whole manifest, past the first megabyte', () => {
    file('k8s/bundle.yaml', `${'# filler\n'.repeat(200_000)}kind: Secret\n`)
    expect(reason(event('Read', { file_path: 'k8s/bundle.yaml' }))).toMatch(/secret-manifest/)
  })

  it.each([
    ['.env'], ['services/api/.env.production'], ['prod.env'], ['infra/terraform.tfstate'], ['infra/prod.tfvars'], ['certs/tls.key'],
    ['home/.ssh/id_ed25519'], ['.aws/credentials'], ['.kube/config'], ['ops/kubeconfig'], ['charts/values-secret.yaml'], ['deploy/secret.yml'], ['enc/values.dec'],
  ])('denies %s by its name', (rel) => {
    file(rel, `${CANARY}\n`)
    expect(decide(event('Read', { file_path: rel })).deny).toBe(true)
  })

  it.each([['.env.example'], ['app/.env.sample'], ['src/app.env.ts'], ['pkg/kubeconfig/loader.go'], ['README.md']])('allows %s', (rel) => {
    file(rel, 'x\n')
    expect(decide(event('Read', { file_path: rel })).deny).toBe(false)
  })

  it('matches in any letter case, on a case-insensitive volume too', () => {
    file('Deploy/Orders/SECRETS.YAML', `kind: Secret\n`)
    expect(decide(event('Read', { file_path: 'Deploy/Orders/SECRETS.YAML' })).deny).toBe(true)
    // On a folding platform the path is placed in the project whatever its letter case, and the name
    // alone makes it secret, so it is denied on every system (it need not exist).
    expect(decide(event('Read', { file_path: path.join(project.toUpperCase(), 'Deploy/Orders/SECRETS.YAML') }), env({ platform: 'darwin' })).deny).toBe(true)
  })

  it('denies a link to a secret file, and a link out of the project', () => {
    orderdesk()
    symlinkSync(path.join(project, 'deploy/orders/secrets.yaml'), path.join(project, 'notes.txt'))
    writeFileSync(path.join(tmp, 'outside.txt'), 'x')
    symlinkSync(path.join(tmp, 'outside.txt'), path.join(project, 'out.txt'))
    expect(reason(event('Read', { file_path: 'notes.txt' }))).toMatch(/secrets\.yaml is a secret file/)
    expect(reason(event('Read', { file_path: 'out.txt' }))).toMatch(/could not be checked .*a link out of the project/)
  })

  it('places a path through the temp folder by its real path (/var and /private/var)', () => {
    orderdesk()
    const lexical = path.join(os.tmpdir(), path.relative(realpathSync(os.tmpdir()), project), 'deploy/orders/secrets.yaml')
    expect(decide(event('Read', { file_path: lexical })).deny).toBe(true)
  })

  it('does not judge a file outside the project, nor one that does not exist', () => {
    writeFileSync(path.join(tmp, 'secrets.yaml'), 'kind: Secret\n')
    expect(decide(event('Read', { file_path: path.join(tmp, 'secrets.yaml') })).deny).toBe(false)
    expect(decide(event('Read', { file_path: 'missing/config.yaml' })).deny).toBe(false)
  })

  it("allows a registered model's own attribute and control files, but not a link from them", () => {
    file('.dethernety/models.json', JSON.stringify({ models: [{ path: 'threat-models/orderdesk', name: 'OrderDesk' }] }))
    file('threat-models/orderdesk/manifest.json', '{}')
    file('threat-models/orderdesk/attributes/db-service-account-1.json', '{"kind": "Secret"}')
    file('threat-models/orderdesk/controls/c1.json', '{}')
    orderdesk()
    symlinkSync(path.join(project, 'deploy/orders/secrets.yaml'), path.join(project, 'threat-models/orderdesk/attributes/x.json'))
    file('other/attributes/db-service-account-1.json', '{}')
    expect(decide(event('Read', { file_path: 'threat-models/orderdesk/attributes/db-service-account-1.json' })).deny).toBe(false)
    expect(decide(event('Read', { file_path: 'threat-models/orderdesk/controls/c1.json' })).deny).toBe(false)
    expect(decide(event('Read', { file_path: 'threat-models/orderdesk/attributes/x.json' })).deny).toBe(true)
    expect(decide(event('Read', { file_path: 'other/attributes/db-service-account-1.json' })).deny).toBe(true)
  })

  it('reads notebook_path for a notebook read', () => {
    file('.env', 'X=1\n')
    expect(decide(event('NotebookRead', { notebook_path: '.env' })).deny).toBe(true)
  })
})

describe('secret guard: Grep', () => {
  it('denies a secret file as the target in every output mode', () => {
    orderdesk()
    for (const output_mode of ['files_with_matches', 'content', 'count']) {
      expect(decide(event('Grep', { pattern: 'name', path: 'deploy/orders/secrets.yaml', output_mode })).deny).toBe(true)
    }
  })

  it('denies a content search over a folder holding a secret file, and allows file names only', () => {
    orderdesk()
    expect(reason(event('Grep', { pattern: 'image:', path: 'deploy', output_mode: 'content' }))).toMatch(
      /secrets\.yaml is a secret file.* A search that shows lines never runs over a folder holding one: search a narrower path, exclude it with glob, or list file names only \(output_mode files_with_matches\)\.$/s)
    expect(decide(event('Grep', { pattern: 'image:', output_mode: 'count' })).deny).toBe(true)
    expect(decide(event('Grep', { pattern: 'image:', path: 'deploy' })).deny).toBe(false)
    expect(decide(event('Grep', { pattern: 'image:', path: 'deploy', output_mode: 'files_with_matches' })).deny).toBe(false)
  })

  it('honours a simple glob that leaves the secret out, and ignores one it cannot read', () => {
    orderdesk()
    file('src/app.py', 'x\n')
    expect(decide(event('Grep', { pattern: 'x', output_mode: 'content', glob: '*.py' })).deny).toBe(false)
    expect(decide(event('Grep', { pattern: 'x', output_mode: 'content', glob: '*.{py,ts}' })).deny).toBe(true)
    expect(decide(event('Grep', { pattern: 'x', output_mode: 'content', glob: '**/*.py' })).deny).toBe(true)
  })

  it('walks the project, not the whole disk, for a folder above it', () => {
    orderdesk()
    expect(decide(event('Grep', { pattern: 'x', path: tmp, output_mode: 'content' })).deny).toBe(true)
    mkdirSync(path.join(tmp, 'elsewhere'))
    expect(decide(event('Grep', { pattern: 'x', path: path.join(tmp, 'elsewhere'), output_mode: 'content' })).deny).toBe(false)
  })
})

describe('secret guard: Bash', () => {
  it.each([
    ['cat deploy/orders/secrets.yaml'],
    ['head -5 "deploy/orders/secrets.yaml"'],
    ['base64 < deploy/orders/secrets.yaml'],
    ['cat<deploy/orders/secrets.yaml'],
    ['cat deploy/orders/*'],
    ['cat deploy/orders/{orders-api,secrets}.yaml'],
    ['cd deploy/orders && cat *.yaml'],
    ['git show HEAD:deploy/orders/secrets.yaml'],
    ['kubectl create secret generic x --from-file=deploy/orders/secrets.yaml'],
    ['grep -rn image: deploy'],
    ['rg image deploy'],
    ['git grep -n password'],
    ['ug -n password deploy'],
    ['ugrep -r password'],
    ['echo $(cat deploy/orders/secrets.yaml)'],
    ['kubectl get secret orders -o yaml'],
    ['docker compose config'],
    ['printenv'],
  ])('denies %s', (command) => {
    orderdesk()
    const r = reason(event('Bash', { command }))
    expect(r).not.toBeNull()
    expect(r).not.toContain(CANARY)
  })

  it.each([
    ['ls deploy/orders'],
    ['cat deploy/orders/orders-api.yaml'],
    [`grep -rliE '${SECRET_MANIFEST_PATTERN}' -- 'deploy'`],
    ["git ls-files --format='%(objectmode) %(path)' -- 'deploy/orders/secrets.yaml'"],
    ["grep -lwF -d skip -- 'name: orders-db-credentials' 'deploy/orders/secrets.yaml'"],
    ['grep -rl image: deploy'],
    ['ug -l password deploy'],
    ['git status'],
    ['echo $HOME'],
  ])('allows %s', (command) => {
    orderdesk()
    expect(decide(event('Bash', { command })).deny).toBe(false)
  })

  it('denies a name search looping over names: it is not the one-name form, and says what is', () => {
    orderdesk()
    const r = reason(event('Bash', { command: `for n in a b; do grep -lwF -d skip -- "name: $n" 'deploy/orders/secrets.yaml'; done` }))!
    expect(r).toMatch(/secret file/)
    expect(r).toContain("grep -lwF -d skip -- 'name: <secret-name>' '<file>'")
  })

  it('splits command lines and words as a shell would, outside quotes', () => {
    expect(commandSegments("a 'x;y' && b | c; d")).toEqual(["a 'x;y'", 'b', 'c', 'd'])
    expect(shellWords(`cat "a b" 'c' d\\ e`)).toEqual(['cat', 'a b', 'c', 'd e'])
    expect(shellWords('echo $(id)')).toBeNull()
  })
})

describe('secret guard: failing closed', () => {
  it('denies a Read it cannot place, and a Grep that runs out of time', () => {
    orderdesk()
    expect(reason(event('Read', { file_path: 'x.yaml' }), env({ env: { DETHEREAL_PROJECT_ROOT: path.join(tmp, 'missing') } }))).toMatch(/could not be checked/)
    let t = 0
    const slow = env({ now: () => (t += SECRET_GUARD_DEADLINE_MS) })
    expect(reason(event('Grep', { pattern: 'x', output_mode: 'content' }), slow)).toMatch(/ran out of time/)
  })

  it('recovers the path from an event too large to parse', () => {
    orderdesk()
    const huge = event('Read', { file_path: path.join(project, 'deploy/orders/secrets.yaml'), pad: 'x'.repeat(10) }).replace('"pad"', `"pad":"${'y'.repeat(100)}","q"`)
    expect(decideSecretAccess({ text: null, fields: rawEventFrom(huge).fields }, env()).deny).toBe(true)
  })

  it('allows Bash after an internal error unless its text names a secret file', () => {
    expect(decide(event('Bash', { command: 'ls' }), env({ env: { DETHEREAL_PROJECT_ROOT: path.join(tmp, 'missing') } })).deny).toBe(false)
    expect(decide(event('Bash', { command: 'cat .env' }), env({ env: { DETHEREAL_PROJECT_ROOT: path.join(tmp, 'missing') } })).deny).toBe(true)
  })

  it('leaves other tools alone', () => {
    orderdesk()
    expect(decide(event('Glob', { pattern: '**/secrets*.yaml' })).deny).toBe(false)
    expect(decide(event('Write', { file_path: '.env', content: 'x' })).deny).toBe(false)
  })
})

describe('secret guard: the hook command', () => {
  const io = (guardEvent: () => Promise<ReturnType<typeof rawEventFrom>>) => {
    const out: string[] = []
    const err: string[] = []
    return { out, err, io: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s), guardEvent } }
  }

  it('denies through its output and exits 0', async () => {
    orderdesk()
    const t = io(async () => rawEventFrom(event('Read', { file_path: path.join(project, 'deploy/orders/secrets.yaml') })))
    const saved = process.env.DETHEREAL_PROJECT_ROOT
    process.env.DETHEREAL_PROJECT_ROOT = project
    try {
      expect(await runCli(['hook', 'secret-guard', '--harness', 'claude'], t.io as never)).toBe(0)
    } finally {
      if (saved === undefined) delete process.env.DETHEREAL_PROJECT_ROOT
      else process.env.DETHEREAL_PROJECT_ROOT = saved
    }
    const out = JSON.parse(t.out.join(''))
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/^dethereal-secret-guard: /)
  })

  it('judges a shell command by name when the guard fails after reading it', async () => {
    // An event cut short whose working folder cannot be read: the guard fails after the tool and command.
    const faulty = (command: string) => {
      const known = new Map([['tool_name', ['Bash']], ['command', [command]]])
      return {
        text: null,
        fields: {
          get: (k: string) => {
            if (k === 'cwd') throw new Error('broken')
            return known.get(k)
          },
        },
      }
    }
    for (const [command, denied] of [['cat deploy/orders/secrets.yaml', true], ['cat ~/.dethernety/tokens.json', true], ['ls src', false]] as const) {
      const t = io(async () => faulty(command) as never)
      expect(await runCli(['hook', 'secret-guard'], t.io as never)).toBe(0)
      expect([command, t.out.join('').includes('"deny"')]).toEqual([command, denied])
    }
  })

  it('denies when it cannot run at all, and when it is wired for another harness', async () => {
    const t = io(async () => {
      throw new Error('broken')
    })
    expect(await runCli(['hook', 'secret-guard'], t.io as never)).toBe(0)
    expect(JSON.parse(t.out.join('')).hookSpecificOutput.permissionDecisionReason).toMatch(/^dethereal-secret-guard: .*could not be checked/)
    const u = io(async () => rawEventFrom('{}'))
    expect(await runCli(['hook', 'secret-guard', '--harness', 'other'], u.io as never)).toBe(0)
    expect(u.err.join('')).toMatch(/--harness must be claude/)
    expect(JSON.parse(u.out.join('')).hookSpecificOutput.permissionDecision).toBe('deny')
  })
})

describe('secret guard: Bash, changing folder', () => {
  const setup = () => {
    orderdesk()
    file('deploy/orders/db-connection.yaml', `kind: Secret\nstringData:\n  url: ${CANARY}\n`)
  }

  it.each([
    ['cd -- deploy/orders && cat db-connection.yaml'],
    ["cd -- 'deploy/orders' && cat db-connection.yaml"],
    ['cd -P deploy/orders && cat db-connection.yaml'],
    ['cd -L -- deploy/orders; head db-connection.yaml'],
    ['pushd deploy/orders && cat *.yaml'],
    ['cd deploy && cd orders && cat db-connection.yaml'],
  ])('denies %s (a Secret manifest by its content, reached through cd)', (command) => {
    setup()
    expect(reason(event('Bash', { command }))).toMatch(/db-connection\.yaml is a secret file \(secret-manifest\)|secrets\.yaml is a secret file/)
  })

  it("allows the workflow's own physical-path check", () => {
    setup()
    expect(decide(event('Bash', { command: "cd -- 'deploy/orders' && pwd -P" })).deny).toBe(false)
  })

  it('judges by name only after a cd it cannot follow', () => {
    setup()
    expect(decide(event('Bash', { command: 'cd - && cat secrets.yaml' })).deny).toBe(true)
    expect(decide(event('Bash', { command: 'popd && cat db-connection.yaml' })).deny).toBe(false)
  })

  it('judges a path after a cd from the starting folder too, since a subshell may have ended its cd', () => {
    setup()
    const g = env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: tmp } })
    expect(decide(event('Bash', { command: 'cd && cat deploy/orders/db-connection.yaml' }), g).deny).toBe(true)
    expect(decide(event('Bash', { command: '(cd /tmp && ls); cat deploy/orders/db-connection.yaml' }), g).deny).toBe(true)
    expect(decide(event('Bash', { command: 'cd && cat notes.txt' }), g).deny).toBe(false)
  })
})

describe('secret guard: Bash, globs in any segment', () => {
  it.each([['cat deploy/*/*.yaml'], ['head -n 50 deploy/**/*.yaml'], ['cat deploy/*/db-*.yaml'], ['cat ./deploy/[o]rders/*']])('denies %s', (command) => {
    orderdesk()
    file('deploy/orders/db-connection.yaml', 'kind: Secret\n')
    expect(decide(event('Bash', { command })).deny).toBe(true)
  })

  it('allows a glob that reaches no secret file', () => {
    orderdesk()
    file('src/api/app.py', 'x\n')
    file('src/web/main.py', 'x\n')
    expect(decide(event('Bash', { command: 'cat src/*/*.py' })).deny).toBe(false)
    expect(decide(event('Bash', { command: 'wc -l deploy/**/*.yaml' })).deny).toBe(true)
  })

  it('denies a glob it cannot expand within the bound', () => {
    orderdesk()
    expect(reason(event('Bash', { command: 'cat deploy/*/*.yaml' }), env({ maxEntries: 2 }))).toMatch(/could not be checked.*more than 2 entries/)
  })
})

describe('secret guard: Bash, find feeding a reader', () => {
  it.each([
    ["find deploy -name '*.yaml' | xargs cat"],
    ["find deploy -name '*.yaml' -print0 | xargs -0 -n 1 cat"],
    ['find deploy -type f -exec cat {} +'],
    ['find . -exec head -1 {} \\;'],
    ['find deploy -execdir grep -n password {} +'],
    ['find src -exec cat deploy/orders/secrets.yaml \\;'],
  ])('denies %s', (command) => {
    orderdesk()
    file('src/app.py', 'x\n')
    expect(decide(event('Bash', { command })).deny).toBe(true)
  })

  it.each([
    ['find deploy -type f'],
    ["find deploy -name 'secrets*.yaml'"],
    ["find deploy -name '*.yaml' | xargs grep -l image"],
    ['find deploy -exec ls -l {} \\;'],
    ['find deploy -type f | xargs wc -c'],
    ["find src -name '*.py' | xargs cat"],
  ])('allows %s', (command) => {
    orderdesk()
    file('src/app.py', 'x\n')
    expect(decide(event('Bash', { command })).deny).toBe(false)
  })
})

describe('secret guard: an event it cannot read', () => {
  it('denies a call whose tool cannot be told', () => {
    expect(reason('not json at all')).toMatch(/could not be checked .*the event could not be read/)
    expect(decideSecretAccess({ text: null, fields: new Map() }, env()).deny).toBe(true)
  })

  it('denies a read that names no file', () => {
    expect(reason(event('Read', {}))).toMatch(/could not be checked .*no file is named/)
    expect(decideSecretAccess({ text: null, fields: new Map([['tool_name', ['Read']]]) }, env()).deny).toBe(true)
  })

  it('takes a search from an event it could not read whole as a content search', () => {
    orderdesk()
    expect(decideSecretAccess({ text: null, fields: new Map([['tool_name', ['Grep']], ['path', [path.join(project, 'deploy')]]]) }, env()).deny).toBe(true)
    expect(decide(event('Grep', { pattern: 'x', path: path.join(project, 'deploy') })).deny).toBe(false)
  })
})

describe('secret guard: files a kustomization or compose file names as secret sources', () => {
  const kustomization = (dir: string, envs: string[]) => file(`${dir}/kustomization.yaml`, `resources:\n- deployment.yaml\nsecretGenerator:\n- name: s\n  envs:\n${envs.map((e) => `  - ${e}`).join('\n')}\n`)

  it('denies a secretGenerator envs target in the same folder, by any tool, and leaves the kustomization readable', () => {
    kustomization('deploy/orders', ['extra-settings.properties'])
    file('deploy/orders/extra-settings.properties', `DB_URL=${CANARY}\n`)
    file('deploy/orders/deployment.yaml', 'kind: Deployment\n')
    const r = reason(event('Read', { file_path: 'deploy/orders/extra-settings.properties' }))!
    expect(r).toMatch(/extra-settings\.properties is a secret file \(referenced by deploy\/orders\/kustomization\.yaml as a secret source\)/)
    expect(r).not.toContain(CANARY)
    expect(decide(event('Bash', { command: 'cat deploy/orders/extra-settings.properties' })).deny).toBe(true)
    expect(decide(event('Grep', { pattern: 'DB', path: path.join(project, 'deploy'), output_mode: 'content' })).deny).toBe(true)
    expect(decide(event('Read', { file_path: 'deploy/orders/kustomization.yaml' })).deny).toBe(false)
    expect(decide(event('Read', { file_path: 'deploy/orders/deployment.yaml' })).deny).toBe(false)
  })

  it('finds the naming file in an ancestor folder, and a compose env_file and secrets file', () => {
    kustomization('deploy', ['orders/extra.properties'])
    file('deploy/orders/extra.properties', 'X=1\n')
    file('compose.yaml', 'services:\n  api:\n    env_file:\n      - path: config/api.conf\n        required: false\nsecrets:\n  db:\n    file: ./config/db.txt\n')
    file('config/api.conf', 'X=1\n')
    file('config/db.txt', 'x\n')
    file('config/other.conf', 'X=1\n')
    expect(decide(event('Read', { file_path: 'deploy/orders/extra.properties' })).deny).toBe(true)
    expect(reason(event('Read', { file_path: 'config/api.conf' }))).toMatch(/referenced by compose\.yaml/)
    expect(decide(event('Read', { file_path: 'config/db.txt' })).deny).toBe(true)
    expect(decide(event('Read', { file_path: 'config/other.conf' })).deny).toBe(false)
  })

  it('does not see a reference made only from outside the folder chain (a sibling overlay), nor one out of the project', () => {
    kustomization('deploy/overlays/prod', ['../../base/prod.properties', '../../../../outside.env'])
    file('deploy/base/prod.properties', 'X=1\n')
    expect(decide(event('Read', { file_path: 'deploy/base/prod.properties' })).deny).toBe(false)
    expect(decide(event('Read', { file_path: 'deploy/overlays/prod/kustomization.yaml' })).deny).toBe(false)
  })

  it('never denies on size: a naming file past the bound names nothing', () => {
    file('deploy/kustomization.yaml', `secretGenerator:\n- name: s\n  envs:\n  - big.properties\n${'# filler\n'.repeat(200_000)}`)
    file('deploy/big.properties', 'X=1\n')
    expect(decide(event('Read', { file_path: 'deploy/big.properties' })).deny).toBe(false)
  })

  it('cannot check a target below a naming file it cannot read, and only there', () => {
    kustomization('deploy/orders', ['x.properties'])
    file('deploy/orders/a.yaml', 'kind: Deployment\n')
    file('src/app.py', 'x\n')
    chmodSync(path.join(project, 'deploy/orders/kustomization.yaml'), 0o000)
    try {
      if (process.getuid?.() === 0) return
      expect(reason(event('Read', { file_path: 'deploy/orders/a.yaml' }))).toMatch(/could not be checked .*kustomization\.yaml cannot be read/)
      expect(decide(event('Read', { file_path: 'src/app.py' })).deny).toBe(false)
    } finally {
      chmodSync(path.join(project, 'deploy/orders/kustomization.yaml'), 0o644)
    }
  })

  it('stays quick on a deep path: the cost follows the depth', () => {
    const deep = Array.from({ length: 40 }, (_, i) => `d${i}`).join('/')
    file(`${deep}/kustomization.yaml`, 'secretGenerator:\n- name: s\n  envs:\n  - x.properties\n')
    file(`${deep}/x.properties`, 'X=1\n')
    file(`${deep}/y.txt`, 'y\n')
    const t0 = performance.now()
    expect(decide(event('Read', { file_path: `${deep}/x.properties` })).deny).toBe(true)
    expect(decide(event('Read', { file_path: `${deep}/y.txt` })).deny).toBe(false)
    expect(performance.now() - t0).toBeLessThan(500)
  })
})

describe('secret guard: Bash, a reader fed by xargs, and checks that cannot finish', () => {
  it.each([
    ['ls deploy/orders | xargs -I{} cat deploy/orders/{}'],
    ['ls deploy/orders | xargs -I {} head -5 deploy/orders/{}'],
    ['cd deploy && ls orders | xargs cat'],
    ['echo .env | xargs cat'],
  ])('denies %s', (command) => {
    orderdesk()
    file('.env', 'X=1\n')
    expect(decide(event('Bash', { command })).deny).toBe(true)
  })

  it.each([['ls deploy/orders | xargs grep -l image'], ['ls src | xargs cat'], ['ls deploy/orders | wc -l']])('allows %s', (command) => {
    orderdesk()
    file('src/app.py', 'x\n')
    expect(decide(event('Bash', { command })).deny).toBe(false)
  })

  it.each([['grep -rn image .'], ['find . -exec cat {} +'], ['ls . | xargs cat']])('denies %s when the folder walk cannot finish', (command) => {
    orderdesk()
    expect(reason(event('Bash', { command }), env({ maxEntries: 2 }))).toMatch(/could not be checked .*more than 2 entries/)
  })

  it('names the wiring when it is run with another --harness', async () => {
    const out: string[] = []
    const io = { stdout: (s: string) => out.push(s), stderr: () => undefined, guardEvent: async () => rawEventFrom(event('Bash', { command: 'ls' })) }
    expect(await runCli(['hook', 'secret-guard', '--harness', 'other'], io as never)).toBe(0)
    expect(JSON.parse(out.join('')).hookSpecificOutput.permissionDecisionReason).toMatch(/^dethereal-secret-guard: this call is not run: the guard is wired with --harness "other"/)
  })
})

describe('secret guard: the name-only searches as agents write them', () => {
  const setup = () => {
    orderdesk()
    file('deploy/orders/db-connection.yaml', 'kind: Secret\nmetadata:\n  name: orders-db-credentials\n')
    file('deploy/orders/orders-api-dev.json', '{"kind": "Secret", "metadata": {"name": "payvendor-api"}}\n')
    file('deploy/orders/kustomization.yaml', 'secretGenerator:\n- name: s\n  envs:\n  - extra-settings.properties\n')
    file('deploy/orders/extra-settings.properties', `DB_URL=${CANARY}\n`)
  }

  it.each([
    ["grep -lwF -d skip -- 'name: orders-db-credentials' deploy/orders/secrets.yaml deploy/orders/db-connection.yaml deploy/orders/orders-api-dev.json"],
    ["grep -lwF -d skip -- 'name: payvendor-api' deploy/orders/db-connection.yaml"],
    ["grep -lwF -d skip -- 'name: webhook-tls'   deploy/orders/orders-api-dev.json"],
    ["\\\necho \"--- git ls-files modes for deploy/orders ---\" && \\\ngit ls-files --format='%(objectmode) %(path)' -- deploy/orders/db-connection.yaml deploy/orders/orders-api-dev.json deploy/orders/secrets.yaml deploy/orders/extra-settings.properties deploy/orders/kustomization.yaml\n"],
    ["git ls-files --format='%(objectmode) %(path)' -- 'deploy/orders/secrets.yaml' deploy/orders/db-connection.yaml"],
    ['echo "--- deploy/orders/secrets.yaml ---"'],
  ])('allows %j', (command) => {
    setup()
    expect(decide(event('Bash', { command })).deny).toBe(false)
  })

  it('still denies the read of a file a kustomization names as a secret source', () => {
    setup()
    expect(reason(event('Read', { file_path: 'deploy/orders/extra-settings.properties' }))).toMatch(/referenced by deploy\/orders\/kustomization\.yaml/)
  })

  it.each([
    [`grep -lwF -d skip -- "name: $n" deploy/orders/secrets.yaml`, /holds a variable/],
    [`grep -lwF -d skip -- 'name: a' "deploy/orders/secrets.yaml"`, /quote each path in single quotes/],
    [`grep -lwF -d skip -- 'name: a' 'name: b' deploy/orders/secrets.yaml`, /one Secret name per command/],
    [`grep -lwF -- 'name: a' deploy/orders/secrets.yaml`, /use exactly `grep -lwF -d skip/],
    [`grep -lwF -d skip -- 'name: a' deploy/orders/../orders/secrets.yaml`, /quote each path in single quotes/],
    [`git ls-files -s -- deploy/orders/secrets.yaml`, /use exactly `git ls-files --format/],
  ])('denies a near miss and says what differs: %s', (command, hint) => {
    setup()
    const r = reason(event('Bash', { command }))!
    expect(r).toMatch(/is a secret file/)
    expect(r).toMatch(hint)
  })

  it('keeps judging what echo prints when it feeds a reader', () => {
    setup()
    file('.env', 'X=1\n')
    expect(decide(event('Bash', { command: 'echo .env | xargs cat' })).deny).toBe(true)
  })
})

describe('secret guard: OpenCode events', () => {
  const oc = (tool: string, args: Record<string, unknown>, directory = project) => JSON.stringify({ tool, directory, args })
  const decideOc = (text: string, g = env()) => decideOpenCodeAccess(rawEventFrom(text), g)
  const run = async (text: string) => {
    const out: string[] = []
    const io = { stdout: (s: string) => out.push(s), stderr: () => undefined, guardEvent: async () => rawEventFrom(text) }
    expect(await runCli(['hook', 'secret-guard', '--harness', 'opencode'], io as never)).toBe(0)
    return out.join('')
  }

  it('decides read, grep and bash as the Claude calls they stand for', () => {
    orderdesk()
    file('k8s/db.yml', `kind: Secret\ndata:\n  x: ${CANARY}\n`)
    const cases: [string, Record<string, unknown>, boolean][] = [
      ['read', { filePath: path.join(project, 'deploy/orders/secrets.yaml') }, true],
      ['read', { filePath: 'deploy/orders/orders-api.yaml' }, false],
      ['read', { filePath: 'k8s/db.yml' }, true],
      ['grep', { pattern: 'password', path: 'deploy' }, true],
      ['grep', { pattern: 'image', path: 'deploy/orders', include: '*-api.yaml' }, false],
      ['bash', { command: 'cat deploy/orders/secrets.yaml' }, true],
      ['bash', { command: 'ls deploy/orders' }, false],
      ['glob', { pattern: '**/*.yaml' }, false],
      ['list', { path: 'deploy' }, false],
    ]
    for (const [tool, args, denied] of cases) {
      const claude = tool === 'read' ? event('Read', { file_path: args.filePath }) : tool === 'grep' ? event('Grep', { pattern: args.pattern, path: args.path, glob: args.include, output_mode: 'content' }) : tool === 'bash' ? event('Bash', { command: args.command }) : null
      expect([tool, args, decideOc(oc(tool, args)).deny]).toEqual([tool, args, denied])
      if (claude) expect(decide(claude).deny).toBe(denied)
    }
  })

  it('names a way out of a refused folder search that OpenCode\'s grep has', () => {
    orderdesk()
    const d = decideOc(oc('grep', { pattern: 'image:', path: 'deploy' }))
    expect(d.deny).toBe(true)
    const why = d.deny ? d.reason : ''
    expect(why).toMatch(/secrets\.yaml is a secret file.* A search that shows lines never runs over a folder holding one: search a narrower path, or narrow include so it matches no secret file; to list file names only, run the name-only shell search the secret-file instructions give\.$/s)
    expect(why).not.toMatch(/output_mode|files_with_matches|glob/)
  })

  it('treats a grep as one that shows lines, and include as its glob', () => {
    orderdesk()
    expect(decideOc(oc('grep', { pattern: 'x', path: 'deploy/orders' })).deny).toBe(true)
    expect(decideOc(oc('grep', { pattern: 'x', path: 'deploy/orders', include: 'orders-*.yaml' })).deny).toBe(false)
  })

  it('runs a bash command in its workdir, resolved from the directory', () => {
    file('deploy/orders/db-connection.yaml', 'kind: Secret\n')
    expect(decideOc(oc('bash', { command: 'cat db-connection.yaml', workdir: 'deploy/orders' })).deny).toBe(true)
    expect(decideOc(oc('bash', { command: 'cat db-connection.yaml', workdir: path.join(project, 'deploy/orders') })).deny).toBe(true)
    expect(decideOc(oc('bash', { command: 'cat db-connection.yaml' })).deny).toBe(false)
  })

  it('denies a read that names no file, and an event it cannot read', () => {
    expect(decideOc(oc('read', {})).deny).toBe(true)
    expect(decideOc('not json').deny).toBe(true)
    expect(decideOc(JSON.stringify({ args: {} })).deny).toBe(true)
  })

  it('decides an event too large to read whole on the fields recovered from it', () => {
    orderdesk()
    const raw = { text: null, fields: new Map([['tool', ['read']], ['filePath', ['deploy/orders/secrets.yaml']], ['directory', [project]]]) }
    expect(decideOpenCodeAccess(raw, env()).deny).toBe(true)
    expect(decideOpenCodeAccess({ text: null, fields: new Map() }, env()).deny).toBe(true)
  })

  it('prints the bare decision for the plugin, never the file\'s content', async () => {
    orderdesk()
    const prev = process.env.DETHEREAL_PROJECT_ROOT
    process.env.DETHEREAL_PROJECT_ROOT = project
    try {
      const denied = JSON.parse(await run(oc('read', { filePath: 'deploy/orders/secrets.yaml' })))
      expect(denied.deny).toBe(true)
      expect(denied.reason).toMatch(/^dethereal-secret-guard: .*secrets\.yaml/)
      expect(JSON.stringify(denied)).not.toContain(CANARY)
      // The plugin lets a call run on exactly this answer.
      expect((await run(oc('read', { filePath: 'deploy/orders/orders-api.yaml' }))).trim()).toBe('{"deny":false}')
    } finally {
      if (prev === undefined) delete process.env.DETHEREAL_PROJECT_ROOT
      else process.env.DETHEREAL_PROJECT_ROOT = prev
    }
  })
})

describe("the server's own folder in the home directory, on Claude", () => {
  /** A home beside the project, holding the server's folder; the project keeps its own .dethernety registry. */
  function homeWithState(): { home: string; g: SecretGuardEnv } {
    const home = path.join(tmp, 'home')
    mkdirSync(path.join(home, '.dethernety'), { recursive: true })
    writeFileSync(path.join(home, '.dethernety', 'tokens.json'), CANARY)
    file('.dethernety/models.json', JSON.stringify({ models: [] }))
    return { home, g: env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home } }) }
  }

  it('denies a read or search inside it, by its path and through a link', () => {
    const { home, g } = homeWithState()
    const key = path.join(home, '.dethernety', 'tokens.json')
    symlinkSync(path.join(home, '.dethernety'), path.join(project, 'state-link'))
    for (const text of [
      event('Read', { file_path: key }),
      event('Read', { file_path: path.join(project, 'state-link', 'tokens.json') }),
      event('Grep', { pattern: 'x', path: path.join(home, '.dethernety') }),
      event('Grep', { pattern: 'x' }, path.join(home, '.dethernety')),
    ]) {
      const r = reason(text, g)
      expect(r, text).toMatch(/\.dethernety/)
      expect(r).not.toContain(CANARY)
    }
  })

  it('denies a search over a folder that holds it, whatever the output mode', () => {
    const { home, g } = homeWithState()
    for (const mode of ['content', 'count', 'files_with_matches']) {
      expect(reason(event('Grep', { pattern: 'x', path: home, output_mode: mode }), g), mode).toMatch(/holds the server's own folder/)
    }
    expect(reason(event('Grep', { pattern: 'x', output_mode: 'files_with_matches' }, home), g)).toMatch(/holds the server's own folder/)
  })

  it('takes a glob that makes no pattern as matching, rather than let the command through', () => {
    const { g } = homeWithState()
    // A range out of order, ahead of the read it would hide.
    for (const command of ['cat ~/[b-a] ~/.dethernety/tokens.json', 'ls ~/.detherne[z-a]y']) {
      expect(reason(event('Bash', { command }), g), command).toMatch(/server's own folder/)
    }
  })

  it('reads a path written with ~ as the home directory', () => {
    const { g } = homeWithState()
    expect(reason(event('Read', { file_path: '~/.dethernety/tokens.json' }), g)).toMatch(/\.dethernety/)
    expect(reason(event('Grep', { pattern: 'x', path: '~' }), g)).toMatch(/holds the server's own folder/)
    expect(reason(event('Grep', { pattern: 'x', path: '~/.dethernety' }), g)).toMatch(/\.dethernety/)
  })

  it('folds case where the filesystem does', () => {
    const { home } = homeWithState()
    const darwin = env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home }, platform: 'darwin' })
    expect(reason(event('Read', { file_path: path.join(home, '.DETHERNETY', 'tokens.json') }), darwin)).toMatch(/\.dethernety/i)
    expect(reason(event('Bash', { command: 'cat ~/.DETHERNETY/tokens.json' }), darwin)).not.toBeNull()
  })

  it('denies a shell command that reads it, and leaves the project\'s own .dethernety alone', () => {
    const { g } = homeWithState()
    for (const command of ['cat ~/.dethernety/tokens.json', 'grep -r token "$HOME/.dethernety"', 'head -c 100 ~/.dethernety/tokens.json']) {
      expect(reason(event('Bash', { command }), g), command).toMatch(/server's own folder/)
    }
    for (const command of ['cat .dethernety/models.json', 'grep -l OrderDesk .dethernety/models.json']) {
      expect(reason(event('Bash', { command }), g), command).toBeNull()
    }
    expect(reason(event('Read', { file_path: path.join(project, '.dethernety', 'models.json') }), g)).toBeNull()
    expect(reason(event('Grep', { pattern: 'x', path: project, output_mode: 'content' }), g)).toBeNull()
  })
})

describe("ways around the check of the server's own folder", () => {
  function homeWithState(): { home: string; g: SecretGuardEnv } {
    const home = path.join(tmp, 'home')
    mkdirSync(path.join(home, '.dethernety'), { recursive: true })
    writeFileSync(path.join(home, '.dethernety', 'tokens.json'), CANARY)
    return { home, g: env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home } }) }
  }

  // macOS: the data volume holds the same folder under a second path that no link resolution names.
  it.skipIf(process.platform !== 'darwin')('denies the same folder named through the data volume', () => {
    const { home, g } = homeWithState()
    const alias = `/System/Volumes/Data${home}`
    const darwin = { ...g, platform: 'darwin' as const }
    expect(reason(event('Read', { file_path: `${alias}/.dethernety/tokens.json` }), darwin)).toMatch(/\.dethernety/)
    // Refused before anything is resolved, as every path through the data volume is.
    expect(reason(event('Grep', { pattern: 'x', path: alias, output_mode: 'content' }), darwin)).toMatch(/another name/)
    expect(reason(event('Bash', { command: `cat ${alias}/.dethernety/tokens.json` }), darwin)).not.toBeNull()
  })

  it('denies a brace sequence that spells it', () => {
    const { g } = homeWithState()
    expect(reason(event('Bash', { command: 'cat ~/.dethernet{x..z}/tokens.json' }), g)).not.toBeNull()
    expect(reason(event('Bash', { command: 'cat ~/.detherne{s..u}{x..z}/tokens.json' }), g)).not.toBeNull()
  })

  it('does not trust a bare relative cd, which CDPATH may send anywhere', () => {
    const { g } = homeWithState()
    expect(reason(event('Bash', { command: 'export CDPATH=~; cd .dethernety && cat tokens.json' }), g)).not.toBeNull()
    expect(reason(event('Bash', { command: 'CDPATH=~ pushd .dethernety; cat tokens.json' }), g)).not.toBeNull()
  })

  it('does not trust a cd whose folder the shell builds', () => {
    const { g } = homeWithState()
    for (const command of ['cd "$(printf %s ~)"; cat .dethernety/tokens.json', 'D=~; cd $D && cat .dethernety/tokens.json', 'cd `echo ~` && cat .dethernety/tokens.json']) {
      expect(reason(event('Bash', { command }), g), command).not.toBeNull()
    }
  })
})

describe("ways around the check of the server's own folder, second round", () => {
  /** A home holding the server's folder, and the project inside it (as a home directory's project would be). */
  function nested(): { home: string; g: SecretGuardEnv; proj: string } {
    const home = path.join(tmp, 'home')
    mkdirSync(path.join(home, '.dethernety'), { recursive: true })
    writeFileSync(path.join(home, '.dethernety', 'tokens.json'), CANARY)
    const proj = path.join(home, 'proj')
    mkdirSync(path.join(proj, 'src'), { recursive: true })
    return { home, proj, g: env({ env: { DETHEREAL_PROJECT_ROOT: proj, HOME: home }, cwd: proj }) }
  }
  const bash = (command: string, cwd: string, g: SecretGuardEnv) => reason(event('Bash', { command }, cwd), g)

  it('still follows a relative cd for what it plainly names, globs included', () => {
    const { proj, g } = nested()
    for (const command of ['cd src && cat ../../.dethernet?/tokens.json', 'cd src && cat ../../.dethernet{x..z}/tokens.json', 'cd src && cat ../../.dethernety/tokens.json']) {
      expect(bash(command, proj, g), command).not.toBeNull()
    }
    expect(bash('cd src && cat x.ts', proj, g)).toBeNull()
  })

  it('takes cd in any spelling the shell runs as a change of folder', () => {
    const { proj, g } = nested()
    for (const command of [
      'D=~; builtin cd "$D" && cat .dethernety/tokens.json',
      'D=~; command cd "$D" && cat .dethernety/tokens.json',
      'D=~; \\cd "$D" && cat .dethernety/tokens.json',
      "D=~; 'cd' \"$D\" && cat .dethernety/tokens.json",
      'f(){ cd ~; }; f; cat .dethernety/tokens.json',
      'D=~; cd "$D" && cat .dethernet?/tokens.json',
      'D=~; cd "$D" && cat .dether*/tokens.json',
    ]) {
      expect(bash(command, proj, g), command).not.toBeNull()
    }
    expect(bash('D=~; cd "$D" && cat src/x.ts', proj, g)).toBeNull()
  })

  it('reads braces and globs in a segment it cannot parse', () => {
    const { proj, g } = nested()
    for (const command of ['cat ~/.dether{n,n}ety/tokens.json $NOPE', 'cat ~/.dethernet?/tokens.json $NOPE', 'cat "$(echo x)" ~/.dethernet*/tokens.json', 'cat $(echo ~/.dethernet?/tokens.json)', 'cat `echo ~/.dethernet?`/tokens.json']) {
      expect(bash(command, proj, g), command).not.toBeNull()
    }
  })

  it('never lets the folder stack or the previous folder hold the server folder', () => {
    const { proj, g } = nested()
    for (const command of [
      'cd ~/.dethernety; cd /tmp; cd -; cat tokens.json',
      'pushd ~/.dethernety; pushd /tmp; popd; cat tokens.json',
      'pushd ~/.dethernety; pushd /tmp; pushd; cat tokens.json',
      'cd ~/.dethernety; cd /tmp; cat ~-/tokens.json',
      'pushd ~/.dethernety; pushd /tmp; cat ~1/tokens.json',
      'pushd ~/.dethernety; pushd /tmp; cat ~+1/tokens.json',
      'cd ~; cd /tmp; cd -; cat .dethernety/tokens.json',
      'cd ~; pushd /tmp; popd; cat .dethernety/tokens.json',
      'cd ~; pushd /tmp; pushd; cat .dethernety/tokens.json',
    ]) {
      expect(bash(command, proj, g), command).not.toBeNull()
    }
    expect(bash('cd src; cd -; cat package.json', proj, g)).toBeNull()
  })

  it("does not follow zsh's two-operand cd, nor a cd that runs in a subshell", () => {
    const { proj, g } = nested()
    for (const command of [
      'cd /proj /.dethernety; cat tokens.json',
      'cd ~ && cd /tmp | true; cat .dethernety/tokens.json',
      'cd ~; cd /tmp & cat .dethernety/tokens.json',
    ]) {
      expect(bash(command, proj, g), command).not.toBeNull()
    }
  })

  it('keeps ordinary globs and names after a cd it cannot follow', () => {
    const { proj, g } = nested()
    for (const after of ['cd src && ', 'D=src; cd "$D" && ']) {
      for (const command of [
        'ls *',
        'rm -rf dist/*',
        'cat */index.ts',
        'ls **/*.ts',
        'cat a/**/*.ts',
        'pnpm exec vitest run "src/**/*.test.ts"',
        'cat ../.dethernety-notes',
        'ls ?ethernety',
      ]) {
        expect(bash(after + command, proj, g), after + command).toBeNull()
      }
    }
    // A search of the folder it runs in needs the folder known.
    expect(bash('cd src && rg foo -g "**/*.ts"', proj, g)).toBeNull()
    expect(bash('D=src; cd "$D" && rg foo -g "**/*.ts"', proj, g)).not.toBeNull()
    for (const command of ['cat .dether*/tokens.json', 'cat .[d]ethernety/tokens.json', 'cat .dethernet?/tokens.json']) {
      expect(bash(`D=src; cd "$D" && ${command}`, proj, g), command).not.toBeNull()
    }
  })

  it('reads the server folder inside a word the shell builds, after a cd it cannot follow', () => {
    const { proj, g } = nested()
    expect(bash('D=~; cd "$D" && cat $P.dethernety/tokens.json', proj, g)).not.toBeNull()
  })

  it("reads zsh's groups, extended globs and glob qualifiers in a path", () => {
    const { proj, g } = nested()
    for (const command of [
      'cat ~/(.)dethernety/tokens.json',
      'cat ~/.dethernet(y)/tokens.json',
      'cat ~/.dethernet(y|z)/tokens.json',
      'cat ~/@(.dethernety)/tokens.json',
      'cd ~ && cat (.)dethernety/tokens.json',
      'D=~; cd "$D" && cat (.)dethernety/tokens.json',
      'ls ~/.dethernety(/) src',
      'ls -d ~/.dethernety(N) src',
    ]) {
      expect(bash(command, proj, g), command).not.toBeNull()
    }
    expect(bash('cat src/notes(1).txt', proj, g)).toBeNull()
  })

  it("takes a cd it cannot follow inside a script's text as leaving the folder unknown", () => {
    const { proj, g } = nested()
    for (const command of ["zsh -c 'cd $D; cat .dethernety/tokens.json'", 'sh -c \'cd "$D"; cat .dethernety/tokens.json\'']) {
      expect(bash(command, proj, g), command).not.toBeNull()
    }
    expect(bash("sh -c 'cd $D; cat src/x.ts'", proj, g)).toBeNull()
  })

  it("reads zsh's extended globs as matching anything", () => {
    const { proj, g } = nested()
    for (const command of [
      'setopt extendedglob; cat ~/.dethernet#y/tokens.json',
      'cat ~/(#a1).dethernetx/tokens.json',
      'cat ~/(#i).DETHERNETY/tokens.json',
      'cat ~/.(^x)/tokens.json',
      'grep -r tok ~/.dethernet?~q',
      'ls ~/.dethernet?~q',
      'zsh -o extendedglob -c "cat ~/.dethernet#y/tokens.json"',
    ]) {
      expect(bash(command, proj, g), command).not.toBeNull()
    }
    expect(bash('cat src/notes~ src/a#b.ts', proj, g)).toBeNull()
  })

  it('lets a glob reach the dot name when the command turns dot matching on', () => {
    const { proj, g } = nested()
    for (const command of [
      'D=~; cd "$D" && cat *ethernety/tokens.json(D)',
      'D=~; cd "$D" && cat **/tokens.json(D)',
      'D=~; cd "$D" && GLOBIGNORE=x; cat *ethernety/tokens.json',
      'D=~; cd "$D" && shopt -s dotglob; cat *ethernety/tokens.json',
      'D=~; cd "$D" && setopt glob_dots; cat ?dethernety/tokens.json',
      'D=~; cd "$D" && set -4; cat ?dethernety/tokens.json',
      'D=~; cd "$D" && cat */*(D)',
      'D=~; cd "$D" && cat */*.json(.D) x',
      'zsh -o globdots -c "cd -; cat */tokens.json"',
    ]) {
      expect(bash(command, proj, g), command).not.toBeNull()
    }
    expect(bash('D=~; cd "$D" && cat *ethernety/tokens.json', proj, g)).toBeNull()
  })

  it('denies a search, copy or link of a folder it cannot place', () => {
    const { proj, g } = nested()
    for (const command of [
      'D=~; cd "$D" && grep -r refresh .',
      'cd "${HOME%/}" && grep -r refresh .',
      'D=~; cd "$D" && tar czf /tmp/h.tgz .',
      'D=~; cd "$D" && ln -s . /tmp/h',
    ]) {
      expect(bash(command, proj, g), command).not.toBeNull()
    }
    expect(bash('cd src && grep -r foo .', proj, g)).toBeNull()
  })

  it('follows a cd through CDPATH, set in the command or in the environment', () => {
    const { home, proj, g } = nested()
    const parent = path.dirname(home)
    const name = path.basename(home)
    for (const command of [
      `CDPATH=${parent} cd ${name} && grep -r refresh .`,
      `export CDPATH=${parent}; cd ${name} && cat .dethernety/tokens.json`,
      `CDPATH=${parent}; cd ${name}; ls .dethernety`,
      'CDPATH=:~ cd .dethernety',
    ]) {
      expect(bash(command, proj, g), command).not.toBeNull()
    }
    const inherited = env({ env: { DETHEREAL_PROJECT_ROOT: proj, HOME: home, CDPATH: parent }, cwd: proj })
    expect(bash(`cd ${name} && grep -r refresh .`, proj, inherited)).not.toBeNull()
    expect(bash(`cd src && grep -r refresh .`, proj, g)).toBeNull()
  })

  it('judges a link made after an assignment as one made without it', () => {
    const { proj, g } = nested()
    expect(bash('X=1 ln -s ~ link', proj, g)).not.toBeNull()
  })

  it("decodes $'…' in a segment it cannot parse", () => {
    const { proj, g } = nested()
    expect(bash("cat ~/$'\\x2e'dethernety/tokens.json $NOPE", proj, g)).not.toBeNull()
  })

  it('reads a path under the data volume by its text, globs included', () => {
    const { home, proj, g } = nested()
    const rest = home.split('/').filter(Boolean)
    const globbed = `/System/Volumes/Data/${rest[0]!.slice(0, 2)}*/${rest.slice(1).join('/')}/.dethernety/tokens.json`
    expect(bash(`cat ${globbed}`, proj, g)).not.toBeNull()
    expect(bash(`cd /System/Volumes/Data/${rest[0]!.slice(0, 2)}*/${rest.slice(1).join('/')}; cat .dethernety/tokens.json`, proj, g)).not.toBeNull()
  })

  it.skipIf(process.platform !== 'darwin')('denies the data-volume path with a glob, and a search over the volume', () => {
    const { home, proj, g } = nested()
    const darwin = { ...g, platform: 'darwin' as const }
    expect(bash(`cat /System/Volumes/Data${home}/.dethernet?/tokens.json`, proj, darwin)).not.toBeNull()
    expect(reason(event('Grep', { pattern: 'x', path: '/System/Volumes/Data', output_mode: 'content' }, proj), darwin)).toMatch(/another name/)
    expect(bash('grep -r token /System/Volumes/Data', proj, darwin)).not.toBeNull()
  })
})

describe("the harnesses' own sign-ins", () => {
  /** A home beside the project holding Claude Code's and Codex's sign-ins, and a configuration folder and a Codex home set apart. */
  function homeWithSignIns(): { home: string; cfg: string; cx: string; g: SecretGuardEnv; set: SecretGuardEnv } {
    const home = path.join(tmp, 'home')
    const cfg = path.join(tmp, 'claude-config')
    const cx = path.join(tmp, 'codex-home')
    for (const f of [path.join(home, '.claude', '.credentials.json'), path.join(home, '.codex', 'auth.json'), path.join(cfg, '.credentials.json'), path.join(cx, 'auth.json')]) {
      mkdirSync(path.dirname(f), { recursive: true })
      writeFileSync(f, CANARY)
    }
    writeFileSync(path.join(home, '.claude', 'settings.json'), '{}')
    const g = env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home } })
    const set = env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home, CLAUDE_CONFIG_DIR: cfg, CODEX_HOME: cx } })
    return { home, cfg, cx, g, set }
  }
  const SIGN_IN = /a harness's own sign-in/

  it('denies reading, searching or naming in a command either sign-in in its default place', () => {
    const { home, g } = homeWithSignIns()
    for (const f of ['.claude/.credentials.json', '.codex/auth.json']) {
      expect(reason(event('Read', { file_path: path.join(home, f) }), g), f).toMatch(SIGN_IN)
      expect(reason(event('Read', { file_path: `~/${f}` }), g), f).toMatch(SIGN_IN)
      expect(reason(event('Grep', { pattern: 'x', path: path.join(home, f) }), g), f).toMatch(SIGN_IN)
      for (const command of [`cat ~/${f}`, `cp ~/${f} /tmp/x`, `head -c 10 "$HOME/${f}"`, `ln -s ~/${f} copy`]) {
        const r = reason(event('Bash', { command }), g)
        expect([command, r]).toEqual([command, expect.stringMatching(SIGN_IN)])
        expect(r).not.toContain(CANARY)
      }
    }
    // A search over a folder holding one, whatever the mode.
    for (const mode of ['content', 'files_with_matches']) {
      expect(reason(event('Grep', { pattern: 'x', path: path.join(home, '.claude'), output_mode: mode }), g), mode).toMatch(SIGN_IN)
    }
  })

  it('denies them under a CLAUDE_CONFIG_DIR or CODEX_HOME set as an absolute path, and through the variables', () => {
    const { cfg, cx, g, set } = homeWithSignIns()
    for (const f of [path.join(cfg, '.credentials.json'), path.join(cx, 'auth.json')]) {
      expect(reason(event('Read', { file_path: f }), set), f).toMatch(SIGN_IN)
      expect(reason(event('Bash', { command: `cat ${f}` }), set), f).toMatch(SIGN_IN)
    }
    for (const command of ['cat "$CLAUDE_CONFIG_DIR/.credentials.json"', 'cat ${CODEX_HOME}/auth.json']) {
      expect([command, reason(event('Bash', { command }), set)]).toEqual([command, expect.stringMatching(SIGN_IN)])
    }
    // Unset, those folders are the user's own: what lies elsewhere is no sign-in.
    expect(decide(event('Read', { file_path: path.join(cx, 'auth.json') }), g).deny).toBe(false)
    // A relative value is not a folder the guards place.
    const relative = env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: path.join(tmp, 'home'), CLAUDE_CONFIG_DIR: 'claude-config' } })
    expect(decide(event('Read', { file_path: path.join(cfg, '.credentials.json') }), relative).deny).toBe(false)
  })

  it('leaves the rest of the home folder as it was: Claude Code\'s settings, a listing, other files', () => {
    const { home, g } = homeWithSignIns()
    writeFileSync(path.join(home, 'notes.txt'), 'x')
    expect(decide(event('Read', { file_path: path.join(home, '.claude', 'settings.json') }), g).deny).toBe(false)
    expect(decide(event('Read', { file_path: path.join(home, 'notes.txt') }), g).deny).toBe(false)
    for (const command of ['ls ~/.claude', 'cat ~/.claude/settings.json', 'ls ~/.codex']) {
      expect([command, decide(event('Bash', { command }), g).deny]).toEqual([command, false])
    }
  })

  it('denies them to OpenCode and to Codex\'s shell as well', () => {
    const { home, g } = homeWithSignIns()
    const oc = (tool: string, args: Record<string, unknown>) => decideOpenCodeAccess(rawEventFrom(JSON.stringify({ tool, directory: project, args })), g)
    expect(oc('read', { filePath: path.join(home, '.claude', '.credentials.json') })).toMatchObject({ deny: true, reason: expect.stringMatching(SIGN_IN) })
    expect(oc('bash', { command: 'cat ~/.codex/auth.json' })).toMatchObject({ deny: true, reason: expect.stringMatching(SIGN_IN) })
    const codex = (command: string) => decideCodexAccess(rawEventFrom(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: project })), g)
    expect(codex('cat ~/.claude/.credentials.json')).toMatchObject({ deny: true, reason: expect.stringMatching(SIGN_IN) })
    expect(codex('cat ~/.codex/auth.json')).toMatchObject({ deny: true, reason: expect.stringMatching(SIGN_IN) })
  })
})

describe('what one decision reads of the filesystem', () => {
  it('is read again by the next decision: a link made between two calls is followed', () => {
    const home = path.join(tmp, 'home')
    mkdirSync(path.join(home, '.dethernety'), { recursive: true })
    writeFileSync(path.join(home, '.dethernety', 'tokens.json'), CANARY)
    const g = env({ env: { DETHEREAL_PROJECT_ROOT: project, HOME: home } })
    const read = event('Bash', { command: 'cat later/tokens.json' })
    expect(decide(read, g).deny).toBe(false)
    symlinkSync(path.join(home, '.dethernety'), path.join(project, 'later'))
    expect(reason(read, g)).toMatch(/server's own folder/)
    const codex = () => decideCodexAccess(rawEventFrom(read), g).deny
    rmSync(path.join(project, 'later'))
    expect(codex()).toBe(false)
    symlinkSync(path.join(home, '.dethernety'), path.join(project, 'later'))
    expect(codex()).toBe(true)
  })
})
