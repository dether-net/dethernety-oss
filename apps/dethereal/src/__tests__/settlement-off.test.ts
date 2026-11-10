/**
 * The server as shipped: the settlement off. Nothing is registered, the settle tool is not listed, and neither values
 * nobody registered nor pending enrichment hold back REVIEWED or a push; Gates 2 and 3 and the orphaned-file prune
 * stay. Each case is held against the same call with the settlement on, so a switch that does nothing fails here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

// The test setup turns the settlement on for the whole suite; this file runs as shipped, with the variable unset. The
// calls that take no mode read it from the environment (the tool list when it loads), hence before any import.
vi.hoisted(() => { delete process.env.DETHEREAL_SETTLEMENT })

const { settlementEnvProblem, settlementOn, shippedToolNames } = await import('../utils/settlement-switch.js')
const { directoryPushRefusal } = await import('../utils/gates.js')
const { modelStateTool } = await import('../tools/model-state.tool.js')
const { modelStatePruneTool } = await import('../tools/model-state-prune.tool.js')
const { validateModelTool } = await import('../tools/validate-model.tool.js')
const { collectWorkspaceStatus, workspaceStatusTool } = await import('../tools/workspace-status.tool.js')
const { GITIGNORE_REFUSED_WARNING, carryGreenfield, registerPulled, registerPushPin } = await import('../utils/settlement-writers.js')
const { manifestTool, manifestToolNames } = await import('../tools/manifest.js')
const { initProjectRoot, resetProjectRoot } = await import('../utils/project-root.js')
const { gateModel, writeGateModel } = await import('../utils/__tests__/fixtures/gate-model.js')

vi.setConfig({ testTimeout: 60_000 })

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ON = { debug: false, settlement: 'on' as const }
const OFF = { debug: false }

let tmp: string
let project: string
let dir: string
const savedHome = process.env.HOME

const dethereal = (f: string) => path.join(dir, '.dethereal', f)
const state = (s: Record<string, unknown>) => fs.writeFileSync(dethereal('state.json'), JSON.stringify(s))
const pending = () => fs.writeFileSync(dethereal('enrichment-pending.json'), JSON.stringify({ version: 1, entries: [{
  batch: 'b1', element_id: 'c-web', group: 'components', field: 'input_validation', value: 'schema', source: 'app/server.py:12', previous: 'null',
}] }))
/** The reference model with one Gate 2 failure: a component without a position. */
const breakGate2 = () => {
  const file = path.join(dir, 'structure.json')
  const s = JSON.parse(fs.readFileSync(file, 'utf8'))
  const walk = (b: any) => { for (const c of b.components ?? []) if (c.id === 'c-web') delete c.positionX; (b.boundaries ?? []).forEach(walk) }
  walk(s.defaultBoundary)
  fs.writeFileSync(file, JSON.stringify(s))
}
const ORPHAN = 'attributes/components/c-gone.json'
const orphan = () => fs.writeFileSync(path.join(dir, ORPHAN), JSON.stringify({ elementId: 'c-gone', attributes: { input_validation: 'schema' } }))

/**
 * The lines of a shipped file that name the switch, except the one place it may appear: a whole item of Codex's
 * `env_vars` list, which only passes an operator's own value through to the server. Anything else could set it.
 */
function linesNamingTheSwitch(rel: string, text: string): string[] {
  const fragment = `/${rel.split(path.sep).join('/')}`.endsWith('/bundles/codex/config.fragment.toml')
  const passedThrough = (line: string) => {
    const items = /^\s*env_vars\s*=\s*\[([^\]]*)\]\s*$/.exec(line)?.[1]?.split(',').map((i) => i.trim()) ?? []
    const named = items.filter((i) => i.includes('DETHEREAL_SETTLEMENT'))
    return named.length === 1 && named[0] === '"DETHEREAL_SETTLEMENT"'
  }
  return text.split('\n').filter((line) => line.includes('DETHEREAL_SETTLEMENT') && !(fragment && passedThrough(line)))
}

const SETTLEMENT_FILES = ['settlement-baseline.json', 'settlements.json']
const settlementFiles = () => SETTLEMENT_FILES.filter((f) => fs.existsSync(dethereal(f)))

