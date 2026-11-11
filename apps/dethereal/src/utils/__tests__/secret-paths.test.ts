import { describe, it, expect } from 'vitest'
import {
  SECRET_EXCEPTIONS,
  SECRET_MANIFEST_PATTERN,
  SECRET_PATHS,
  SECRET_SUFFIXES,
  isSecretManifestLine,
  isSecretManifestText,
  isSecretPath,
  sanctionedCommandPaths,
  sanctionedSecretCommand,
  secretPathClass,
  secretSourceKind,
  secretSourceReferences,
} from '../secret-paths.js'
import { allJoined, crafted, seeded, timed } from '../../test-setup/crafted-input.js'

/** A file name an entry names: its `*` filled in. */
const example = (glob: string) => glob.replace(/\*/g, 'x')

describe('secret paths: names', () => {
  it.each(SECRET_SUFFIXES.map((g) => [g]))('%s matches at the root, nested and in any letter case', (g) => {
    const name = example(g)
    for (const rel of [name, `deep/er/${name}`, `deep/${name.toUpperCase()}`]) expect(isSecretPath(rel)).toBe(true)
  })

  it.each(SECRET_PATHS.map((g) => [g]))('%s matches at the root, nested and in any letter case', (g) => {
    const name = example(g)
    for (const rel of [name, `deep/er/${name}`, `Deep/${name.toUpperCase()}`]) expect(isSecretPath(rel)).toBe(true)
  })

  it.each(SECRET_EXCEPTIONS.map((g) => [g]))('%s is never secret', (g) => {
    expect(isSecretPath(example(g).replace(/^x/, ''))).toBe(false)
    expect(isSecretPath(`app/${example(g)}`)).toBe(false)
  })

  it('matches a suffix against the file name only, and a path entry within its segments', () => {
    expect(isSecretPath('src/app.env.ts')).toBe(false)
    expect(isSecretPath('pkg/kubeconfig/loader.go')).toBe(false)
    expect(isSecretPath('notes/secrets.yaml.md')).toBe(false)
    expect(isSecretPath('.aws/credentials.bak')).toBe(false)
    expect(isSecretPath('x/.aws/credentials')).toBe(true)
    expect(isSecretPath('aws/credentials')).toBe(false)
  })

  it('names the class', () => {
    expect(secretPathClass('deploy/orders/secrets.yaml')).toBe('secret-values')
    expect(secretPathClass('.env.local')).toBe('env')
    expect(secretPathClass('infra/prod.tfvars')).toBe('terraform')
    expect(secretPathClass('tls/server.pem')).toBe('key-or-certificate')
    expect(secretPathClass('ssh/id_ed25519')).toBe('ssh-key')
    expect(secretPathClass('.kube/config')).toBe('kubeconfig')
    expect(secretPathClass('.pgpass')).toBe('database-credentials')
    expect(secretPathClass('.npmrc')).toBe('package-credentials')
    expect(secretPathClass('gcp/application_default_credentials.json')).toBe('cloud-credentials')
    expect(secretPathClass('README.md')).toBeNull()
  })

  it.each([[''], ['/etc/passwd'], ['C:/x/.env'], ['../.env'], ['a/../b'], ['a\nb']])('cannot place %j: unclassifiable, so secret', (rel) => {
    expect(secretPathClass(rel)).toBe('unclassifiable')
    expect(isSecretPath(rel)).toBe(true)
  })

  it('takes backslashes and a leading ./ as the same path', () => {
    expect(secretPathClass('.\\deploy\\secrets.yml')).toBe('secret-values')
    expect(secretPathClass('./.env')).toBe('env')
  })
})

describe('secret paths: Secret manifests by their content', () => {
  it.each([
    ['kind: Secret'],
    ['  kind: "Secret"  # the db password'],
    ['- kind: Secret'],
    ['{"kind": "Secret",'],
    ['KIND: secret'],
  ])('%j is a Secret line', (line) => expect(isSecretManifestText(`apiVersion: v1\n${line}\n`)).toBe(true))

  it.each([['kind: ConfigMap'], ['kind: SealedSecret'], ['# kind: Secret'], ['secretKind: Secret']])('%j is not', (line) => expect(isSecretManifestText(line)).toBe(false))

  it('finds the Secret in any document of a multi-document file', () => {
    expect(isSecretManifestText('kind: Deployment\n---\nkind: Service\n---\r\nkind: Secret\r\n')).toBe(true)
  })
})

