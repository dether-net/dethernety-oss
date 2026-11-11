/**
 * `hook post-write`: after a harness writes files, say which registered threat
 * models they belong to, so the model validates them.
 *
 * The harness event arrives on stdin:
 * - Claude Code (PostToolUse, Write|Edit): `tool_input.file_path`;
 * - Codex (PostToolUse, apply_patch — also matched as Edit|Write): the patch text
 *   in `tool_input.command`, whose `*** Add File:`, `*** Update File:`,
 *   `*** Delete File:` and `*** Move to:` headers name the files; relative paths
 *   resolve against the event's `cwd`;
 * - OpenCode (plugin `tool.execute.after`): the plugin sends
 *   `{ tool, args, metadata?, directory }` — `args.filePath`, and for apply_patch
 *   `metadata.files[].filePath` / `movePath` or the patch text in `args.patchText`.
 *
 * Nothing from the event reaches the model except through the output frame:
 * model names cut to `[\w .-]{0,64}` and counts. No output at all when no model
 * file changed.
 */

import path from 'node:path'

export type PostWriteHarness = 'claude' | 'codex' | 'opencode'

export interface ChangedFiles {
  /** Paths as the event names them (absolute, or relative to `cwd`) */
  paths: string[]
  /** The directory relative paths resolve against, when the event gives one */
  cwd?: string
}

/** The most paths one event may name; the rest are ignored. */
export const MAX_EVENT_PATHS = 200
const MAX_PATH_LENGTH = 4096
const MAX_PATCH_LENGTH = 8 * 1024 * 1024

const PATCH_HEADER = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/

function isPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH_LENGTH && !value.includes('\0')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

/** The file paths an apply_patch text touches, from its file headers. */
export function patchPaths(patch: unknown): string[] {
  if (typeof patch !== 'string' || patch.length > MAX_PATCH_LENGTH) return []
  const out: string[] = []
  for (const line of patch.split('\n')) {
    const match = PATCH_HEADER.exec(line.replace(/\r$/, ''))
    if (match && isPath(match[1]!.trim())) out.push(match[1]!.trim())
  }
  return out
}

/** The files a harness event says were written. Unknown shapes name none. */
export function changedFiles(event: unknown): ChangedFiles {
  const e = record(event)
  if (!e) return { paths: [] }
  const paths: string[] = []

  const toolInput = record(e.tool_input)
  if (typeof e.tool_name === 'string' && toolInput) {
    // Claude Code and Codex hook events.
    if (e.tool_name === 'apply_patch') paths.push(...patchPaths(toolInput.command))
    for (const key of ['file_path', 'notebook_path']) if (isPath(toolInput[key])) paths.push(toolInput[key] as string)
  } else if (typeof e.tool === 'string') {
    // The OpenCode plugin's event.
    const args = record(e.args)
    if (args && isPath(args.filePath)) paths.push(args.filePath)
    if (args) paths.push(...patchPaths(args.patchText))
    const files = record(e.metadata)?.files
    if (Array.isArray(files)) {
      for (const file of files) {
        const f = record(file)
        for (const key of ['filePath', 'movePath']) if (f && isPath(f[key])) paths.push(f[key] as string)
      }
    }
  }

  const cwd = [e.cwd, e.directory].find((d): d is string => isPath(d) && path.isAbsolute(d))
  return { paths: [...new Set(paths)].slice(0, MAX_EVENT_PATHS), ...(cwd ? { cwd } : {}) }
}

/** The validation tool's name as the model sees it in each harness. */
export function validateToolName(harness?: PostWriteHarness): string {
  switch (harness) {
    case 'claude':
      return 'mcp__plugin_dethereal_dethereal__validate_model_json'
    case 'codex':
      return 'mcp__dethereal__validate_model_json'
    case 'opencode':
      return 'dethereal_validate_model_json'
    default:
      return 'validate_model_json'
  }
}

/** The most models one hint names; the rest are counted. */
export const MAX_HINT_MODELS = 5
/** The most registry entries considered. */
const MAX_REGISTRY_MODELS = 200

/**
 * The hook's stdout for one harness event, or null when no registered model
 * changed. Never throws.
 */
export async function postWrite(event: unknown, harness?: PostWriteHarness): Promise<string | null> {
  try {
    const { paths, cwd } = changedFiles(event)
    if (paths.length === 0) return null

    const { initProjectRoot, within } = await import('../utils/project-root.js')
    const resolved = initProjectRoot()
    if (resolved.root === null) return null
    const root = resolved.root

    // Most projects register no model: say nothing before loading the store.
    const registry = await import('../utils/model-registry.js')
    if (!(await registry.registryPresent(root))) return null
    const read = await registry.readRegistry(root)
    if (read.registry !== 'present' || read.entries.length === 0) return null

    const models: { name: string; dir: string }[] = []
    for (const entry of read.entries.slice(0, MAX_REGISTRY_MODELS)) {
      const registered = registry.entryPath(entry)
      if (!registered) continue
      try {
        const dir = await registry.resolveModelDir(root, registered)
        const name = (entry as Record<string, unknown>).name
        models.push({ name: typeof name === 'string' ? name : 'Unnamed', dir })
      } catch {
        // Outside the project: never matched.
      }
    }
    if (models.length === 0) return null

    const { realOrResolved } = await import('../utils/path-confinement.js')
    const base = cwd ?? root
    // A path that cannot be resolved (a dangling link, a loop) belongs to no model.
    const files = (await Promise.all(paths.map((p) => realOrResolved(path.resolve(base, p)).catch(() => null)))).filter(
      (f): f is string => f !== null
    )
    const changed = models
      .map((m) => ({ name: m.name, count: files.filter((f) => within(f, m.dir)).length }))
      .filter((m) => m.count > 0)
    if (changed.length === 0) return null

    const { safeName } = await import('./text.js')
    const tool = validateToolName(harness)
    const lines = changed
      .slice(0, MAX_HINT_MODELS)
      .map((m) => `Dethereal: model "${safeName(m.name)}" changed (${m.count} file${m.count === 1 ? '' : 's'}). Validate it with ${tool} once this step's writes are done.`)
    if (changed.length > MAX_HINT_MODELS) lines.push(`Dethereal: ... and ${changed.length - MAX_HINT_MODELS} more models changed.`)
    // OpenCode's plugin appends the hint to the tool's output itself: the bare text.
    if (harness === 'opencode') return lines.join('\n')
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: lines.join('\n') } })
  } catch {
    return null
  }
}
