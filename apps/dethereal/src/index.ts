#!/usr/bin/env node
/**
 * Dethereal entry point.
 *
 * Without arguments this is the MCP server (stdio). With arguments it is the CLI
 * that harness hooks and scripts run. Each side is loaded only when used: a hook
 * runs on every file write and must not pay for loading the server.
 */

// Bundled into the entry, and safe on an old Node: the check runs before anything else loads.
import { floorStop } from './node-floor.js'

/** The oldest Node this build supports; the installer and `engines` say the same. */
const NODE_FLOOR = [20, 11, 1]

const args = process.argv.slice(2)
// On an old Node every command stops; a guard hook stops so that the tool call is blocked.
const stop = floorStop(process.versions.node, NODE_FLOOR, args)
if (stop) {
  process.stderr.write(`${stop.message}\n`)
  process.exitCode = stop.code
} else if (args.length > 0) {
  const { runCli } = await import('./cli/index.js')
  // exitCode, not exit(): stdout to a pipe is written asynchronously.
  process.exitCode = await runCli(args)
} else {
  await import('./server.js')
}