describe('secret paths: the workflow name-only commands', () => {
  const manifest = `grep -rliE '${SECRET_MANIFEST_PATTERN}' -- 'deploy'`
  const tracked = "git ls-files --format='%(objectmode) %(path)' -- 'deploy/orders/secrets.yaml'"
  const name = "grep -lwF -d skip -- 'name: orders-db-credentials' 'deploy/orders/secrets.yaml' 'deploy/edge/secrets.yaml'"

  it('recognises the three forms exactly as the rule spells them', () => {
    expect(sanctionedSecretCommand(manifest)).toBe('secret-manifest-search')
    expect(sanctionedSecretCommand(tracked)).toBe('git-tracked')
    expect(sanctionedSecretCommand(name)).toBe('secret-name-search')
    expect(sanctionedCommandPaths(name)).toEqual(['deploy/orders/secrets.yaml', 'deploy/edge/secrets.yaml'])
    expect(sanctionedCommandPaths(tracked)).toEqual(['deploy/orders/secrets.yaml'])
  })

  it('accepts them as agents write them: bare safe paths, repeated spaces, continued lines, echo before, several git paths', () => {
    expect(sanctionedSecretCommand(manifest.replace(' -- ', '  -- '))).toBe('secret-manifest-search')
    expect(sanctionedSecretCommand(`grep -rliE '${SECRET_MANIFEST_PATTERN}' -- deploy`)).toBe('secret-manifest-search')
    expect(sanctionedSecretCommand("grep -lwF -d skip -- 'name: orders-db-credentials' deploy/orders/secrets.yaml deploy/orders/db-connection.yaml")).toBe('secret-name-search')
    expect(sanctionedCommandPaths("grep -lwF -d skip -- 'name: x' deploy/a.yaml 'deploy/b.yaml'")).toEqual(['deploy/a.yaml', 'deploy/b.yaml'])
    const continued = "\\\necho \"--- modes ---\" && \\\ngit ls-files --format='%(objectmode) %(path)' -- deploy/orders/db-connection.yaml deploy/orders/secrets.yaml\n"
    expect(sanctionedSecretCommand(continued)).toBe('git-tracked')
    expect(sanctionedCommandPaths(continued)).toEqual(['deploy/orders/db-connection.yaml', 'deploy/orders/secrets.yaml'])
  })

  it.each([
    ['a bare path that climbs', "grep -lwF -d skip -- 'name: x' deploy/../.env"],
    ['a bare path with a glob', "grep -lwF -d skip -- 'name: x' deploy/*.yaml"],
    ['a bare path with a variable', "git ls-files --format='%(objectmode) %(path)' -- $F"],
    ['a bare path starting with -', "git ls-files --format='%(objectmode) %(path)' -- -x"],
    ['a double-quoted name', 'grep -lwF -d skip -- "name: x" deploy/a.yaml'],
    ['a manifest search over two folders', `grep -rliE '${SECRET_MANIFEST_PATTERN}' -- deploy infra`],
    ['an echo with a substitution before it', `echo $(cat .env) && ${tracked}`],
    ['a pipe after it', `${tracked} | cat`],
    ['two names, the second where a file goes', "grep -lwF -d skip -- 'name: a' 'name: b' 'x'"],
  ])('refuses %s', (_, command) => expect(sanctionedSecretCommand(command)).toBeNull())

  it.each([
    ['another command after it', `${manifest}; cat 'deploy/orders/secrets.yaml'`],
    ['a newline after it', `${manifest}\ncat x`],
    ['-R for -r', manifest.replace('-rliE', '-RliE')],
    ['git ls-files -s', "git ls-files -s -- 'x'"],
    ['-l dropped', name.replace('-lwF', '-wF')],
    ['-n added', name.replace('-lwF', '-lnwF')],
    ['two names', "grep -lwF -d skip -- 'name: a' 'name: b' 'x'".replace("'name: b' ", '-e name: b ')],
    ['a name that is not a Kubernetes name', "grep -lwF -d skip -- 'name: Bad_Name' 'x'"],
    ['a double-quoted path', "git ls-files --format='%(objectmode) %(path)' -- \"x\""],
    ['a quote in the path', "git ls-files --format='%(objectmode) %(path)' -- 'a'\\''b'"],
  ])('refuses %s', (_, command) => expect(sanctionedSecretCommand(command)).toBeNull())
})

