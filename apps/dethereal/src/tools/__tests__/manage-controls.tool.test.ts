import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { ToolContext } from '../base-tool.js'

const {
  mockGetControl,
  mockUpdateControl,
  mockCreateControl,
  mockGetClassById,
  mockGetControlClasses,
  mockAcquireLock,
  mockReleaseLock,
  mockApplyPendingRewrites,
  mockInspectPendingRewrite,
  mockReadControlFile,
  mockListControlFiles,
  mockAssignControlToElements,
  libHooks,
} = vi.hoisted(() => ({
  mockGetControl: vi.fn(),
  mockUpdateControl: vi.fn(),
  mockCreateControl: vi.fn(),
  mockGetClassById: vi.fn(),
  mockGetControlClasses: vi.fn(),
  mockAcquireLock: vi.fn(),
  mockReleaseLock: vi.fn(),
  mockApplyPendingRewrites: vi.fn(),
  mockInspectPendingRewrite: vi.fn(),
  mockReadControlFile: vi.fn(),
  mockListControlFiles: vi.fn(),
  mockAssignControlToElements: vi.fn(),
  /** When set, replaces DtControlLibrary.pushBrownfieldControl (the engine has its own tests). */
  libHooks: { pushBrownfield: null as null | ((args: unknown) => unknown) },
}))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    // Lock + WAL pre-dispatch is mocked so directory-touching actions don't
    // hit the real filesystem; only the file-not-found diagnosis tests
    // exercise these paths and they override the relevant mocks per case.
    acquireLock: mockAcquireLock,
    releaseLock: mockReleaseLock,
    applyPendingRewrites: mockApplyPendingRewrites,
    inspectPendingRewrite: mockInspectPendingRewrite,
    readControlFile: mockReadControlFile,
    listControlFiles: mockListControlFiles,
    DtControl: class MockDtControl {
      constructor(_apolloClient: unknown) {}
      getControl = mockGetControl
      updateControl = mockUpdateControl
      createControl = mockCreateControl
      assignControlToElements = mockAssignControlToElements
    },
    DtControlLibrary: class HookedDtControlLibrary extends (actual.DtControlLibrary as new (c: unknown) => Record<string, unknown>) {
      constructor(apolloClient: unknown) {
        super(apolloClient)
        if (libHooks.pushBrownfield) this.pushBrownfieldControl = libHooks.pushBrownfield
      }
    },
    DtClass: class MockDtClass {
      constructor(_apolloClient: unknown) {}
      getClassById = mockGetClassById
      getControlClasses = mockGetControlClasses
    },
  }
})

// Default: every class id resolves to a CONTROL class (so existing
// merge-defaults tests that pass class_ids pass the new kind validation).
// Kind-specific tests override mockGetClassById per case.
const asControlClass = ({ classType }: { classType: string }) =>
  classType === 'control'
    ? { id: 'ctrl-class', name: 'Network Access Control', module: { id: 'mod-1', name: 'dethernety-general' } }
    : undefined

import { manageControlsTool } from '../manage-controls.tool.js'

// File-level safe defaults for the lock + WAL + file-IO mocks. The non-directory
// suites (create/update/class-kind) never reach these in practice, but giving
// them benign defaults means a future directory-touching test added to any
// suite starts from a known state instead of an unstubbed `undefined` — and
// no suite inherits another suite's leftover stub by declaration order.
beforeEach(() => {
  mockAcquireLock.mockReset().mockResolvedValue({} as never)
  mockReleaseLock.mockReset().mockResolvedValue(undefined)
  mockApplyPendingRewrites.mockReset().mockResolvedValue(0)
  mockInspectPendingRewrite
    .mockReset()
    .mockResolvedValue({ present: false, journalPath: '', operations: [] })
  mockReadControlFile.mockReset().mockResolvedValue(null)
  mockListControlFiles.mockReset().mockResolvedValue([])
})

