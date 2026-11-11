/**
 * Drift scenarios: small git repositories in known states, each with the changed
 * file set drift detection must report. Every repository is created in a scratch
 * directory with a hermetic git environment (no user or system configuration, no
 * inherited GIT_* variables) and its own `.git`.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** git for building fixtures only: no user/system config, no inherited GIT_* variables. */
export const HERMETIC_GIT_ENV: NodeJS.ProcessEnv = (() => {
  const env: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_') && v !== undefined) env[k] = v
  return {
    ...env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  }
})()

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: dir, env: HERMETIC_GIT_ENV, encoding: 'utf8' }).trim()
}

export function write(dir: string, rel: string, content: string): void {
  const full = path.join(dir, rel)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, content)
}

export function commitAll(dir: string, message = 'c'): string {
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', message)
  return git(dir, 'rev-parse', 'HEAD')
}

export function setBaseline(modelDir: string, sha: string): void {
  write(modelDir, '.dethereal/state.json', JSON.stringify({ lastReconcileCommit: sha }))
}

export interface Scenario {
  name: string
  /** Builds the repository under `repo`; returns the model directory. */
  build: (repo: string) => string
  /** The changed file set, root-relative, sorted. */
  scoped: string[]
  /** The renames and copies git reports, as { from, to } (none when absent). */
  renamed?: Array<{ from: string; to: string }>
  copied?: Array<{ from: string; to: string }>
}

/** A file long enough that a small edit keeps it recognisably the same file. */
const BUCKETS = Array.from({ length: 12 }, (_, i) => `resource "aws_s3_bucket" "b${i}" {\n  bucket = "orders-${i}"\n}\n`).join('')