beforeEach(async () => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-settlement-off-')))
  project = path.join(tmp, 'project')
  dir = path.join(project, 'models', 'shop')
  fs.mkdirSync(dir, { recursive: true })
  await writeGateModel(dir, gateModel())
  fs.mkdirSync(path.join(project, '.dethernety'))
  fs.writeFileSync(path.join(project, '.dethernety', 'models.json'), JSON.stringify({ models: [{ name: 'Shop', path: 'models/shop' }] }))
  fs.mkdirSync(path.join(tmp, 'home'))
  process.env.HOME = path.join(tmp, 'home')
  initProjectRoot({ cwd: project, env: {} })
})
afterEach(() => {
  resetProjectRoot()
  process.env.HOME = savedHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('the switch', () => {
  it('is on only for the exact value "on", and a caller\'s mode wins over the environment', () => {
    expect(settlementOn(undefined, {})).toBe(false)
    expect(settlementOn(undefined, { DETHEREAL_SETTLEMENT: 'on' })).toBe(true)
    for (const v of ['ON', 'On', ' on', 'on ', 'true', '1', 'yes', '']) expect(settlementOn(undefined, { DETHEREAL_SETTLEMENT: v }), v).toBe(false)
    expect(settlementOn('off', { DETHEREAL_SETTLEMENT: 'on' })).toBe(false)
    expect(settlementOn('on', {})).toBe(true)
  })

  it('says a value it does not know is off, an empty one included, and stays silent for none and for "on"', () => {
    expect(settlementEnvProblem({})).toBeNull()
    expect(settlementEnvProblem({ DETHEREAL_SETTLEMENT: 'on' })).toBeNull()
    const said = new Set<string | null>()
    for (const value of ['', 'true', 'ON', ' on', 'on ', 'hostile-value-7f3a']) {
      const problem = settlementEnvProblem({ DETHEREAL_SETTLEMENT: value })
      expect([value, problem]).toEqual([value, expect.stringMatching(/the settlement is off/)])
      said.add(problem)
    }
    // One fixed line, whatever the value: it never shows what the variable holds.
    expect(said.size).toBe(1)
    expect([...said][0]).not.toContain('hostile-value-7f3a')
  })
})

describe('the tool list', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('lists no settle tool and keeps prune, and a placeholder never brings it back', async () => {
    vi.stubEnv('DETHEREAL_REGISTER_STUBS', '1')
    vi.resetModules()
    const off = (await import('../tools/index.js')).allTools.map((t) => t.name)
    expect(off).not.toContain('model_state_settle')
    expect(off).toContain('model_state_prune')
    expect([...off].sort()).toEqual(shippedToolNames().sort())
    vi.stubEnv('DETHEREAL_SETTLEMENT', 'on')
    vi.resetModules()
    const on = (await import('../tools/index.js')).allTools.map((t) => t.name)
    expect([...on].sort()).toEqual([...manifestToolNames()].sort())
  })

  it('describes create and update without the push waiting on enrichment values, and with the settlement on as before', async () => {
    const claim = /enrichment values the operator has not confirmed/
    const off = await import('../tools/index.js')
    const offTools = off.allTools.filter((t) => t.name === 'create_threat_model' || t.name === 'update_model')
    expect(offTools.map((t) => t.name).sort()).toEqual(['create_threat_model', 'update_model'])
    for (const t of offTools) expect([t.name, t.description]).toEqual([t.name, expect.not.stringMatching(claim)])
    vi.stubEnv('DETHEREAL_SETTLEMENT', 'on')
    vi.resetModules()
    const on = await import('../tools/index.js')
    const described = (name: string) => on.allTools.find((t) => t.name === name)!.description
    expect(described('create_threat_model')).toBe('Create and import a threat model into the Dethernety platform. This tool automatically provides the current schema and example models to help you compose the threat model correctly before importing. ' +
      'It refuses while the target model directory lists enrichment values the operator has not confirmed; a model passed only in memory carries no such list.')
    expect(described('update_model')).toBe('Update an existing threat model in your Dethernety platform instance. This synchronizes the model with new JSON data, creating/updating/deleting elements as needed. Supports reading from file or inline JSON data. ' +
      'It refuses while the model directory lists enrichment values the operator has not confirmed; only the operator\'s reply to a row clears it.')
    // The list a harness reads is no longer than with the settlement on.
    const size = (tools: { description: string }[]) => tools.reduce((n, t) => n + t.description.length, 0)
    expect(size(offTools)).toBeLessThan(size(on.allTools.filter((t) => t.name === 'create_threat_model' || t.name === 'update_model')))
  })

  it('describes prune without the settle tool', () => {
    expect(modelStatePruneTool.description).not.toMatch(/settle/)
    expect(modelStatePruneTool.description).toMatch(/orphaned attribute files/)
  })

  it('ships no bundle that sets it: Codex passes the name through, and nothing else names it', () => {
    const TEXT = /\.(json|jsonc|toml|ya?ml|md|mjs|js|ts|sh)$/
    const hits: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (TEXT.test(e.name)) hits.push(...linesNamingTheSwitch(path.relative(PKG, p), fs.readFileSync(p, 'utf8')).map((l) => `${path.relative(PKG, p)}: ${l}`))
      }
    }
    for (const d of ['bundles', '.claude-plugin', 'src/generator/package-goldens', 'src/generator/goldens']) walk(path.join(PKG, d))
    expect(hits).toEqual([])
  })

  it('takes the Codex pass-through, and nothing that sets the variable or names it elsewhere', () => {
    const FRAGMENT = 'bundles/codex/config.fragment.toml'
    const passThrough = 'env_vars = ["NODE_EXTRA_CA_CERTS", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY", "DEBUG", "DETHERNETY_URL", "DETHEREAL_SETTLEMENT"]'
    expect(linesNamingTheSwitch(FRAGMENT, `[mcp_servers.dethereal]\n${passThrough}\n`)).toEqual([])
    expect(linesNamingTheSwitch(`src/generator/package-goldens/codex/${FRAGMENT}`, passThrough)).toEqual([])
    const setting: Array<[string, string]> = [
      [FRAGMENT, '[mcp_servers.dethereal.env]\nDETHEREAL_SETTLEMENT = "on"'],
      [FRAGMENT, 'env = { DETHEREAL_SETTLEMENT = "on" }'],
      [FRAGMENT, 'env_vars = ["DETHEREAL_SETTLEMENT=on"]'],
      [FRAGMENT, 'env_vars = ["DEBUG"] # DETHEREAL_SETTLEMENT = "on"'],
      [FRAGMENT, 'env_vars = ["DETHEREAL_SETTLEMENT", "DETHEREAL_SETTLEMENT"]'],
      [FRAGMENT, 'env_vars = [\n  "DETHEREAL_SETTLEMENT",\n]'],
      [`src/generator/package-goldens/codex/${FRAGMENT}`, `${passThrough}\nDETHEREAL_SETTLEMENT = "on"`],
      ['bundles/claude/.mcp.json', '{ "env": { "DETHEREAL_SETTLEMENT": "on" } }'],
      ['bundles/opencode/opencode.json', '"environment": { "DETHEREAL_SETTLEMENT": "on" }'],
      ['bundles/opencode/config.yaml', 'DETHEREAL_SETTLEMENT: on'],
      ['bundles/codex/plugins/dethereal/bin/run.sh', 'export DETHEREAL_SETTLEMENT=on'],
      // The pass-through list is allowed in the Codex fragment alone.
      ['bundles/opencode/config.toml', passThrough],
    ]
    for (const [rel, text] of setting) expect(linesNamingTheSwitch(rel, text), `${rel}: ${text}`).not.toEqual([])
  })
})

