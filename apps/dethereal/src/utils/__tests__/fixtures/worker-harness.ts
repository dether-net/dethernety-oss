/** Builds lock-worker.ts into a runnable bundle and runs it as child processes. */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsup'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

/** Removes a bundle made by `buildWorker`. */
export async function removeWorker(worker: string | undefined): Promise<void> {
  if (worker) await rm(path.dirname(worker), { recursive: true, force: true })
}

export async function buildWorker(): Promise<string> {
  const cacheDir = path.join(pkgRoot, 'node_modules', '.cache')
  await mkdir(cacheDir, { recursive: true })
  // Unique per run: parallel sessions share this checkout.
  const outDir = await mkdtemp(path.join(cacheDir, 'dethereal-lock-worker-'))
  await build({
    config: false,
    entry: { worker: path.join(pkgRoot, 'src', 'utils', '__tests__', 'fixtures', 'lock-worker.ts') },
    format: ['esm'],
    target: 'node20',
    outDir,
    bundle: true,
    noExternal: ['@dethernety/dt-core'],
    dts: false,
    sourcemap: false,
    clean: false,
    silent: true,
  })
  return path.join(outDir, 'worker.js')
}

export function runWorker(worker: string, args: string[], cwd?: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [worker, ...args], { cwd, timeout: 120_000 }, (err, _stdout, stderr) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, stderr: String(stderr) })
    })
  })
}

/** Starts a worker that holds a lock; resolves once it reports "held". */
export function holdLock(worker: string, lockPath: string, ms: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker, 'hold', lockPath, String(ms)], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('held')) resolve(child)
    })
    child.on('exit', (code) => reject(new Error(`holder exited early (${code})`)))
  })
}

/** A pid that belonged to a process which has exited. */
export async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
  await new Promise((resolve) => child.on('exit', resolve))
  return child.pid!
}
