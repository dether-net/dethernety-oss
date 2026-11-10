/**
 * Installer errors carry a code and a label relative to a known root, never an
 * absolute path, parser text or file bytes: config files can hold secrets, and
 * parsers quote the source in their messages.
 */
export type InstallerErrorCode =
  | 'unsupported_platform'
  | 'running_as_root'
  | 'not_owned'
  | 'group_or_world_writable'
  | 'symlink'
  | 'not_regular'
  | 'not_a_directory'
  | 'hardlinked'
  | 'too_large'
  | 'changed'
  | 'outside_allowed'
  | 'not_writable'
  | 'io'
  | 'manifest_invalid'
  | 'manifest_path_refused'
  | 'backup_invalid'
  | 'backup_mismatch'
  | 'backup_referenced'
  | 'runtime_not_self_contained'
  | 'runtime_tampered'
  | 'runtime_invalid'
  | 'node_unsupported'
  | 'conflict'
  | 'conflict_scalar_parent'
  | 'guard_failed'
  | 'parse_error'
  | 'argument_refused'
  | 'harness_cli_missing'
  | 'harness_cli_failed'
  | 'harness_cli_refused'
  | 'harness_version'

export class InstallerError extends Error {
  /** `detail`: what the failing program said, already made safe to show (see `errorLine` in harness-cli). */
  constructor(readonly code: InstallerErrorCode, readonly label: string, readonly detail?: string) {
    super(`${label}: ${code.replaceAll('_', ' ')}${detail ? `: ${detail}` : ''}`)
    this.name = 'InstallerError'
  }
}

/** Run a file-system call, turning any failure into `io` with a relative label (Node's own message names the absolute path). */
export async function io<T>(p: Promise<T>, label: string): Promise<T> {
  try {
    return await p
  } catch {
    throw new InstallerError('io', label)
  }
}
