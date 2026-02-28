/**
 * Tool Registry for Dethereal MCP Server
 *
 * Exports all available MCP tools.
 */

// Base tool
export * from './base-tool.js'

// Authentication tools (client-free)
export { LoginTool, loginTool } from './auth/login.tool.js'
export { RefreshTokenTool, refreshTokenTool } from './auth/refresh-token.tool.js'
export { LogoutTool, logoutTool } from './auth/logout.tool.js'
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

import { BaseTool } from './base-tool.js'
// Auth tools
import { loginTool } from './auth/login.tool.js'
import { refreshTokenTool } from './auth/refresh-token.tool.js'
import { logoutTool } from './auth/logout.tool.js'
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

/**
 * All registered tools
 */
export const allTools: BaseTool[] = [
  // Authentication tools
  loginTool,
  refreshTokenTool,
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
  updateAttributesTool
]

/**
 * Tools that don't require a GraphQL client
 */
export const clientFreeTools: BaseTool[] = [
  // Auth tools are client-free
  loginTool,
  refreshTokenTool,
  logoutTool,
  // Other client-free tools
  validateModelTool,
  getSchemaTool,
  getExamplesTool
]

/**
 * Tools that require a GraphQL client
 */
export const clientDependentTools: BaseTool[] = [
  importModelTool,
  exportModelTool,
  updateModelTool,
  createModelTool,
  getClassesTool,
  updateAttributesTool
]