describe('a pull and a push', () => {
  it('a push is refused on Gate 2 alone: unregistered values and pending enrichment do not stop it', async () => {
    pending()
    expect(await directoryPushRefusal(dir)).toBeNull()
    expect(await directoryPushRefusal(dir, undefined, { settlement: 'on' })).toMatch(/pending_enrichment/)
    fs.rmSync(dethereal('enrichment-pending.json'))
    expect(await directoryPushRefusal(dir, undefined, { settlement: 'on' })).toMatch(/unregistered_changes/)
    breakGate2()
    expect(await directoryPushRefusal(dir)).toMatch(/Gate 2 fails/)
  })

  it.each([
    ['a pull', () => registerPulled(dir, {} as never, { modelId: 'model-1', prints: null })],
    ['a push', () => registerPushPin(dir, {} as never, {}, undefined, 'model-1')],
  ])('%s registers nothing, needs no key, and keeps this machine\'s files out of git', async (_, write) => {
    expect(await write()).toEqual({ status: 'nothing' })
    expect(settlementFiles()).toEqual([])
    const ignore = fs.readFileSync(dethereal('.gitignore'), 'utf8')
    for (const f of ['sync.json', 'control-audit.log', 'settlement-baseline.json']) expect(ignore).toContain(f)
    // The machine's key and pointer live in the home folder: nothing there was touched.
    expect(fs.existsSync(path.join(process.env.HOME!, '.dethernety'))).toBe(false)
  })

  it.each([
    ['a pull', () => registerPulled(dir, {} as never, { modelId: 'model-1', prints: null })],
    ['a push', () => registerPushPin(dir, {} as never, {}, undefined, 'model-1')],
  ])('%s says so when .gitignore cannot be kept', async (_, write) => {
    fs.writeFileSync(path.join(tmp, 'elsewhere'), 'x\n')
    fs.symlinkSync(path.join(tmp, 'elsewhere'), dethereal('.gitignore'))
    expect(await write()).toEqual({ status: 'nothing', warning: GITIGNORE_REFUSED_WARNING })
    expect(fs.readFileSync(path.join(tmp, 'elsewhere'), 'utf8')).toBe('x\n')
  })

  it('a local control created on the platform carries no registration, and needs no key', async () => {
    expect(await carryGreenfield(dir, { tempId: 'greenfield-waf', serverId: 'ctl-1' })).toEqual({ status: 'nothing' })
    expect(settlementFiles()).toEqual([])
    expect(fs.existsSync(path.join(process.env.HOME!, '.dethernety'))).toBe(false)
  })

  it('keeps the lines the user wrote in .gitignore', async () => {
    fs.writeFileSync(dethereal('.gitignore'), 'mine.json\n')
    await registerPulled(dir, {} as never, { modelId: 'model-1', prints: null })
    await registerPulled(dir, {} as never, { modelId: 'model-1', prints: null })
    const lines = fs.readFileSync(dethereal('.gitignore'), 'utf8').split('\n')
    expect(lines[0]).toBe('mine.json')
    expect(lines.filter((l) => l === 'sync.json')).toHaveLength(1)
  })
})

