/**
 * Child-process worker for the file-lock and state-store tests (bundled by the
 * tests before use). Commands:
 *   stress <lockPath> <logPath> <iterations>   enter/exit markers under the lock
 *   hold <lockPath> <ms>                       hold the lock, print "held", then release
 *   state-add <modelDir> <baseDir> <prefix> <n> add n ids to staleElements, one update each
 *   model-state <logPath> <json-input>...      run model_state calls in order, one JSON result line each
 */
import { appendFileSync } from 'node:fs'
import { withFileLock } from '../../file-lock.js'
import { updateState } from '../../state-store.js'
import { modelStateTool } from '../../../tools/model-state.tool.js'

const [cmd, ...args] = process.argv.slice(2)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function main(): Promise<void> {
  switch (cmd) {
    case 'stress': {
      const [lockPath, logPath, iterations] = args as [string, string, string]
      for (let i = 0; i < Number(iterations); i++) {
        await withFileLock(
          lockPath,
          async (handle) => {
            appendFileSync(logPath, `enter ${handle.nonce}\n`)
            await sleep(Math.floor(Math.random() * 3))
            await handle.assertHeld()
            appendFileSync(logPath, `exit ${handle.nonce}\n`)
          },
          { waitMs: 60_000 },
        )
      }
      return
    }
    case 'hold': {
      const [lockPath, ms] = args as [string, string]
      await withFileLock(lockPath, async () => {
        process.stdout.write('held\n')
        await sleep(Number(ms))
      })
      return
    }
    case 'state-add': {
      const [modelDir, baseDir, prefix, n] = args as [string, string, string, string]
      for (let i = 0; i < Number(n); i++) {
        await updateState(
          modelDir,
          (state) => ({ ...state, staleElements: [...(state.staleElements ?? []), `${prefix}-${i}`] }),
          { baseDir, lock: { waitMs: 60_000 } },
        )
      }
      return
    }
    case 'model-state': {
      const [logPath, ...inputs] = args as [string, ...string[]]
      for (const raw of inputs) {
        const input = JSON.parse(raw) as Record<string, unknown>
        const result = await modelStateTool.run(input, { debug: false })
        appendFileSync(logPath, JSON.stringify({ input, result }) + '\n')
      }
      return
    }
    default:
      throw new Error(`unknown command ${cmd}`)
  }
}

main().then(
  () => process.exit(0),
  (err: Error) => {
    process.stderr.write(`${err.name}: ${err.message}\n`)
    process.exit(1)
  },
)
