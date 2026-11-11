/**
 * Shared types of the workflow generator.
 *
 * The generator turns the harness-neutral workflow (`workflow/`: skills, agents, shared
 * fragments, per-harness data) into one native bundle per harness. Everything it reads is a
 * `WorkflowSource`: POSIX paths relative to the workflow root, mapped to LF-normalised text.
 */

export type Harness = 'claude' | 'codex' | 'opencode'

export const HARNESSES: readonly Harness[] = ['claude', 'codex', 'opencode']

/** The package being generated for: its name and version as in package.json. */
export interface PackageInfo {
  readonly name: string
  readonly version: string
}

/** Workflow files by POSIX path relative to the workflow root. Content is LF-only. */
export type WorkflowSource = ReadonlyMap<string, string>

/** One lint or parse problem, located in a workflow file (or a generated file). */
export interface Finding {
  readonly rule: string
  readonly file: string
  /** 1-based; 0 when the finding concerns the whole file. */
  readonly line: number
  readonly message: string
}

/** Thrown by the generator when any finding exists: every finding, not only the first. */
export class GeneratorError extends Error {
  readonly findings: readonly Finding[]

  constructor(findings: readonly Finding[]) {
    const lines = findings.map((f) => `${f.file}${f.line ? `:${f.line}` : ''} [${f.rule}] ${f.message}`)
    super(`workflow generation failed with ${findings.length} finding(s):\n${lines.join('\n')}`)
    this.name = 'GeneratorError'
    this.findings = findings
  }
}

/** The workflow's own names (skills, agents): lowercase words joined by hyphens. */
export const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** The plugin namespace every harness uses for skills, agents and the MCP server key. */
export const PLUGIN_NAME = 'dethereal'