describe('model_state', () => {
  it('get says the settlement is off and carries none of its fields', async () => {
    state({ currentState: 'ENRICHING' })
    pending()
    const off = (await modelStateTool.run({ action: 'get', directory_path: dir }, OFF)).data as Record<string, unknown>
    expect(off.settlement).toBe('off')
    for (const k of ['baseline', 'unregistered_changes', 'declined_fields', 'orphaned_registrations', 'registered', 'pending_enrichment', 'settlements_verified']) {
      expect(off, k).not.toHaveProperty(k)
    }
    expect(off).toMatchObject({ state: 'ENRICHING', display_state: 'ENRICHING', gates: { gate2: 'PASS' } })
    const on = (await modelStateTool.run({ action: 'get', directory_path: dir }, ON)).data as Record<string, unknown>
    expect(on).not.toHaveProperty('settlement')
    expect(on).toHaveProperty('pending_enrichment')
    expect(on.display_state).toMatch(/pending enrichment/)
  })

  it('lists none of the settlement\'s row-list inputs, nor the pending sentence, and refuses them as unknown', async () => {
    const listed = Object.keys((z.toJSONSchema(modelStateTool.inputSchema, { target: 'draft-07' }) as { properties: object }).properties)
    const entry = manifestTool('model_state')!
    expect(listed.sort()).toEqual(Object.keys(entry.inputs).filter((k) => !entry.settlementOnly!.includes(k)).sort())
    expect(modelStateTool.description).not.toMatch(/pending|include/)
    state({ currentState: 'ENRICHING' })
    const r = await modelStateTool.run({ action: 'get', directory_path: dir, include: ['pending_rows'] } as never, OFF)
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/"code": "unrecognized_keys"[\s\S]*"include"/)
  })

  it('get refuses the settlement\'s row lists to a caller with the settlement off, where the server lists them', async () => {
    vi.stubEnv('DETHEREAL_SETTLEMENT', 'on')
    vi.resetModules()
    try {
      const { modelStateTool: listing } = await import('../tools/model-state.tool.js')
      // The reloaded modules hold their own project root.
      ;(await import('../utils/project-root.js')).initProjectRoot({ cwd: project, env: {} })
      state({ currentState: 'ENRICHING' })
      for (const include of ['pending_rows', 'pending_sources', 'unregistered_rows']) {
        const r = await listing.run({ action: 'get', directory_path: dir, include: [include] } as never, { debug: false, settlement: 'off' })
        expect(r.success, include).toBe(false)
        expect(r.data, include).toMatchObject({ codes: ['settlement_off'] })
      }
      expect((await listing.run({ action: 'get', directory_path: dir, include: ['unregistered_rows'] } as never, ON)).success).toBe(true)
    } finally {
      vi.unstubAllEnvs()
      vi.resetModules()
    }
  })

  it('get of a model it cannot read says nothing of a pending file', async () => {
    state({ currentState: 'ENRICHING' })
    pending()
    fs.writeFileSync(path.join(dir, 'structure.json'), '{ not json')
    const off = (await modelStateTool.run({ action: 'get', directory_path: dir }, OFF)).data as Record<string, unknown>
    expect(off).toMatchObject({ settlement: 'off', gates: { verdict: 'UNAVAILABLE' } })
    expect(off).not.toHaveProperty('pending_enrichment')
  })

  it('REVIEWED needs the gates only: unregistered values and pending enrichment do not stop it', async () => {
    state({ currentState: 'ENRICHING', completedStates: ['INITIALIZED', 'SCOPE_DEFINED', 'DISCOVERED', 'STRUCTURE_COMPLETE'] })
    pending()
    const on = await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'REVIEWED' }, ON)
    expect(on.success).toBe(false)
    expect((on.data as { codes: string[] }).codes).toEqual(expect.arrayContaining(['pending_enrichment', 'unregistered_changes']))
    const off = await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'REVIEWED' }, OFF)
    expect(off.success, off.error).toBe(true)
    // A claimed REVIEWED holds with the settlement off, and reads ENRICHING with it on.
    expect((await modelStateTool.run({ action: 'get', directory_path: dir }, OFF)).data).toMatchObject({ state: 'REVIEWED' })
    expect((await modelStateTool.run({ action: 'get', directory_path: dir }, ON)).data).toMatchObject({ state: 'ENRICHING' })
  })

  it('REVIEWED of a model it cannot read is refused for that alone, a pending file not read', async () => {
    state({ currentState: 'ENRICHING' })
    pending()
    fs.writeFileSync(path.join(dir, 'structure.json'), '{ not json')
    const r = await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'REVIEWED' }, OFF)
    expect((r.data as { codes: string[] }).codes).toEqual(['unreadable_model'])
    const on = await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'REVIEWED' }, ON)
    expect((on.data as { codes: string[] }).codes).toEqual(['unreadable_model', 'pending_enrichment'])
  })

  it('REVIEWED is still refused on the gates', async () => {
    state({ currentState: 'ENRICHING' })
    breakGate2()
    const r = await modelStateTool.run({ action: 'transition', directory_path: dir, to: 'REVIEWED' }, OFF)
    expect(r.success).toBe(false)
    expect((r.data as { codes: string[] }).codes).toEqual(['gate2_fails'])
  })

  it('a state change says so when .gitignore cannot be kept', async () => {
    state({ currentState: 'ENRICHING' })
    fs.writeFileSync(path.join(tmp, 'elsewhere'), 'x\n')
    fs.symlinkSync(path.join(tmp, 'elsewhere'), dethereal('.gitignore'))
    const r = await modelStateTool.run({ action: 'stale', directory_path: dir, add: ['c-web'] }, OFF)
    expect(r.success).toBe(true)
    expect((r.data as { warnings?: string[] }).warnings).toEqual([GITIGNORE_REFUSED_WARNING])
    const get = await modelStateTool.run({ action: 'get', directory_path: dir }, OFF)
    expect(get.data).not.toHaveProperty('warnings')
  })

  it('a state write keeps this machine\'s files out of git, and writes no settlement file', async () => {
    state({ currentState: 'ENRICHING' })
    expect(fs.existsSync(dethereal('.gitignore'))).toBe(false)
    expect((await modelStateTool.run({ action: 'stale', directory_path: dir, add: ['c-web'] }, OFF)).success).toBe(true)
    expect(fs.readFileSync(dethereal('.gitignore'), 'utf8')).toContain('sync.json')
    expect(settlementFiles()).toEqual([])
  })
})