describe('ManageControlsTool', () => {
  it('refuses the read actions: listing, reading and ranking controls is query_controls\'', () => {
    for (const input of [{ action: 'list' }, { action: 'list', name: 'firewall' }, { action: 'get', control_id: 'c-1' }, { action: 'rank', element_types: ['PROCESS'] }]) {
      expect(manageControlsTool.inputSchema.safeParse(input).success, input.action).toBe(false)
    }
  })

  it('lists no ranking inputs, and drops them from a call, while query_controls\' rank still takes them', async () => {
    const listed = (await import('../../tool-listing.js')).listedTool(manageControlsTool).inputSchema as { properties: Record<string, unknown> }
    expect(listed.properties).not.toHaveProperty('element_types')
    expect(listed.properties).not.toHaveProperty('top_n')
    const parsed = manageControlsTool.inputSchema.safeParse({ action: 'create', name: 'WAF', element_types: ['PROCESS'], top_n: 3 })
    expect(parsed.success).toBe(true)
    expect(parsed.data).not.toHaveProperty('element_types')
    expect(parsed.data).not.toHaveProperty('top_n')
    const { queryControlsTool } = await import('../query-security.tool.js')
    expect(queryControlsTool.inputSchema.safeParse({ action: 'rank', element_types: ['PROCESS'], top_n: 3 }).success).toBe(true)
  })

  it('should have the correct tool name', () => {
    expect(manageControlsTool.name).toBe('manage_controls')
  })

  it('should require a client', () => {
    expect(manageControlsTool.requiresClient).toBe(true)
  })



  it('should reject get action without control_id', () => {
    const result = manageControlsTool.inputSchema.safeParse({ action: 'get' })
    expect(result.success).toBe(false)
  })

  it('should accept create action with name', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'create',
      name: 'WAF',
      description: 'Web Application Firewall'
    })
    expect(result.success).toBe(true)
  })

  it('should reject create action without name', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'create',
      description: 'Missing name'
    })
    expect(result.success).toBe(false)
  })

  it('should reject delete action without control_id', () => {
    const result = manageControlsTool.inputSchema.safeParse({ action: 'delete' })
    expect(result.success).toBe(false)
  })

  // Assign action
  it('should accept assign action with control_id and element_ids', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'assign',
      control_id: 'ctrl-1',
      element_ids: ['elem-1', 'elem-2'],
    })
    expect(result.success).toBe(true)
  })

  it('should reject assign action without control_id', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'assign',
      element_ids: ['elem-1'],
    })
    expect(result.success).toBe(false)
  })

  it('should reject assign action without element_ids', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'assign',
      control_id: 'ctrl-1',
    })
    expect(result.success).toBe(false)
  })

  it('should reject assign action with empty element_ids', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'assign',
      control_id: 'ctrl-1',
      element_ids: [],
    })
    expect(result.success).toBe(false)
  })

  // Advanced list filters




  // Multi-class bindings — a Control may bind several ControlClasses
  it('should accept create action with multiple class_ids', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'create',
      name: 'DB Encryption',
      class_ids: ['class-a', 'class-b'],
    })
    expect(result.success).toBe(true)
  })

  it('should accept update action with multiple class_ids', () => {
    const result = manageControlsTool.inputSchema.safeParse({
      action: 'update',
      control_id: 'ctrl-1',
      class_ids: ['class-a', 'class-b'],
    })
    expect(result.success).toBe(true)
  })
})

