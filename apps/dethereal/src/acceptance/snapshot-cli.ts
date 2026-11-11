/**
 * Snapshot and restore acceptance runs.
 *
 *   tsx src/acceptance/snapshot-cli.ts snapshot <run-dir> <label> --store <dir> --run-id <id>
 *       --bundle-json <bundle.json> --dist <dist dir> [--platform-model <id>] [--export-hash <hex>] [--home <dir>]...
 *       [--run-mode <full|quick|baseline>] [--sheet-mode <bar|loopback>] [--baseline-version <x.y.z>] [--settlement <on|off>]
 *   (the run's modes, as its run record will name them: a run resumed from the snapshot keeps them)
 *   tsx src/acceptance/snapshot-cli.ts restore <snapshot dir> <new run-dir> --run-id <id> [--live-export-hash <hex>]
 */
import fs from 'node:fs'
import { restoreSnapshot, SnapshotRefusal, takeSnapshot, treeHash } from './snapshot.js'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const flags = (name: string) => args.flatMap((a, i) => (a === name && args[i + 1] ? [args[i + 1]!] : []))
const need = (name: string) => {
  const v = flag(name)
  if (!v) {
    console.error(`missing ${name}`)
    process.exit(2)
  }
  return v
}

try {
  const [command, a, b] = args
  if (command === 'snapshot' && a && b) {
    const bundle = JSON.parse(fs.readFileSync(need('--bundle-json'), 'utf8')) as { contentHash?: unknown }
    if (typeof bundle.contentHash !== 'string') throw new SnapshotRefusal('bad_bundle', 'bundle.json has no contentHash')
    const dir = takeSnapshot(a, b, {
      store: need('--store'),
      runId: need('--run-id'),
      bundleHash: bundle.contentHash,
      distHash: treeHash(need('--dist')),
      platformModelId: flag('--platform-model') ?? null,
      exportHash: flag('--export-hash') ?? null,
      homes: flags('--home'),
      runModes: {
        ...(flag('--run-mode') ? { run_mode: flag('--run-mode') } : {}),
        ...(flag('--sheet-mode') ? { sheet_mode: flag('--sheet-mode') } : {}),
        ...(flag('--baseline-version') ? { baseline_version: flag('--baseline-version') } : {}),
        ...(flag('--settlement') ? { settlement: flag('--settlement') } : {}),
      },
    })
    console.log(JSON.stringify({ snapshot: dir }))
  } else if (command === 'restore' && a && b) {
    const r = restoreSnapshot(a, b, { newRunId: need('--run-id'), liveExportHash: flag('--live-export-hash') })
    for (const w of r.warnings) console.error(`warning: ${w}`)
    console.log(JSON.stringify(r.record))
  } else {
    console.error('usage: snapshot-cli.ts snapshot <run-dir> <label> … | restore <snapshot> <new run-dir> …')
    process.exit(2)
  }
} catch (err) {
  if (err instanceof SnapshotRefusal) {
    console.error(`refused (${err.code}): ${err.message}`)
    process.exit(1)
  }
  throw err
}
