/**
 * Which calls the entry point checks the platform for before running: the ones that send a document selecting a data
 * item's controls. Every model read or write carries the model's data items, and manage_controls reads or writes a
 * control's elements in list, assign and push-greenfield. Nothing else is held up on an older platform, so the
 * write-ahead-log repair and the other control actions keep working there.
 */
import { describe, it, expect } from 'vitest'
import {
  allTools,
  type BaseTool,
  createModelTool,
  exportModelTool,
  importModelTool,
  manageControlsTool,
  needsDataControls,
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

  it('checks no other tool', () => {
    const gated = new Set<BaseTool>([importModelTool, exportModelTool, updateModelTool, createModelTool, updateAttributesTool, manageControlsTool])
    for (const tool of allTools.filter((t) => !gated.has(t))) expect(needsDataControls(tool, { action: 'list' })).toBe(false)
  })
})
