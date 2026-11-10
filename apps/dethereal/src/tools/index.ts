/**
 * Tool Registry for Dethereal MCP Server
 *
 * Exports all 22 available MCP tools.
 */

// Base tool
export * from './base-tool.js'

// Authentication tools (client-free)
export { LoginTool, loginTool } from './auth/login.tool.js'
export { LogoutTool, logoutTool } from './auth/logout.tool.js'
export { AuthStatusTool, authStatusTool } from './auth/auth-status.tool.js'
export { authTools } from './auth/index.js'

// Client-free tools (no GraphQL connection required)
export { ValidateModelTool, validateModelTool } from './validate-model.tool.js'
export { GetSchemaTool, getSchemaTool } from './get-schema.tool.js'
export { GetExamplesTool, getExamplesTool } from './get-examples.tool.js'

// Client-dependent tools (require GraphQL connection)
export { ImportModelTool, importModelTool } from './import-model.tool.js'
export { ExportModelTool, exportModelTool } from './export-model.tool.js'
export { UpdateModelTool, updateModelTool } from './update-model.tool.js'
export { CreateModelTool, createModelTool } from './create-model.tool.js'
export { GetClassesTool, getClassesTool } from './get-classes.tool.js'
export { UpdateAttributesTool, updateAttributesTool } from './update-attributes.tool.js'

// New client-dependent tools (v3.0.0)
export { ListModelsTool, listModelsTool } from './list-models.tool.js'
export { SearchMitreAttackTool, searchMitreAttackTool } from './search-mitre-attack.tool.js'
export { GetMitreDefendTool, getMitreDefendTool } from './get-mitre-defend.tool.js'
export { ManageControlsTool, manageControlsTool } from './manage-controls.tool.js'
export { ManageCountermeasuresTool, manageCountermeasuresTool } from './manage-countermeasures.tool.js'
export { ManageAnalysesTool, manageAnalysesTool } from './manage-analyses.tool.js'
export { GenerateAttributeStubsTool, generateAttributeStubsTool } from './generate-attribute-stubs.tool.js'

// Additional tools
export { MatchClassesTool, matchClassesTool } from './match-classes.tool.js'
export { GetControlGapsTool, getControlGapsTool } from './get-control-gaps.tool.js'

// Workflow state
export { ModelStateTool, modelStateTool, effectiveState } from './model-state.tool.js'
export { ModelStateWaiveTool, modelStateWaiveTool } from './model-state-waive.tool.js'
export { ModelStateSettleTool, modelStateSettleTool } from './model-state-settle.tool.js'
export { ModelStatePruneTool, modelStatePruneTool } from './model-state-prune.tool.js'

import { BaseTool } from './base-tool.js'
// Auth tools
import { loginTool } from './auth/login.tool.js'
import { logoutTool } from './auth/logout.tool.js'
import { authStatusTool } from './auth/auth-status.tool.js'
// Other client-free tools
import { validateModelTool } from './validate-model.tool.js'
import { getSchemaTool } from './get-schema.tool.js'
import { getExamplesTool } from './get-examples.tool.js'
// Client-dependent tools
import { importModelTool } from './import-model.tool.js'
import { exportModelTool } from './export-model.tool.js'
import { updateModelTool } from './update-model.tool.js'
import { createModelTool } from './create-model.tool.js'
import { getClassesTool } from './get-classes.tool.js'
import { updateAttributesTool } from './update-attributes.tool.js'
// New client-dependent tools (v3.0.0)
import { listModelsTool } from './list-models.tool.js'
import { searchMitreAttackTool } from './search-mitre-attack.tool.js'
import { getMitreDefendTool } from './get-mitre-defend.tool.js'
import { manageControlsTool } from './manage-controls.tool.js'
import { manageCountermeasuresTool } from './manage-countermeasures.tool.js'
import { manageAnalysesTool } from './manage-analyses.tool.js'
import { generateAttributeStubsTool } from './generate-attribute-stubs.tool.js'
// Additional tools
import { matchClassesTool } from './match-classes.tool.js'
import { getControlGapsTool } from './get-control-gaps.tool.js'
import { workspaceStatusTool } from './workspace-status.tool.js'
import { detectDriftTool } from './detect-drift.tool.js'
// Workflow state
import { modelStateTool } from './model-state.tool.js'
import { modelStateWaiveTool } from './model-state-waive.tool.js'
import { modelStateSettleTool } from './model-state-settle.tool.js'
import { modelStatePruneTool } from './model-state-prune.tool.js'
// Read-only security queries
import { queryControlsTool, queryCountermeasuresTool, queryExposuresTool } from './query-security.tool.js'
import { TOOL_MANIFEST } from './manifest.js'
import { StubTool } from './stub-tool.js'
import { SETTLEMENT_ONLY_TOOLS, settlementOn } from '../utils/settlement-switch.js'