/** Initialise `repo`, commit `files`, and record the commit as the model's baseline. */
function baseline(repo: string, files: Record<string, string>, modelRel = '.'): { model: string; sha: string } {
  git(repo, 'init', '-q', '-b', 'main')
  for (const [rel, content] of Object.entries({ 'README.md': 'init', ...files })) write(repo, rel, content)
  const model = path.join(repo, modelRel)
  mkdirSync(model, { recursive: true })
  const sha = commitAll(repo)
  setBaseline(model, sha)
  return { model, sha }
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'clean at baseline',
    build: (repo) => baseline(repo, { 'infra/main.tf': 'v1' }).model,
    scoped: [],
  },
  {
    name: 'committed in-glob change',
    build: (repo) => {
      const { model } = baseline(repo, { 'infra/main.tf': 'v1' })
      write(repo, 'infra/main.tf', 'v2')
      commitAll(repo)
      return model
    },
    scoped: ['infra/main.tf'],
  },
  {
    name: 'committed out-of-glob change',
    build: (repo) => {
      const { model } = baseline(repo, {})
      write(repo, 'notes.md', 'prose')
      commitAll(repo)
      return model
    },
    scoped: [],
  },
  {
    name: 'committed rename',
    build: (repo) => {
      const { model } = baseline(repo, { 'infra/main.tf': 'resource "aws_s3_bucket" "x" {}' })
      git(repo, 'mv', 'infra/main.tf', 'infra/network.tf')
      commitAll(repo)
      return model
    },
    scoped: ['infra/main.tf', 'infra/network.tf'],
    renamed: [{ from: 'infra/main.tf', to: 'infra/network.tf' }],
  },
  {
    name: 'committed rename with a content change',
    build: (repo) => {
      const { model } = baseline(repo, { 'infra/main.tf': BUCKETS })
      git(repo, 'mv', 'infra/main.tf', 'infra/storage.tf')
      write(repo, 'infra/storage.tf', BUCKETS.replace('orders-0', 'orders-archive'))
      commitAll(repo)
      return model
    },
    scoped: ['infra/main.tf', 'infra/storage.tf'],
    renamed: [{ from: 'infra/main.tf', to: 'infra/storage.tf' }],
  },
  {
    name: 'committed copy',
    build: (repo) => {
      const { model } = baseline(repo, { 'infra/main.tf': BUCKETS })
      write(repo, 'infra/replica.tf', BUCKETS)
      write(repo, 'infra/main.tf', BUCKETS.replace('orders-0', 'orders-primary'))
      commitAll(repo)
      return model
    },
    scoped: ['infra/main.tf', 'infra/replica.tf'],
    copied: [{ from: 'infra/main.tf', to: 'infra/replica.tf' }],
  },
  {
    name: 'committed deletion',
    build: (repo) => {
      const { model } = baseline(repo, { 'infra/main.tf': 'v1', 'infra/other.tf': 'v1' })
      git(repo, 'rm', '-q', 'infra/other.tf')
      commitAll(repo)
      return model
    },
    scoped: ['infra/other.tf'],
  },
  {
    name: 'unstaged in-glob change',
    build: (repo) => {
      const { model } = baseline(repo, { 'infra/main.tf': 'v1' })
      write(repo, 'infra/main.tf', 'v2')
      return model
    },
    scoped: ['infra/main.tf'],
  },
  {
    name: 'unstaged deletion',
    build: (repo) => {
      const { model } = baseline(repo, { 'infra/main.tf': 'v1' })
      rmSync(path.join(repo, 'infra/main.tf'))
      return model
    },
    scoped: ['infra/main.tf'],
  },
  {
    name: 'staged new file',
    build: (repo) => {
      const { model } = baseline(repo, {})
      write(repo, 'docker-compose.yml', 'services: {}')
      git(repo, 'add', 'docker-compose.yml')
      return model
    },
    scoped: ['docker-compose.yml'],
  },
  {
    name: 'staged rename',
    build: (repo) => {
      const { model } = baseline(repo, { 'infra/main.tf': 'resource "aws_s3_bucket" "x" {}' })
      git(repo, 'mv', 'infra/main.tf', 'infra/network.tf')
      return model
    },
    scoped: ['infra/main.tf', 'infra/network.tf'],
    renamed: [{ from: 'infra/main.tf', to: 'infra/network.tf' }],
  },
  {
    name: 'untracked in-glob file',
    build: (repo) => {
      const { model } = baseline(repo, {})
      write(repo, 'k8s/app/deployment.yaml', 'kind: Deployment')
      return model
    },
    scoped: ['k8s/app/deployment.yaml'],
  },
  {
    name: 'ignored in-glob file',
    build: (repo) => {
      const { model } = baseline(repo, { '.gitignore': 'generated/\n' })
      write(repo, 'generated/main.tf', 'x')
      return model
    },
    scoped: [],
  },
  {
    name: 'committed and dirty change to the same file',
    build: (repo) => {
      const { model } = baseline(repo, { 'infra/main.tf': 'v1' })
      write(repo, 'infra/main.tf', 'v2')
      commitAll(repo)
      write(repo, 'infra/main.tf', 'v3')
      return model
    },
    scoped: ['infra/main.tf'],
  },
  {
    name: 'model in a subdirectory, change elsewhere in the repository',
    build: (repo) => {
      const { model } = baseline(repo, { 'services/api/k8s/deployment.yaml': 'v1', 'threat-models/api/README.md': 'm' }, 'threat-models/api')
      write(repo, 'services/api/k8s/deployment.yaml', 'v2')
      commitAll(repo)
      return model
    },
    scoped: ['services/api/k8s/deployment.yaml'],
  },
  {
    name: 'model in a subdirectory, untracked file elsewhere',
    build: (repo) => {
      const { model } = baseline(repo, { 'threat-models/api/README.md': 'm' }, 'threat-models/api')
      write(repo, 'services/web/Dockerfile', 'FROM x')
      return model
    },
    scoped: ['services/web/Dockerfile'],
  },
  {
    name: 'hyphenated manifest directory',
    build: (repo) => {
      const { model } = baseline(repo, { 'vendored/app/kubernetes-manifests/cartservice.yaml': 'v1' })
      write(repo, 'vendored/app/kubernetes-manifests/cartservice.yaml', 'v2')
      commitAll(repo)
      return model
    },
    scoped: ['vendored/app/kubernetes-manifests/cartservice.yaml'],
  },
  {
    name: 'spaces and non-ASCII characters in paths',
    build: (repo) => {
      const { model } = baseline(repo, { 'infra/my stack/main.tf': 'v1' })
      write(repo, 'infra/my stack/main.tf', 'v2')
      write(repo, 'infra/zürich/main.tf', 'new')
      return model
    },
    scoped: ['infra/my stack/main.tf', 'infra/zürich/main.tf'],
  },
]