describe('the gates', () => {
  it('neither report nor lint pending enrichment', async () => {
    pending()
    const text = async (action: string, context: object) =>
      JSON.stringify(await validateModelTool.run({ action, directory_path: dir } as never, context as never))
    expect(await text('gates', OFF)).not.toContain('pending_enrichment')
    expect(await text('gates', ON)).toContain('pending_enrichment')
    expect(await text('validate', OFF)).not.toContain('pending_enrichment')
    expect(await text('validate', ON)).toContain('pending_enrichment')
  })
})

describe('workspace_status', () => {
  it('names no pending or settlement blocker and no qualifier', async () => {
    state({ currentState: 'ENRICHING' })
    pending()
    const m = (await collectWorkspaceStatus()).models[0]!
    expect(m).toMatchObject({ state: 'ENRICHING', displayState: 'ENRICHING', readiness: { ready: true, blockers: [] } })
  })

  it('says which mode it read the models with: the caller\'s, else the environment\'s', async () => {
    state({ currentState: 'ENRICHING' })
    pending()
    expect(await collectWorkspaceStatus()).toMatchObject({ settlement: 'off' })
    const on = await collectWorkspaceStatus({ settlement: 'on' })
    expect(on).toMatchObject({ settlement: 'on' })
    expect(on.models[0]!.readiness?.blockers).toContain('pending')
    expect((await workspaceStatusTool.run({}, OFF)).data).toMatchObject({ settlement: 'off' })
    expect((await workspaceStatusTool.run({}, ON)).data).toMatchObject({ settlement: 'on' })
    // One model's view reads it with the caller's mode as well, and says which.
    const one = async (context: object) => (await workspaceStatusTool.run({ directory_path: dir }, context as never)).data as { settlement: string; model: { displayState?: string } }
    expect(await one(OFF)).toMatchObject({ settlement: 'off', model: { displayState: 'ENRICHING' } })
    expect(await one(ON)).toMatchObject({ settlement: 'on', model: { displayState: expect.stringMatching(/pending enrichment/) } })
  })

  it('names a model that holds settlement records when the settlement is off, and only then', async () => {
    state({ currentState: 'ENRICHING' })
    expect((await collectWorkspaceStatus()).models[0]).not.toHaveProperty('settledWithSettlementOn')
    for (const record of ['settlement-baseline.json', 'settlements.json']) {
      fs.writeFileSync(dethereal(record), '{}')
      expect((await collectWorkspaceStatus()).models[0], record).toMatchObject({ settledWithSettlementOn: true })
      expect((await collectWorkspaceStatus({ settlement: 'on' })).models[0], record).not.toHaveProperty('settledWithSettlementOn')
      fs.rmSync(dethereal(record))
    }
  })
})

