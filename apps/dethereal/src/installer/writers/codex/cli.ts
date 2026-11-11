/**
 * The Codex CLI calls the writer makes, each through the installer's one harness
 * runner and each answer checked against the shape Codex 0.157 prints with `--json`.
 */
import { z } from 'zod'
import { InstallerError } from '../../core/errors.js'
import { cliFailed, type HarnessCliOptions, inputArg, resolveHarnessCli, runHarnessCli, runHarnessJson } from '../../core/harness-cli.js'
import { CODEX_MARKETPLACE_NAME as MARKETPLACE_NAME, CODEX_PLUGIN_ID as PLUGIN_ID } from '../../core/manifest.js'

/** The oldest Codex whose plugin, hook and config behaviour the writer was checked against. */
export const CODEX_FLOOR = '0.157.0'

const VERSION = /^codex-cli (\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?\s*$/

/** Codex's version, refused below the floor. */
export async function codexVersion(options: HarnessCliOptions): Promise<string> {
  const r = await runHarnessCli('codex', ['--version'], options)
  if (r.failure === 'spawn' && !resolveHarnessCli('codex', options.projectRoot)) throw new InstallerError('harness_cli_missing', 'codex')
  const m = r.failure || r.code !== 0 ? null : VERSION.exec(r.stdout.trim())
  if (!m) throw cliFailed('codex --version', r)
  const have = [Number(m[1]), Number(m[2]), Number(m[3])]
  const floor = CODEX_FLOOR.split('.').map(Number)
  const cmp = have.findIndex((v, i) => v !== floor[i])
  // A pre-release of the floor itself is older than the floor.
  if ((cmp >= 0 && have[cmp]! < floor[cmp]!) || (cmp < 0 && m[4])) throw new InstallerError('harness_cli_refused', `codex ${m[0].slice(10).trim()} (needs ${CODEX_FLOOR} or later)`)
  return `${m[1]}.${m[2]}.${m[3]}${m[4] ?? ''}`
}

const Marketplaces = z.object({
  marketplaces: z.array(z.object({
    name: z.string(),
    root: z.string().nullable().optional(),
    marketplaceSource: z.object({ sourceType: z.string(), source: z.string() }).passthrough().optional(),
  }).passthrough()),
}).passthrough()

const Plugins = z.object({
  installed: z.array(z.object({
    pluginId: z.string(),
    name: z.string(),
    marketplaceName: z.string(),
    version: z.string().optional(),
    enabled: z.boolean().optional(),
  }).passthrough()),
}).passthrough()

const MarketplaceAdded = z.object({ marketplaceName: z.literal(MARKETPLACE_NAME), installedRoot: z.string() }).passthrough()
const MarketplaceRemoved = z.object({ marketplaceName: z.literal(MARKETPLACE_NAME) }).passthrough()
const PluginAdded = z.object({ pluginId: z.literal(PLUGIN_ID), version: z.string(), installedPath: z.string() }).passthrough()
const PluginRemoved = z.object({ pluginId: z.literal(PLUGIN_ID) }).passthrough()

export type MarketplaceList = z.infer<typeof Marketplaces>['marketplaces']
export type PluginList = z.infer<typeof Plugins>['installed']

/**
 * The configured marketplaces, or null when Codex cannot list them (a configured
 * marketplace whose folder is gone makes the whole listing fail).
 */
export async function listMarketplaces(options: HarnessCliOptions): Promise<MarketplaceList | null> {
  try {
    return (await runHarnessJson('codex', ['plugin', 'marketplace', 'list', '--json'], Marketplaces, 'codex plugin marketplace list', options)).marketplaces
  } catch (err) {
    if (err instanceof InstallerError && err.code === 'harness_cli_failed') return null
    throw err
  }
}

/** The installed plugins, or null when Codex cannot list them (see `listMarketplaces`). */
export async function listPlugins(options: HarnessCliOptions): Promise<PluginList | null> {
  try {
    return (await runHarnessJson('codex', ['plugin', 'list', '--json'], Plugins, 'codex plugin list', options)).installed
  } catch (err) {
    if (err instanceof InstallerError && err.code === 'harness_cli_failed') return null
    throw err
  }
}

export async function addMarketplace(dir: string, options: HarnessCliOptions): Promise<void> {
  await runHarnessJson('codex', ['plugin', 'marketplace', 'add', '--json', inputArg(dir, 'marketplace folder')], MarketplaceAdded, 'codex plugin marketplace add', options)
}

export async function removeMarketplace(options: HarnessCliOptions): Promise<void> {
  await runHarnessJson('codex', ['plugin', 'marketplace', 'remove', '--json', MARKETPLACE_NAME], MarketplaceRemoved, 'codex plugin marketplace remove', options)
}

/** Install the plugin from our marketplace; returns the version Codex installed. */
export async function addPlugin(options: HarnessCliOptions): Promise<string> {
  return (await runHarnessJson('codex', ['plugin', 'add', '--json', PLUGIN_ID], PluginAdded, 'codex plugin add', options)).version
}

export async function removePlugin(options: HarnessCliOptions): Promise<void> {
  await runHarnessJson('codex', ['plugin', 'remove', '--json', PLUGIN_ID], PluginRemoved, 'codex plugin remove', options)
}

const McpServers = z.array(z.object({
  name: z.string(),
  enabled: z.boolean(),
  disabled_reason: z.string().nullable().optional(),
  transport: z.object({
    type: z.string(),
    command: z.string().nullable().optional(),
    args: z.array(z.string()).nullable().optional(),
    env: z.record(z.string(), z.string()).nullable().optional(),
    env_vars: z.array(z.string()).nullable().optional(),
    cwd: z.string().nullable().optional(),
  }).passthrough(),
  startup_timeout_sec: z.number().nullable().optional(),
  tool_timeout_sec: z.number().nullable().optional(),
}).passthrough())

export type McpServerList = z.infer<typeof McpServers>

/**
 * The MCP servers as Codex sees them from `options.cwd`: the user config with every
 * trusted project layer above that folder merged in, key by key (a project that only
 * sets `enabled = false` keeps the user's command; one that redefines the command
 * keeps the user's env). Listing starts no server. Tool approvals are not listed.
 */
export async function listMcpServers(options: HarnessCliOptions): Promise<McpServerList> {
  return runHarnessJson('codex', ['mcp', 'list', '--json'], McpServers, 'codex mcp list', options)
}
