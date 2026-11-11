/**
 * Which calls the entry point checks the platform for before running: the ones that send a document selecting a data
 * item's controls. Every model read or write carries the model's data items, and manage_controls reads or writes a
 * control's elements in list, assign and push-greenfield. Nothing else is held up on an older platform, so the
 * write-ahead-log repair and the other control actions keep working there.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  allTools,
  type BaseTool,
  createModelTool,
  exportModelTool,
  importModelTool,
  manageControlsTool,
  needsDataControls,
  queryControlsTool,
  updateAttributesTool,
  updateModelTool,
} from '../index.js'

describe('needsDataControls', () => {
  it('checks every call of the model tools', () => {
    for (const tool of [importModelTool, exportModelTool, updateModelTool, createModelTool, updateAttributesTool]) {
      expect(needsDataControls(tool, {})).toBe(true)
    }
  })

  it('checks manage_controls only for the actions that read or write a control\'s elements', () => {
    for (const action of ['list', 'assign', 'push-greenfield']) expect(needsDataControls(manageControlsTool, { action })).toBe(true)
    for (const action of ['get', 'create', 'update', 'delete', 'rank', 'pull-controls', 'push-brownfield', 'inspect-wal', 'clear-wal']) {
      expect(needsDataControls(manageControlsTool, { action })).toBe(false)
    }
  })

  it('checks query_controls for its list, which runs manage_controls\' list past the entry point', () => {
    expect(needsDataControls(queryControlsTool, { action: 'list' })).toBe(true)
    for (const action of ['get', 'rank']) expect(needsDataControls(queryControlsTool, { action })).toBe(false)
  })

  it('checks no other tool', () => {
    const gated = new Set<BaseTool>([importModelTool, exportModelTool, updateModelTool, createModelTool, updateAttributesTool, manageControlsTool, queryControlsTool])
    for (const tool of allTools.filter((t) => !gated.has(t))) expect(needsDataControls(tool, { action: 'list' })).toBe(false)
  })
})

describe('the tools that reach those documents', () => {
  // The dt-core calls whose documents select a data item's controls or a control's data items: a model export,
  // import, update or read, a data item or element write, a control search or assignment, a greenfield control push,
  // the platform prints a push compares, and manage_controls run in-process. A new tool file that makes one of them
  // must be classified above. A call made through a util of its own is not seen here.
  const REACHES = /\b(findControls|assignControlToElements|pushGreenfieldControl|Dt(Export|Import|Update)[A-Za-z]*|exportPlatformPrints|manageControlsTool\.execute|dumpModelData|getModelData|createDataItem|updateDataItem|updateComponent|updateBoundaryNode|updateDataFlow)\b/
  const KNOWN = ['create-model.tool.ts', 'export-model.tool.ts', 'import-model.tool.ts', 'manage-controls.tool.ts', 'query-security.tool.ts', 'update-attributes.tool.ts', 'update-model.tool.ts']

  it('are exactly the files of the checked tools', () => {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
    const reaching = readdirSync(dir).filter((f) => f.endsWith('.tool.ts') && REACHES.test(readFileSync(path.join(dir, f), 'utf8'))).sort()
    expect(reaching).toEqual(KNOWN)
  })
})
