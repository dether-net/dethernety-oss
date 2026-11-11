/** Types for `runtime-check.mjs`: the installed runtime, checked the way every consumer must before running it. */

export declare const STATE_DIR_NAME: string
export declare const SEMVER: RegExp
export declare const NODE_FLOOR: string

export interface RuntimeRecord {
  schemaVersion: 2
  version: string
  runtimePath: string
  setSha256: string
  execPath: string
  nodeVersion: string
  installedAt: string
  previous: string | null
}

export interface RuntimeFileEntry {
  rel: string
  sha256: string
  exec: boolean
}

export type RuntimeCheckCode =
  | 'io'
  | 'symlink'
  | 'not_a_directory'
  | 'not_owned'
  | 'group_or_world_writable'
  | 'runtime_invalid'
  | 'runtime_tampered'

export type RuntimeCheckResult =
  | { ok: true; current: RuntimeRecord; node: string; nodeFallback: boolean }
  | { ok: false; kind: 'tampered' | 'unverifiable'; code: RuntimeCheckCode; what: string }

export declare function nodeAtLeast(version: string, floor?: string): boolean
export declare function checkExecPath(execPath: string, euid: number): string
export declare function readRuntimeSet(dir: string, euid: number): RuntimeFileEntry[]
export declare function setSha256(files: readonly RuntimeFileEntry[]): string
export declare function checkRuntime(input: { realHome: string; euid: number; fallbackExecPath?: string; fallbackNodeVersion?: string }): RuntimeCheckResult
export declare function currentUser(): { realHome: string; euid: number }