describe('model_state_prune', () => {
  it('deletes the orphaned files it lists, and reads and writes no settlement file, even one that does not verify', async () => {
    orphan()
    fs.writeFileSync(dethereal('settlement-baseline.json'), 'not a baseline')
    const on = await modelStatePruneTool.run({ directory_path: dir, files: [ORPHAN] }, ON)
    expect(on.success).toBe(false)
    expect(on.data).toMatchObject({ codes: ['baseline_unverified'] })
    const off = await modelStatePruneTool.run({ directory_path: dir, files: [ORPHAN] }, OFF)
    expect(off.success, off.error).toBe(true)
    expect(off.data).toMatchObject({ deleted: [ORPHAN] })
    expect(JSON.stringify(off.data)).not.toMatch(/settle/)
    expect(fs.existsSync(path.join(dir, ORPHAN))).toBe(false)
    expect(fs.readFileSync(dethereal('settlement-baseline.json'), 'utf8')).toBe('not a baseline')
    expect(fs.existsSync(dethereal('settlements.json'))).toBe(false)
  })

  it('refuses a file it does not list, and a file changed since, deleting nothing', async () => {
    orphan()
    const other = 'attributes/components/c-web.json'
    const r = await modelStatePruneTool.run({ directory_path: dir, files: [other] }, OFF)
    expect(r.success).toBe(false)
    expect(r.data).toMatchObject({ codes: ['files_differ'], orphaned_files: [ORPHAN] })
    expect(fs.existsSync(path.join(dir, other))).toBe(true)
    expect(fs.existsSync(path.join(dir, ORPHAN))).toBe(true)
    expect(settlementFiles()).toEqual([])
  })
})
