/**
 * Authentication Tools
 *
 * MCP tools for OAuth authentication with the Dethernety platform.
 */

export { loginTool, LoginTool } from './login.tool.js'
export { logoutTool, LogoutTool } from './logout.tool.js'
export { authStatusTool, AuthStatusTool } from './auth-status.tool.js'

import { loginTool } from './login.tool.js'
import { logoutTool } from './logout.tool.js'
import { authStatusTool } from './auth-status.tool.js'

/** All authentication tools */
export const authTools = [loginTool, logoutTool, authStatusTool]