describe('secret paths: the secret sources a configuration file names', () => {
  it('knows kustomization and compose files by their name', () => {
    expect(secretSourceKind('kustomization.yaml')).toBe('kustomize')
    expect(secretSourceKind('Kustomization')).toBe('kustomize')
    expect(secretSourceKind('docker-compose.override.yml')).toBe('compose')
    expect(secretSourceKind('compose.yaml')).toBe('compose')
    expect(secretSourceKind('values.yaml')).toBeNull()
  })

  it('reads kustomize secretGenerator envs and files, as block or flow lists, key=path included', () => {
    const text = [
      'resources:',
      '  - deployment.yaml',
      'secretGenerator:',
      '- name: orders-db',
      '  envs:',
      '  - extra-settings.properties   # the db url',
      "  - 'second.env'",
      '  files:',
      '  - tls.crt=certs/server.crt',
      '  - config/raw.txt',
      '- name: other',
      '  envs: [a.env, "b.properties"]',
      '  files: [key=c.txt]',
      '- name: legacy',
      '  env: legacy.properties',
      'configMapGenerator:',
      '- name: not-secret',
      '  envs:',
      '  - plain.properties',
    ].join('\n')
    expect(secretSourceReferences('kustomize', text)).toEqual(['extra-settings.properties', 'second.env', 'certs/server.crt', 'config/raw.txt', 'a.env', 'b.properties', 'c.txt', 'legacy.properties'])
  })

  it('reads compose env_file as a string, a list and the long form, and the top-level secrets files', () => {
    const text = [
      'services:',
      '  api:',
      '    env_file: api.env',
      '    secrets:',
      '      - db_password',
      '  worker:',
      '    env_file:',
      '      - worker.conf',
      '      - path: ./optional.conf',
      '        required: false',
      '  web:',
      '    env_file: [web-a.conf, web-b.conf]',
      'secrets:',
      '  db_password:',
      '    file: ./secrets/db_password.txt',
      '  api_key:',
      '    environment: API_KEY',
    ].join('\n')
    expect(secretSourceReferences('compose', text)).toEqual(['api.env', 'worker.conf', './optional.conf', 'web-a.conf', 'web-b.conf', './secrets/db_password.txt'])
  })

  it('names nothing for a form it does not recognise', () => {
    expect(secretSourceReferences('kustomize', 'secretGenerator: !!map {}\n')).toEqual([])
    expect(secretSourceReferences('compose', 'services: {api: {env_file: x.env}}\n')).toEqual([])
  })
})