describe('ManageControlsTool.execute — update merge-defaults', () => {
  const context: ToolContext = { debug: false, apolloClient: {} as never }

  const currentControl = {
    id: 'ctrl-1',
    name: 'DB Encryption',
    description: 'Encryption at rest for payment-db',
    folder: { id: 'folder-9' },
    controlClasses: [{ id: 'class-a' }, { id: 'class-b' }],
  }

  beforeEach(() => {
    mockGetControl.mockReset()
    mockUpdateControl.mockReset()
    mockGetClassById.mockReset()
    mockGetControlClasses.mockReset()
    // Existing merge-defaults tests that pass class_ids must clear the new
    // kind validation: treat any provided id as a valid CONTROL class.
    mockGetClassById.mockImplementation(asControlClass)
  })

  it('preserves name, class bindings, and folder on a description-only update', async () => {
    mockGetControl.mockResolvedValueOnce(currentControl)
    mockUpdateControl.mockResolvedValueOnce({
      control: { ...currentControl, description: 'Updated' },
      bindingResult: null,
      residualOk: true,
    })

    const result = await manageControlsTool.execute(
      { action: 'update', control_id: 'ctrl-1', description: 'Updated' } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockUpdateControl).toHaveBeenCalledWith({
      controlId: 'ctrl-1',
      name: 'DB Encryption',
      description: 'Updated',
      controlClasses: ['class-a', 'class-b'],
      folderId: 'folder-9',
    })
  })

  it('passes explicitly provided values through unchanged', async () => {
    mockGetControl.mockResolvedValueOnce(currentControl)
    mockUpdateControl.mockResolvedValueOnce({
      control: { ...currentControl, name: 'Renamed' },
      bindingResult: null,
      residualOk: true,
    })

    const result = await manageControlsTool.execute(
      {
        action: 'update',
        control_id: 'ctrl-1',
        name: 'Renamed',
        description: 'New desc',
        class_ids: ['class-c'],
        folder_id: 'folder-2',
      } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockUpdateControl).toHaveBeenCalledWith({
      controlId: 'ctrl-1',
      name: 'Renamed',
      description: 'New desc',
      controlClasses: ['class-c'],
      folderId: 'folder-2',
    })
  })

  it('fails without calling updateControl when the control does not exist', async () => {
    mockGetControl.mockResolvedValueOnce(null)

    const result = await manageControlsTool.execute(
      { action: 'update', control_id: 'ctrl-missing', description: 'x' } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
    expect(mockUpdateControl).not.toHaveBeenCalled()
  })

  it('reports failure when updateControl returns control: null / residualOk: false', async () => {
    mockGetControl.mockResolvedValueOnce(currentControl)
    mockUpdateControl.mockResolvedValueOnce({
      control: null,
      bindingResult: null,
      residualOk: false,
    })

    const result = await manageControlsTool.execute(
      { action: 'update', control_id: 'ctrl-1', description: 'x' } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Failed to update control')
  })
})

describe('ManageControlsTool.execute — CONTROL class-kind validation', () => {
  const context: ToolContext = { debug: false, apolloClient: {} as never }

  // A ComponentClass id (the wrong-kind binding case): getClassById('control')
  // misses, the 'component' probe hits, getControlClasses supplies same-module
  // suggestions.
  const componentClass = {
    id: 'comp-class',
    name: 'NetworkPolicy',
    module: { id: 'mod-k8s', name: 'k8s-module' },
  }
  const wrongKindLookup = ({ classType }: { classType: string }) =>
    classType === 'component' ? componentClass : undefined

  beforeEach(() => {
    mockGetControl.mockReset()
    mockUpdateControl.mockReset()
    mockCreateControl.mockReset()
    mockGetClassById.mockReset()
    mockGetControlClasses.mockReset()
  })

  it('rejects create with a ComponentClass id before calling createControl', async () => {
    mockGetClassById.mockImplementation(wrongKindLookup)
    mockGetControlClasses.mockResolvedValueOnce([
      { controlClasses: [{ id: 'nac-1', name: 'Network Access Control' }] },
    ])

    const result = await manageControlsTool.execute(
      { action: 'create', name: 'example-control', class_ids: ['comp-class'] } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('NetworkPolicy')
    expect(result.error).toContain('COMPONENT class')
    expect(result.error).toContain('k8s-module')
    expect(result.error).toContain('Network Access Control (nac-1)')
    expect(mockCreateControl).not.toHaveBeenCalled()
    // The same-module suggestion filters the module by id with the platform's filter shape (an `eq`, not a bare id).
    expect(mockGetControlClasses).toHaveBeenCalledWith({ moduleWhere: { id: { eq: 'mod-k8s' } }, classWhere: {} })
  })

  it('proceeds with create when every class id is a CONTROL class', async () => {
    mockGetClassById.mockImplementation(asControlClass)
    mockCreateControl.mockResolvedValueOnce({ id: 'new-ctrl', name: 'example-control' })

    const result = await manageControlsTool.execute(
      { action: 'create', name: 'example-control', class_ids: ['ctrl-class'] } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockCreateControl).toHaveBeenCalled()
  })

  it('does not look up class kinds when create omits class_ids', async () => {
    mockCreateControl.mockResolvedValueOnce({ id: 'new-ctrl', name: 'example-control' })

    const result = await manageControlsTool.execute(
      { action: 'create', name: 'example-control' } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockGetClassById).not.toHaveBeenCalled()
    expect(mockCreateControl).toHaveBeenCalled()
  })

  it('rejects update with a ComponentClass id before fetching/updating the control', async () => {
    mockGetClassById.mockImplementation(wrongKindLookup)
    mockGetControlClasses.mockResolvedValueOnce([])

    const result = await manageControlsTool.execute(
      { action: 'update', control_id: 'ctrl-1', class_ids: ['comp-class'] } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('NetworkPolicy')
    expect(mockGetControl).not.toHaveBeenCalled()
    expect(mockUpdateControl).not.toHaveBeenCalled()
  })

  it('does not validate kinds when update omits class_ids', async () => {
    mockGetControl.mockResolvedValueOnce({ id: 'ctrl-1', name: 'X', controlClasses: [] })
    mockUpdateControl.mockResolvedValueOnce({ control: { id: 'ctrl-1' }, residualOk: true })

    const result = await manageControlsTool.execute(
      { action: 'update', control_id: 'ctrl-1', description: 'desc' } as never,
      context,
    )

    expect(result.success).toBe(true)
    expect(mockGetClassById).not.toHaveBeenCalled()
  })

  it('reports an unknown class id with verification guidance', async () => {
    // getClassById misses every kind.
    mockGetClassById.mockResolvedValue(undefined)

    const result = await manageControlsTool.execute(
      { action: 'create', name: 'x', class_ids: ['ghost'] } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('does not resolve to any class')
    expect(mockCreateControl).not.toHaveBeenCalled()
  })
})

describe('ManageControlsTool — push-brownfield decisions', () => {
  const input = (sharedOwnership: string) => ({
    action: 'push-brownfield', directory_path: '/m', control_id: 'ctl-1', decision: { sharedOwnership },
    fresh_platform_attrs: {}, live_assigned_model_ids: ['model-this'], this_model_id: 'model-this',
  })

  it('takes cancel, push-anyway and push-unverified, and refuses a clone, which is not offered', () => {
    for (const d of ['cancel', 'push-anyway', 'push-unverified']) expect(manageControlsTool.inputSchema.safeParse(input(d)).success, d).toBe(true)
    const clone = manageControlsTool.inputSchema.safeParse(input('clone-and-swap'))
    expect(clone.success).toBe(false)
    expect(clone.error!.issues[0]!.message).toMatch(/to fork a shared control, cancel the row and create a separate control/)
    expect(manageControlsTool.inputSchema.safeParse(input('anything')).success).toBe(false)
  })
})

describe('ManageControlsTool.execute — push-brownfield ownership', () => {
  const context: ToolContext = { debug: false, apolloClient: {} as never }
  const dir = './__ownership_model__'
  const file = (assignedModelIds: string[]) => ({
    id: 'ctl-1',
    name: 'Shared control',
    source: 'declared',
    lifecycle: 'brownfield',
    classes: [
      {
        classId: 'ctrl-class',
        attributes: { foo: 'edited' },
        platformAttributes: { foo: 'bar' },
        localEditedAt: '2026-09-26T10:00:00Z',
        pendingEdit: { editedBy: 'agent', editedAt: '2026-09-26T10:00:00Z', previousAttributes: { foo: 'bar' } },
      },
    ],
    platformState: { assignedModelIds },
  })
  const push = (live: string[] | null, sharedOwnership = 'push-anyway') =>
    manageControlsTool.execute(
      {
        action: 'push-brownfield',
        directory_path: dir,
        control_id: 'ctl-1',
        decision: { sharedOwnership },
        fresh_platform_attrs: { 'ctrl-class': { foo: 'bar' } },
        live_assigned_model_ids: live,
        this_model_id: 'model-this',
      } as never,
      context,
    )

  beforeEach(() => {
    mockAcquireLock.mockReset().mockResolvedValue({} as never)
    mockReleaseLock.mockReset().mockResolvedValue(undefined)
    mockApplyPendingRewrites.mockReset().mockResolvedValue(0)
    mockReadControlFile.mockReset()
    mockGetClassById.mockReset().mockImplementation(asControlClass)
  })

  it('passes a failed ownership query on to the engine as unknown, never as alone', async () => {
    mockReadControlFile.mockResolvedValue(file(['model-this', 'model-other']))
    const seen: unknown[] = []
    libHooks.pushBrownfield = async (args) => {
      seen.push((args as { liveAssignedModelIds: unknown }).liveAssignedModelIds)
      return { file: {}, auditEntries: [], mutated: false }
    }
    try {
      await push(null, 'push-unverified')
    } finally {
      libHooks.pushBrownfield = null
    }
    // The engine treats null as unknown ownership: only push-unverified or cancel (its own tests).
    expect(seen).toEqual([null])
  })

  it('attributes the push to the platform login only: no local identity reaches the engine', async () => {
    mockReadControlFile.mockResolvedValue(file(['model-this']))
    const seen: Record<string, unknown>[] = []
    libHooks.pushBrownfield = async (args) => {
      seen.push(args as Record<string, unknown>)
      return { file: {}, auditEntries: [], mutated: false }
    }
    try {
      await push(['model-this'], 'push-anyway')
    } finally {
      libHooks.pushBrownfield = null
    }
    expect(seen).toHaveLength(1)
    expect(seen[0]).toHaveProperty('authnOperator')
    expect(seen[0]).not.toHaveProperty('operator')
  })

  it("tags audit values under a key derived from this machine's key; with no usable key, values are left out", async () => {
    // A throwaway HOME: this machine's key is created there, never in the real one.
    const savedHome = process.env.HOME
    const homeA = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-audit-home-')))
    const homeB = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dethereal-audit-home-')))
    mockReadControlFile.mockResolvedValue(file(['model-this']))
    const seen: Array<{ tag?: (k: string, v: unknown) => string; omittedCode?: string }> = []
    libHooks.pushBrownfield = async (args) => {
      seen.push((args as { valueTags: (typeof seen)[number] }).valueTags)
      return { file: {}, auditEntries: [], mutated: false }
    }
    try {
      process.env.HOME = homeA
      await push(['model-this'])
      process.env.HOME = homeB
      await push(['model-this'])
      // A key the machine cannot use (group-readable): values are left out, and the code says why.
      fs.chmodSync(path.join(homeB, '.dethernety', 'waiver.key'), 0o644)
      await push(['model-this'])
    } finally {
      libHooks.pushBrownfield = null
      process.env.HOME = savedHome
    }
    const [a, b, none] = seen
    const tagA = a!.tag!
    const secret = 's3cr3t-VALUE'
    expect(tagA('api_key', secret)).toMatch(/^[0-9a-f]{32}$/)
    expect(tagA('api_key', secret)).toBe(tagA('api_key', secret))
    expect(tagA('password', secret)).not.toBe(tagA('api_key', secret))
    expect(tagA('k', null)).not.toBe(tagA('k', undefined))
    expect(b!.tag!('api_key', secret)).not.toBe(tagA('api_key', secret))
    // Not a plain hash of the value, nor of the key and the value.
    for (const plain of [JSON.stringify(secret), secret, JSON.stringify(['api_key', 1, secret])]) {
      expect(createHash('sha256').update(plain).digest('hex').startsWith(tagA('api_key', secret))).toBe(false)
    }
    expect(none!.tag).toBeUndefined()
    expect(none!.omittedCode).toBe('key_mode')
    fs.rmSync(homeA, { recursive: true, force: true })
    fs.rmSync(homeB, { recursive: true, force: true })
  })

  it('refuses an empty id list while the pulled control file records other models', async () => {
    mockReadControlFile.mockResolvedValue(file(['model-this', 'model-other']))
    const result = await push([], 'push-anyway')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/records 1 other model\(s\) using this control/)
  })
})

describe('ManageControlsTool.execute — push file-not-found diagnosis', () => {
  const context: ToolContext = { debug: false, apolloClient: {} as never }
  // Under CWD so validatePathConfinement passes; never actually created on
  // disk (lock + WAL pre-dispatch and the file reads are all mocked).
  const dir = './__g8_diag_model__'

  beforeEach(() => {
    mockReadControlFile.mockReset()
    mockListControlFiles.mockReset().mockResolvedValue([])
    mockInspectPendingRewrite
      .mockReset()
      .mockResolvedValue({ present: false, journalPath: '', operations: [] })
    mockAcquireLock.mockReset().mockResolvedValue({} as never)
    mockReleaseLock.mockReset().mockResolvedValue(undefined)
    mockApplyPendingRewrites.mockReset().mockResolvedValue(0)
  })

  it('names the exact platform id when the WAL journal still maps the temp id', async () => {
    mockReadControlFile.mockResolvedValue(null) // temp-id file gone
    mockInspectPendingRewrite.mockResolvedValue({
      present: true,
      journalPath: '',
      verified: true,
      rejected: [],
      operations: [
        {
          kind: 'greenfield-id-rewrite',
          tempId: 'greenfield-xyz',
          serverId: 'uuid-123',
          controlFileRename: { from: '', to: '' },
          fromExists: false,
          toExists: true,
          filePaths: [],
          ambiguous: false,
          createdAt: '',
        },
      ],
    })

    const result = await manageControlsTool.execute(
      { action: 'push-greenfield', directory_path: dir, control_id: 'greenfield-xyz' } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('uuid-123')
    expect(result.error).toContain('resume with control_id: uuid-123')
  })

  it('never names an id from a journal this machine did not write', async () => {
    mockReadControlFile.mockResolvedValue(null)
    mockInspectPendingRewrite.mockResolvedValue({
      present: true,
      journalPath: '',
      verified: false,
      rejected: [],
      operations: [
        {
          kind: 'greenfield-id-rewrite',
          tempId: 'greenfield-xyz',
          serverId: 'victim-control-id',
          controlFileRename: { from: '', to: '' },
          fromExists: false,
          toExists: true,
          filePaths: [],
          ambiguous: false,
          createdAt: '',
        },
      ],
    })

    const result = await manageControlsTool.execute(
      { action: 'push-greenfield', directory_path: dir, control_id: 'greenfield-xyz' } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).not.toContain('victim-control-id')
  })

  it('surfaces partially-pushed controls as resume candidates once the journal is consumed', async () => {
    // The common case: rename succeeded, journal already replayed+deleted, a
    // later push step failed leaving the control at partially-pushed.
    mockReadControlFile.mockImplementation(async (_dir: string, id: string) => {
      if (id === 'greenfield-xyz') return null
      if (id === 'uuid-abc') return { id: 'uuid-abc', lifecycle: 'partially-pushed' } as never
      return { id, lifecycle: 'brownfield' } as never
    })
    mockListControlFiles.mockResolvedValue(['uuid-abc', 'uuid-done'])

    const result = await manageControlsTool.execute(
      { action: 'push-greenfield', directory_path: dir, control_id: 'greenfield-xyz' } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('uuid-abc')
    expect(result.error!.toLowerCase()).toContain('partially-pushed')
    // brownfield controls are not resume candidates
    expect(result.error).not.toContain('uuid-done')
  })

  it('names a deleted class on a partially-pushed control, with the way to finish the push', async () => {
    mockReadControlFile.mockResolvedValue({
      id: 'uuid-abc', name: 'Half-pushed', source: 'declared', lifecycle: 'partially-pushed',
      classes: [
        { classId: 'cc-ok', className: 'Kept', attributes: {} },
        { classId: 'cc-gone', className: 'Deleted class', attributes: { a: 1 } },
      ],
    } as never)
    mockGetClassById.mockReset().mockImplementation(async ({ classId, classType }: { classId: string; classType: string }) =>
      classId === 'cc-ok' && classType === 'control' ? { id: 'cc-ok', name: 'Kept' } : undefined)

    const result = await manageControlsTool.execute(
      { action: 'push-greenfield', directory_path: dir, control_id: 'uuid-abc', supporting_element_ids: [], live_assigned_model_ids: [] } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('controls/uuid-abc.json binds class "cc-gone" ("Deleted class"), which no longer exists on the platform')
    expect(result.error).toContain("remove that class's entry from the classes list in controls/uuid-abc.json")
    expect(result.error).toContain('then run push-greenfield again')
    expect(result.error).not.toContain('class_ids contains')
  })

  it('keeps the plain unknown-class message for a control not yet created', async () => {
    mockReadControlFile.mockResolvedValue({
      id: 'greenfield-xyz', name: 'New', source: 'declared', lifecycle: 'greenfield',
      classes: [{ classId: 'cc-gone', attributes: {} }],
    } as never)
    mockGetClassById.mockReset().mockResolvedValue(undefined)

    const result = await manageControlsTool.execute(
      { action: 'push-greenfield', directory_path: dir, control_id: 'greenfield-xyz', supporting_element_ids: [], live_assigned_model_ids: [] } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('class_ids contains "cc-gone", which does not resolve to any class on the platform')
  })

  it('falls back to the plain not-found message when nothing is resumable', async () => {
    mockReadControlFile.mockResolvedValue(null)
    mockListControlFiles.mockResolvedValue([])

    const result = await manageControlsTool.execute(
      { action: 'push-greenfield', directory_path: dir, control_id: 'greenfield-xyz' } as never,
      context,
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('Control file not found: greenfield-xyz')
  })
})

describe('manage_controls assign — reports actual attachments, not the request', () => {
  beforeEach(() => { mockAssignControlToElements.mockReset() })

  const run = async (elementIds: string[], attached: string[]) => {
    // dt-core broadcasts every id to four type-scoped connect paths; ids that
    // match no path are silently skipped and the mutation still succeeds.
    mockAssignControlToElements.mockResolvedValue({
      id: 'ctrl-1', name: 'WAF',
      elements: attached.map((id) => ({ id })),
    })
    const { manageControlsTool } = await import('../manage-controls.tool.js')
    return manageControlsTool.run(
      { action: 'assign', control_id: 'ctrl-1', element_ids: elementIds },
      { debug: false, apolloClient: {} as never } as ToolContext,
    )
  }

  it('counts only the requested ids the platform actually attached', async () => {
    const res = await run(['c-1', 'c-2', 'c-bogus'], ['c-1', 'c-2'])
    expect(res.success).toBe(true)
    const data = res.data as Record<string, unknown>
    expect(data.requested_elements).toBe(3)
    expect(data.assigned_elements).toBe(2)          // was 3 before the fix
    expect(data.skipped_elements).toEqual(['c-bogus'])
    expect(res.warnings?.[0]).toContain('c-bogus')
  })

  it('counts a data item the platform attached like any other element', async () => {
    const res = await run(['c-1', 'd-cards'], ['c-1', 'd-cards'])
    const data = res.data as Record<string, unknown>
    expect(data.assigned_elements).toBe(2)
    expect(data.skipped_elements).toBeUndefined()
    expect(res.warnings).toBeUndefined()
  })

  it('names the element kinds a control attaches to when it skips an id', async () => {
    const res = await run(['m-1'], [])
    expect(res.warnings?.[0]).toContain('Component, SecurityBoundary, DataFlow and Data elements')
    expect(res.warnings?.[0]).not.toContain('can never attach')
  })

  it('does not count pre-existing attachments from other calls as this call\'s work', async () => {
    // `control.elements` is the control's FULL set after the mutation, so a
    // naive length would report 3 for a 1-element request.
    const res = await run(['c-3'], ['c-1', 'c-2', 'c-3'])
    const data = (res.data as Record<string, unknown>)
    expect(data.requested_elements).toBe(1)
    expect(data.assigned_elements).toBe(1)
    expect(data.skipped_elements).toBeUndefined()
    expect(res.warnings).toBeUndefined()
  })
})
