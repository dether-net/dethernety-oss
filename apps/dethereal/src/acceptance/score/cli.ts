/**
 * Score one acceptance run directory and print the report.
 *
 *   tsx src/acceptance/score/cli.ts <run-dir> --module <module data dir> [--module <another> …]
 *     [--rc-bundle-hash <hash>] [--rc-dist-hash <hash>] [--fixtures <dir>] [--registry <prompts.yaml>]
 *     [--price-table <prices.yaml>] [--out <report.json>]
 *
 * A key over several modules takes one --module per module, as its model's manifest lists them.
 * Prints a short summary; the full JSON report goes to --out (mode 0600), or
 * to stdout when --out is not given. Exit code: 0 for PASS, 1 for FAIL, 2 for
 * INVALID or a usage error.
 */
import fs from 'node:fs'
import { summarise } from './report.js'
import { scoreRun } from './score.js'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const runDir = args[0]
const modules = args.flatMap((a, i) => (a === '--module' && args[i + 1] ? [args[i + 1]!] : []))
if (!runDir || runDir.startsWith('--') || !modules.length) {
  console.error('usage: cli.ts <run-dir> --module <module data dir> [--rc-bundle-hash <h>] [--rc-dist-hash <h>] [--fixtures <dir>] [--registry <file>] [--out <file>]')
  process.exit(2)
}

try {
  const report = await scoreRun(runDir, {
    moduleDataDir: modules.length === 1 ? modules[0]! : modules,
    ...(flag('--fixtures') ? { fixturesDir: flag('--fixtures')! } : {}),
    ...(flag('--registry') ? { registryFile: flag('--registry')! } : {}),
    ...(flag('--rc-bundle-hash') ? { rcBundleHash: flag('--rc-bundle-hash')! } : {}),
    ...(flag('--rc-dist-hash') ? { rcDistHash: flag('--rc-dist-hash')! } : {}),
    ...(flag('--price-table') ? { priceTable: flag('--price-table')! } : {}),
  })
  const out = flag('--out')
  if (out) {
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log(summarise(report))
  } else console.log(JSON.stringify(report, null, 2))
  process.exit(report.verdict === 'PASS' ? 0 : report.verdict === 'FAIL' ? 1 : 2)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(2)
}