describe('the secret checks on long crafted input', () => {
  it('reads a `kind: Secret` line as the reference expression does', () => {
    const reference = (line: string) => /^\s*[-{]?\s*"?kind"?\s*:\s*.?secret.?\s*,?\s*(#.*)?$/i.test(line.replace(/\r$/, ''))
    // The Kelvin sign and the long s fold to `k` and `s` only under the u flag, which the expression does not take.
    const pieces = ['kind', 'KIND', 'Kind', 'kin', 'secret', 'Secret', 'SECRET', 'ecret', ':', ' ', '  ', '\t', '"', '-', '{', ',', '#', 'x', 's', 'k',
      '\r', '\u2028', '\u00a0', '\u212a', '\u017f', '}', "'", 'Opaque']
    const random = seeded(5)
    const lines = ['kind: Secret', '  kind: Secret  # x', '- kind: secret,', '{"kind": "Secret",', 'kind:Secret', 'kind: xSecretx', 'kind :  Secret,  #',
      'kind: Secrets', 'kind: SecretList', 'kind: ConfigMap', ' "kind" : "Secret" ', 'kind: Secret\r', 'kind: Secret #a\u2028b', 'kind: \u212aecret', 'kind: Secret # note\r', 'kind: Secret # a\rb']
    for (let r = 0; r < 60_000; r++) {
      let line = ''
      for (let k = 1 + (r % 10); k > 0; k--) line += random.pick(pieces)
      lines.push(line)
    }
    // And lines built along the expression, each part right, missing or wrong, so that many match.
    const blank = ['', ' ', '  ', '\t', '\u00a0', '\r', '\u2028', 'x']
    const parts = [blank, ['', '-', '{', '}'], blank, ['', '"', "'"], ['kind', 'KIND', 'kinD', '\u212aind', 'kin'], ['', '"'], blank, [':', '', ';'], blank,
      ['', 'x', ' ', '"', '\n', '\u2028'], ['secret', 'Secret', 'SECRET', '\u017fecret', 'secre'], ['', 'x', '"', '\r', '\u2028'], blank, ['', ',', ',,'], blank,
      ['', '#', '# note', '#\u2028', 'x']]
    for (let r = 0; r < 60_000; r++) lines.push(parts.map((p) => random.pick(p)).join(''))
    expect(lines.filter((l) => isSecretManifestLine(l) !== reference(l))).toEqual([])
    expect(lines.filter((l) => reference(l)).length).toBeGreaterThan(500)
  })

  it('classifies a path as the reference glob expressions do, the same glob winning', () => {
    const segmentGlob = (glob: string) => glob.split('').map((c) => (c === '*' ? '[^/]*' : c === '?' ? '[^/]' : /[\\^$.|+()[\]{}]/.test(c) ? `\\${c}` : c)).join('')
    const exceptions = SECRET_EXCEPTIONS.map((g) => new RegExp(`^${segmentGlob(g)}$`))
    const suffix = SECRET_SUFFIXES.map((g) => [g, new RegExp(`^${segmentGlob(g)}$`)] as const)
    const paths = SECRET_PATHS.map((g) => [g, new RegExp(`(^|/)${segmentGlob(g)}$`)] as const)
    // Which glob matches first, or null: the class follows from it.
    const reference = (rel: string) => {
      const base = rel.slice(rel.lastIndexOf('/') + 1)
      if (exceptions.some((re) => re.test(base))) return null
      return suffix.find(([, re]) => re.test(base))?.[0] ?? paths.find(([, re]) => re.test(rel))?.[0] ?? null
    }
    const pieces = ['values', 'secret', 'secrets', '.yaml', '.yml', 'service-account', '.json', '-sa-key', 'id_rsa', '.pub', 'kubeconfig', '.kube', 'config',
      '.aws', 'credentials', '.env', '.example', '.tfstate', '.docker', '.pem', 'a', '-', '.', '/', '//', 'x']
    const random = seeded(11)
    let named = 0
    for (let r = 0; r < 50_000; r++) {
      let rel = ''
      for (let k = 1 + (r % 7); k > 0; k--) rel += random.pick(pieces)
      // As the classifier reads it: no leading `./`, no trailing slashes.
      while (rel.startsWith('./')) rel = rel.slice(2)
      while (rel.endsWith('/')) rel = rel.slice(0, -1)
      if (!rel || rel.startsWith('/') || rel.split('/').includes('..')) continue
      const glob = reference(rel)
      if (glob) named++
      expect([rel, secretPathClass(rel) !== null]).toEqual([rel, glob !== null])
      if (glob) expect([rel, secretPathClass(rel)]).toEqual([rel, secretPathClass(glob.replace(/\*/g, 'q'))])
    }
    expect(named).toBeGreaterThan(1_000)
  })

  it('splits a sanctioned command into steps as the reference expression does', () => {
    const reference = (text: string) => text.split(/\s*(?:&&|;)\s*/)
    const now = (text: string) => text.split(/&&|;/).map((s) => s.trim())
    const differs = [...allJoined(['&', ';', ' ', '\t', 'a', '\u00a0'], 8)].map((s) => s.trim()).filter((s) => JSON.stringify(reference(s)) !== JSON.stringify(now(s)))
    expect(differs).toEqual([])
  })

  it('reads 100 KB of crafted input in time', () => {
    const KB100 = 100 * 1024
    for (const line of [crafted(KB100, ' ', '', 'x'), crafted(KB100, ' ', 'kind: secret', 'x'), crafted(KB100, ' ', 'kind:', 'x'), crafted(KB100, ' ', '- ', 'x'),
      crafted(KB100, ' ', 'kind: secret ,', 'x'), crafted(KB100, 'a', 'kind: secret #', '\u2028'), crafted(KB100, '"', 'kind', 'x')]) {
      expect([line.slice(0, 16), isSecretManifestLine(line), timed(() => isSecretManifestLine(line)) < 50]).toEqual([line.slice(0, 16), false, true])
    }
    for (const file of [crafted(KB100, 'secret', 'values', 'x'), crafted(KB100, 'service-account', '', 'x'), crafted(KB100, 'a/', '', 'x'),
      crafted(KB100, 'id_rsa', '', 'x'), crafted(KB100, '.yaml', 'kubeconfig', 'x')]) {
      expect([file.slice(0, 16), timed(() => secretPathClass(file)) < 250]).toEqual([file.slice(0, 16), true])
    }
    expect(timed(() => sanctionedSecretCommand(crafted(KB100, ' ', 'git status', 'x')))).toBeLessThan(250)
  })
})
