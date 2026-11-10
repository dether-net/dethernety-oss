/** Types for `secret-fallback.mjs`: secret files and guarded configuration, by name only. */
export declare const SECRET_SUFFIXES: readonly string[]
export declare const SECRET_PATHS: readonly string[]
export declare const SECRET_EXCEPTIONS: readonly string[]
export declare const GUARDED_CONFIG: readonly string[]
export declare const GUARDED_DIRS: readonly string[]
export declare function guardedHomes(
  env: Readonly<Record<string, string | undefined>>,
  homeDir: string,
): { codexHome: string[]; claudeConfig: string | undefined; vars: Record<string, string> }
export declare function securityPrintsSecret(args: readonly string[], fed?: boolean): boolean
export declare function withoutTrailingSlashes(text: string): string
export declare function namesSecret(p: unknown): boolean
export declare function namesGuardedConfig(p: unknown, codexHome?: string | readonly string[], claudeConfig?: string): boolean
export declare function commandWords(command: unknown): string[]
export declare function commandNamesGuarded(
  command: unknown,
  codexHome?: string | readonly string[],
  claudeConfig?: string,
  vars?: Readonly<Record<string, string>>,
): boolean
export declare function commandRunsKeychainSecret(command: unknown, vars?: Readonly<Record<string, string>>, names?: ReadonlySet<string>): boolean
export declare function keychainNames(command: unknown): Set<string>
export declare function keychainSecretInWords(words: readonly string[], names?: ReadonlySet<string>, globs?: boolean): boolean
export declare function patchPaths(text: unknown): string[] | null
export declare function patchTouchesGuarded(text: unknown, codexHome?: string | readonly string[], claudeConfig?: string): boolean
