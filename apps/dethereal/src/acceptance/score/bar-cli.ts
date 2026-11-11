/**
 * The quick-mode bar over a campaign of runs.
 *
 *   tsx src/acceptance/score/bar-cli.ts --campaign <campaign.json> --module <module data dir> [--module <another> …]
 *     --price-table <prices.yaml> [--fixtures <dir>] [--registry <prompts.yaml>] [--out <bar.json>]
 *
 * Prints the verdict and its reasons; the full JSON report goes to --out (mode 0600), or to stdout when --out is
 * not given. Exit code: 0 for PASS, 1 for FAIL, 2 for incomplete, INVALID or a usage error.
 */
import fs from 'node:fs'
import { scoreCampaign } from './bar.js'

const args = process.argv.slice(2)
const flag = (name: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const modules = args.flatMap((a, i) => (a === '--module' && args[i + 1] ? [args[i + 1]!] : []))
const campaign = flag('--campaign')
const prices = flag('--price-table')
if (!campaign || !prices || !modules.length) {
  console.error('usage: bar-cli.ts --campaign <campaign.json> --module <module data dir> --price-table <prices.yaml> [--fixtures <dir>] [--registry <file>] [--out <file>]')
  process.exit(2)
}

try {
  const bar = await scoreCampaign(campaign, {
    moduleDataDir: modules.length === 1 ? modules[0]! : modules,
    priceTable: prices,
    ...(flag('--fixtures') ? { fixturesDir: flag('--fixtures')! } : {}),
    ...(flag('--registry') ? { registryFile: flag('--registry')! } : {}),
  })
  const out = flag('--out')
  if (out) fs.writeFileSync(out, `${JSON.stringify(bar, null, 2)}\n`, { mode: 0o600 })
  else console.log(JSON.stringify(bar, null, 2))
  console.error(`bar: ${bar.verdict}${bar.reasons.length ? `\n  ${bar.reasons.join('\n  ')}` : ''}`)
  process.exit(bar.verdict === 'PASS' ? 0 : bar.verdict === 'FAIL' ? 1 : 2)
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(2)
}
