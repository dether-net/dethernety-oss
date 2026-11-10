import { describe, it, expect } from 'vitest'
import {
  SECRET_EXCEPTIONS,
  SECRET_MANIFEST_PATTERN,
  SECRET_PATHS,
  SECRET_SUFFIXES,
  isSecretManifestText,
  isSecretPath,
  sanctionedCommandPaths,
  sanctionedSecretCommand,
  secretPathClass,
  secretSourceKind,
  secretSourceReferences,
} from '../secret-paths.js'

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
