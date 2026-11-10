/**
 * What a harness target provides: how tokens are spelled, where files go, and how neutral
 * frontmatter becomes the harness's own. The core parses, lints and renders; a target only maps.
 */

import type { TokenRenderer } from '../tokens.js'
import type { Finding, Harness, PackageInfo } from '../types.js'
import type { AgentMeta, SkillMeta } from '../workflow.js'

/** Test and development only: run a specific server build instead of the packaged one. */
export interface McpEntryOverride {
  /** Absolute path of the node binary. */
  readonly node: string
  /** Absolute path of the server entry (`dist/index.js`). */
  readonly entry: string
  /** HOME for the server process, so its session and registry stay in a sandbox. */
  readonly home?: string
  /** Platform URL the server is started with. */
  readonly url?: string
}

export interface RenderedSkill {
  readonly name: string
  readonly meta: SkillMeta
  /** Rendered body (after the frontmatter). */
  readonly body: string
  /** `as-file` siblings: file name → rendered content. */
  readonly siblings: ReadonlyMap<string, string>
  /** A forked skill's body in each of the target's `forkRenderers`, by name. */
  readonly forkBodies: ReadonlyMap<string, string>
}

export interface RenderedAgent {
  readonly name: string
  readonly meta: AgentMeta
  readonly body: string
}

export interface TargetInput {
  readonly pkg: PackageInfo
  readonly skills: readonly RenderedSkill[]
  readonly agents: readonly RenderedAgent[]
  /** Parsed `harness/<harness>.yaml`, or undefined when the workflow has none. */
  readonly harnessData: unknown
  readonly mcpEntry?: McpEntryOverride
  /** Turn the server's settlement on: its environment, the hooks' flag and the approve matcher. */
  readonly settlement?: boolean
}

export interface Target {
  readonly harness: Harness
  readonly renderer: TokenRenderer
  /**
   * Further spellings of a forked skill's body, by name: where the harness hands the body to its
   * agent in another form (a task file, a command template), `{{args}}` and `as-file` read
   * differently. Each is rendered into `RenderedSkill.forkBodies`.
   */
  readonly forkRenderers?: Readonly<Record<string, TokenRenderer>>
  /** Where the bundle's `bundle.json` goes, relative to the package root. */
  readonly bundleRoot: string
  skillPath(name: string): string
  siblingPath(skill: string, fileName: string): string
  agentPath(name: string): string
  /** An emitted agent file's instructions as the model reads them, where the file encodes them. */
  agentText?(content: string): string
  /** Problems with `harness/<harness>.yaml` (`file` is its workflow path). */
  checkHarnessData(data: unknown, file: string): Finding[]
  /** Workflow shapes this harness cannot carry (`file` names the skill's workflow path). */
  checkInput?(skills: readonly RenderedSkill[], fileOf: (skill: string) => string, agents: readonly RenderedAgent[]): Finding[]
  /** Every bundle file except `bundle.json`, by path relative to the package root. */
  emit(input: TargetInput): Map<string, string>
  /** Checks on the emitted files that only this harness knows how to make. */
  checkOutput(files: ReadonlyMap<string, string>): Finding[]
}