/**
 * All implemented tools
 */
const implementedTools: BaseTool[] = [
  // Authentication tools
  loginTool,
  authStatusTool,
  logoutTool,
  // Client-free tools
  validateModelTool,
  getSchemaTool,
  getExamplesTool,
  // Client-dependent tools
  importModelTool,
  exportModelTool,
  updateModelTool,
  createModelTool,
  getClassesTool,
  updateAttributesTool,
  // New tools (v3.0.0)
  listModelsTool,
  searchMitreAttackTool,
  getMitreDefendTool,
  manageControlsTool,
  manageCountermeasuresTool,
  manageAnalysesTool,
  generateAttributeStubsTool,
  // Additional tools
  matchClassesTool,
  getControlGapsTool,
  queryControlsTool,
  queryExposuresTool,
  queryCountermeasuresTool,
  // Local workspace
  workspaceStatusTool,
  detectDriftTool,
  // Workflow state
  modelStateTool,
  modelStateWaiveTool,
  modelStateSettleTool,
  modelStatePruneTool,
]

/**
 * Placeholders for manifest tools without an implementation. Tests set
 * DETHEREAL_REGISTER_STUBS=1 to hold the full manifest to the registry;
 * otherwise no placeholder is ever shown to a model. A tool held back with the
 * settlement off is implemented, so it never comes back as a placeholder.
 */
const stubTools: BaseTool[] =
  process.env.DETHEREAL_REGISTER_STUBS === '1'
    ? TOOL_MANIFEST.filter((entry) => !implementedTools.some((t) => t.name === entry.name)).map((entry) => new StubTool(entry))
    : []

/**
 * All registered tools
 */
export const allTools: BaseTool[] = [
  // With the settlement off (read once, when the server starts) its tools are not listed: every listed tool costs its
  // description on every request, and nothing calls them.
  ...(settlementOn() ? implementedTools : implementedTools.filter((t) => !SETTLEMENT_ONLY_TOOLS.includes(t.name))),
  ...stubTools,
]

/**
 * Tools that don't require a GraphQL client
 */
export const clientFreeTools: BaseTool[] = [
  // Auth tools are client-free
  loginTool,
  authStatusTool,
  logoutTool,
  // Other client-free tools
  validateModelTool,
  getSchemaTool,
  getExamplesTool,
  modelStateTool,
  modelStateWaiveTool,
  modelStateSettleTool,
  modelStatePruneTool,
  ...stubTools,
  workspaceStatusTool,
  detectDriftTool,
]

/**
 * Tools whose GraphQL documents select a data item's controls, which a platform older than that field refuses. The
 * entry point checks the platform for the field before running one of them. Each entry says which calls send such a
 * document: the model tools always do (a model read or write carries its data items), `manage_controls` only for the
 * actions that read or write a control's elements.
 */
const DATA_CONTROLS_ACTIONS = new Set(['list', 'assign', 'push-greenfield'])
const dataControlsCalls = new Map<BaseTool, (args: Record<string, unknown>) => boolean>([
  [importModelTool, () => true],
  [exportModelTool, () => true],
  [updateModelTool, () => true],
  [createModelTool, () => true],
  [updateAttributesTool, () => true],
  [manageControlsTool, (args) => typeof args.action === 'string' && DATA_CONTROLS_ACTIONS.has(args.action)],
  // query_controls forwards to manage_controls in-process, past this check, so its list is checked here.
  [queryControlsTool, (args) => args.action === 'list'],
])

/** Whether this call of `tool` sends a document that selects a data item's controls. */
export const needsDataControls = (tool: BaseTool, args: Record<string, unknown>): boolean =>
  dataControlsCalls.get(tool)?.(args) ?? false

/**
 * Tools that require a GraphQL client
 */
export const clientDependentTools: BaseTool[] = [
  importModelTool,
  exportModelTool,
  updateModelTool,
  createModelTool,
  getClassesTool,
  updateAttributesTool,
  // New tools (v3.0.0)
  listModelsTool,
  searchMitreAttackTool,
  getMitreDefendTool,
  manageControlsTool,
  manageCountermeasuresTool,
  manageAnalysesTool,
  generateAttributeStubsTool,
  // Additional tools
  matchClassesTool,
  getControlGapsTool,
  queryControlsTool,
  queryExposuresTool,
  queryCountermeasuresTool,
]

export { WorkspaceStatusTool, workspaceStatusTool } from './workspace-status.tool.js'

/**
 * Tools that only read local files: they need no session context and work even
 * when the platform URL is unusable.
 */
export const localTools: BaseTool[] = [workspaceStatusTool, detectDriftTool, modelStateTool, modelStateWaiveTool, modelStateSettleTool, modelStatePruneTool]

export { DetectDriftTool, detectDriftTool } from './detect-drift.tool.js'
export { queryControlsTool } from './query-security.tool.js'
