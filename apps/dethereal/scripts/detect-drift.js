#!/usr/bin/env node
// Dethereal drift detection — scoped file diff for /dethereal:threat-model.
// Reads <modelDir>/.dethereal/state.json for the baseline commit, emits the
// scoped file set on stdout as JSON. Refusals on stderr.
//
// Spec: oss/docs/architecture/dethereal/DRIFT_DETECTION.md §Detection.
// ESM — package.json declares "type": "module".

import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXIT_NOT_GIT = 2;
const EXIT_MISSING_BASELINE = 3;
const EXIT_ANCESTRY_BROKEN = 4;
const EXIT_GIT_FAILURE = 5;

function refuse(exitCode, error, message, extras) {
  const payload = { error, message, ...(extras || {}) };
  process.stderr.write(JSON.stringify(payload) + '\n');
  process.exit(exitCode);
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseModelDir(argv) {
  const idx = argv.indexOf('--model-dir');
  if (idx === -1 || idx + 1 >= argv.length) {
    process.stderr.write('usage: detect-drift.js --model-dir <path>\n');
    process.exit(1);
  }
  return resolve(argv[idx + 1]);
}

function main() {
  const modelDir = parseModelDir(process.argv.slice(2));
  if (!existsSync(modelDir)) {
    process.stderr.write(`model dir not found: ${modelDir}\n`);
    process.exit(1);
  }

  // Detect "not a git repo" — git rev-parse exits non-zero outside a worktree.
  try {
    git(modelDir, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    refuse(EXIT_NOT_GIT, 'not-a-git-repo',
      'drift detection requires a git repo',
      { hint: 'git init && git add . && git commit -m "initial"' });
  }

  // Read state.json; require lastReconcileCommit.
  const statePath = join(modelDir, '.dethereal', 'state.json');
  let state = {};
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    refuse(EXIT_MISSING_BASELINE, 'missing-baseline',
      'no drift baseline (state.json absent or unreadable)',
      { hint: 'run /dethereal:discover to set the baseline' });
  }
  const baseline = state.lastReconcileCommit;
  if (!baseline) {
    refuse(EXIT_MISSING_BASELINE, 'missing-baseline',
      'no drift baseline in state.json',
      { hint: 'run /dethereal:discover to set the baseline' });
  }

  // Verify baseline is in the current branch's ancestry.
  try {
    git(modelDir, ['merge-base', '--is-ancestor', baseline, 'HEAD']);
  } catch {
    refuse(EXIT_ANCESTRY_BROKEN, 'ancestry-broken',
      `baseline ${baseline} is not in this branch's ancestry (history rewrite or branch switch)`,
      { hint: 're-run /dethereal:discover to re-baseline' });
  }

  // Load source globs and build pathspec args (git :(glob) magic).
  //
  // `top` is load-bearing. Git resolves pathspecs relative to the process cwd,
  // and we run git from the model directory — so a bare `:(glob)k8s/**` looks
  // for manifests *inside the model directory*, matches nothing, and drift
  // silently reports zero changes for any model that does not happen to sit at
  // the repository root. `:(top,glob)` anchors the pattern at the repo root,
  // which is what the source globs are written against.
  const globsPath = join(__dirname, '..', 'src', 'utils', 'source-globs.v1.json');
  const globs = JSON.parse(readFileSync(globsPath, 'utf8')).globs;
  const pathspecs = globs.map((g) => `:(top,glob)${g}`);

  // Diff baseline..HEAD with rename/copy detection, then dirty tree, scoped by globs.
  // -z output keeps paths intact (NUL-delimited, no C-quoting) so embedded spaces,
  // unicode, or literal " -> " in filenames don't corrupt parsing.
  let diffOut = '';
  let statusOut = '';
  try {
    diffOut = git(modelDir,
      ['diff', '--name-only', '-z', '-M', '-C', `${baseline}..HEAD`, '--', ...pathspecs]);
    statusOut = git(modelDir,
      ['status', '--porcelain=v1', '-z', '--', ...pathspecs]);
  } catch (err) {
    refuse(EXIT_GIT_FAILURE, 'git-failure',
      'git command failed',
      { detail: String(err.stderr || '').trim().slice(0, 500), hint: 'check `git status` manually' });
  }

  const fromDiff = diffOut.split('\0').filter(Boolean);
  // porcelain v1 -z records: `XY <space> <path>\0`. For renames/copies (R*/C*),
  // the next \0-record is the source path which we skip — the new path is the one
  // present in the model going forward (rename identity-preservation is downstream).
  const fromStatus = [];
  const records = statusOut.split('\0');
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec) continue;
    const code = rec[0];
    fromStatus.push(rec.slice(3));
    if (code === 'R' || code === 'C') i++; // skip the paired source-path record
  }

  const scoped = Array.from(new Set([...fromDiff, ...fromStatus])).sort();
  process.stdout.write(JSON.stringify({ baseline, scoped }) + '\n');
}

main();
