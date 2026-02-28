/**
 * Authentication Tools
 *
 * MCP tools for OAuth authentication with the Dethernety platform.
 */

export { loginTool, LoginTool } from './login.tool.js'
export { refreshTokenTool, RefreshTokenTool } from './refresh-token.tool.js'
export { logoutTool, LogoutTool } from './logout.tool.js'

import { loginTool } from './login.tool.js'
import { refreshTokenTool } from './refresh-token.tool.js'
import { logoutTool } from './logout.tool.js'

/** All authentication tools */
export const authTools = [loginTool, refreshTokenTool, logoutTool]
