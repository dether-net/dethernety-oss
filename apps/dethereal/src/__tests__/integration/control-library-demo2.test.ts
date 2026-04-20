/**
 * Control-library end-to-end round-trip against the demo2 fixture
 * (Sprint 3 S3.6).
 *
 * Verifies the full control-library workflow lands correctly against
 * a live platform:
 *   1. pull-controls materialises controls/<id>.json
 *   2. set-local-edited populates pendingEdit + respects the two-write rule
 *   3. push-brownfield on an alone control actually mutates the platform
 *      (verified via re-pull's refreshed platformAttributes)
 *   4. push-brownfield with sharedOwnership: 'cancel' leaves platform untouched
 *   5. Partial-payload contract (DEC-CL-11): editing only key A leaves
 *      platform-side keys B, C unchanged. This is the canonical regression
 *      for the entire design.
 *   6. Re-pulling is idempotent — lastSyncedAt advances, no other state
 *      changes.
 *
 * ENV-GATED — skips silently when either variable is absent (this is the
 * common CI case):
 *   DEMO2_PATH     Absolute path to a demo2 working tree with at least
 *                  two Controls already pushed to the platform (one
 *                  alone, one shared across ≥2 models).
 *   MEMGRAPH_URI   Signals "Memgraph + dt-ws are running locally". Not
 *                  used directly by this test (all access goes through
 *                  the MCP tool's Apollo channel) — acts as the
 *                  developer's explicit acknowledgement that the
 *                  platform is up. Pair with `pnpm dev` on dt-ws.
 *
 * Additional expected env (not explicitly gated so the skip message
 * makes sense when MEMGRAPH_URI is set but these are missing):
 *   DETHERNETY_URL    dt-ws base URL (default http://localhost:3003)
 *   DEMO2_RESET_SHA   Git SHA demo2 will be reset to at beforeAll.
 *                     Defaults to HEAD (no-op reset). Strongly
 *                     recommended to pin for deterministic tests.
 *   DEMO2_ALONE_ID    Control id that is only assigned to this model
 *                     (used by tests 2–3, 5 — the alone edit path).
 *   DEMO2_SHARED_ID   Control id assigned to ≥2 models (test 4 —
 *                     the 'cancel' path).
 *   DEMO2_CLASS_ID    Class id inside DEMO2_ALONE_ID's classes[] used
 *                     for the set-local-edited tests.
 *   DEMO2_THIS_MODEL_ID
 *                     manifest.model.id for the demo2 working tree.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import { readControlFile } from '@dethernety/dt-core'
import { manageControlsTool } from '../../tools/manage-controls.tool.js'
import type { ToolContext } from '../../tools/base-tool.js'
import { fetchPlatformConfig } from '../../auth/platform-config.js'
import { createApolloClient } from '../../client/apollo-client.js'
import { loadStoredTokens, isTokenExpired } from '../../auth/token-store.js'

const DEMO2_PATH = process.env.DEMO2_PATH
const MEMGRAPH_URI = process.env.MEMGRAPH_URI
const DEMO2_RESET_SHA = process.env.DEMO2_RESET_SHA // optional
const ALONE_ID = process.env.DEMO2_ALONE_ID
const SHARED_ID = process.env.DEMO2_SHARED_ID
const CLASS_ID = process.env.DEMO2_CLASS_ID
const THIS_MODEL_ID = process.env.DEMO2_THIS_MODEL_ID
const PLATFORM_URL = process.env.DETHERNETY_URL || 'http://localhost:3003'

const shouldRun = !!(DEMO2_PATH && MEMGRAPH_URI)

describe.skipIf(!shouldRun)('control-library demo2 round-trip (S3.6)', () => {
  let ctx: ToolContext
  let savedSha: string | undefined

  beforeAll(async () => {
    if (!ALONE_ID || !SHARED_ID || !CLASS_ID || !THIS_MODEL_ID) {
      throw new Error(
        'DEMO2_PATH + MEMGRAPH_URI are set but the fixture ids are not. ' +
        'Set DEMO2_ALONE_ID, DEMO2_SHARED_ID, DEMO2_CLASS_ID, DEMO2_THIS_MODEL_ID.',
      )
    }

    // Snapshot current HEAD so we can restore after the test run.
    try {
      savedSha = execSync('git rev-parse HEAD', {
        cwd: DEMO2_PATH,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      // Not a git checkout — skip reset/restore semantics.
      savedSha = undefined
    }

    if (savedSha && DEMO2_RESET_SHA) {
      execSync(`git checkout ${DEMO2_RESET_SHA}`, { cwd: DEMO2_PATH, stdio: 'inherit' })
    }

    // Bootstrap the Apollo client via the same path the MCP server uses.
    await fetchPlatformConfig(PLATFORM_URL)
    const stored = await loadStoredTokens(PLATFORM_URL).catch(() => null)
    const token = stored && !isTokenExpired(stored) ? stored.idToken : undefined
    const apolloClient = createApolloClient(token)
    ctx = { apolloClient, debug: false }
  }, 60_000)

  afterAll(() => {
    // Restore the demo2 working tree to whatever SHA the developer had
    // before invoking us (only if we observed a git checkout).
    if (DEMO2_PATH && savedSha) {
      try {
        execSync(`git checkout ${savedSha}`, { cwd: DEMO2_PATH, stdio: 'inherit' })
      } catch {
        // Developer will notice on their next git status — we are a test,
        // not a VCS tool.
      }
    }
  })

  // ────────────────────────────────────────────────────────────────────
  // Test 1 — pull-controls materialises well-formed files
  // ────────────────────────────────────────────────────────────────────
  it('pull-controls materialises brownfield controls/<id>.json', async () => {
    const result = await manageControlsTool.execute(
      {
        action: 'pull-controls',
        directory_path: DEMO2_PATH!,
        control_ids: [ALONE_ID!, SHARED_ID!],
      } as any,
      ctx,
    )
    expect(result.success).toBe(true)

    const alone = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    expect(alone).not.toBeNull()
    expect(alone!.lifecycle).toBe('brownfield')
    expect(alone!.platformState?.lastSyncedAt).toBeTruthy()

    const aloneClass = alone!.classes.find(c => c.classId === CLASS_ID)
    expect(aloneClass).toBeDefined()
    // After a clean pull, attributes == platformAttributes and no pendingEdit.
    expect(aloneClass!.pendingEdit).toBeUndefined()
    expect(aloneClass!.attributes).toEqual(aloneClass!.platformAttributes)
  }, 30_000)

  // ────────────────────────────────────────────────────────────────────
  // Test 2 — set-local-edited enforces the two-write rule
  // ────────────────────────────────────────────────────────────────────
  it('set-local-edited populates pendingEdit and preserves FIRST pre-edit value across repeats', async () => {
    const before = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    const classIdx = before!.classes.findIndex(c => c.classId === CLASS_ID)
    const testKey = '__s3_test_key__'
    const originalValue = before!.classes[classIdx].attributes[testKey] ?? 'origin'

    // First edit — pendingEdit.previousAttributes[testKey] captures origin.
    const firstEdit = await manageControlsTool.execute(
      {
        action: 'set-local-edited',
        directory_path: DEMO2_PATH!,
        control_id: ALONE_ID!,
        class_idx: classIdx,
        new_attributes: { [testKey]: 'first' },
        edited_by: 'agent',
      } as any,
      ctx,
    )
    expect(firstEdit.success).toBe(true)
    const afterFirst = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    expect(afterFirst!.classes[classIdx].pendingEdit).toBeDefined()
    expect(
      afterFirst!.classes[classIdx].pendingEdit!.previousAttributes[testKey],
    ).toEqual(originalValue)
    expect(afterFirst!.classes[classIdx].attributes[testKey]).toBe('first')

    // Second edit on the same key — two-write rule: previousAttributes[testKey]
    // MUST still hold the FIRST pre-edit value, not the intermediate one.
    await manageControlsTool.execute(
      {
        action: 'set-local-edited',
        directory_path: DEMO2_PATH!,
        control_id: ALONE_ID!,
        class_idx: classIdx,
        new_attributes: { [testKey]: 'second' },
        edited_by: 'agent',
      } as any,
      ctx,
    )
    const afterSecond = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    expect(
      afterSecond!.classes[classIdx].pendingEdit!.previousAttributes[testKey],
    ).toEqual(originalValue)
    expect(afterSecond!.classes[classIdx].attributes[testKey]).toBe('second')
  }, 20_000)

  // ────────────────────────────────────────────────────────────────────
  // Test 3 — push-brownfield (alone, push-anyway) lands the edit on the platform
  // ────────────────────────────────────────────────────────────────────
  it('push-brownfield on an alone control writes attributes + clears pendingEdit', async () => {
    const before = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    const classIdx = before!.classes.findIndex(c => c.classId === CLASS_ID)
    const freshPlatformAttrs = { [CLASS_ID!]: before!.classes[classIdx].platformAttributes ?? {} }

    const result = await manageControlsTool.execute(
      {
        action: 'push-brownfield',
        directory_path: DEMO2_PATH!,
        control_id: ALONE_ID!,
        decision: { sharedOwnership: 'push-anyway' },
        fresh_platform_attrs: freshPlatformAttrs,
        live_assigned_model_ids: before!.platformState?.assignedModelIds ?? [THIS_MODEL_ID!],
        this_model_id: THIS_MODEL_ID!,
      } as any,
      ctx,
    )
    expect(result.success).toBe(true)
    const data = (result.data ?? {}) as { mutated?: boolean }
    expect(data.mutated).toBe(true)

    const after = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    expect(after!.classes[classIdx].pendingEdit).toBeUndefined()
    expect(after!.classes[classIdx].pushedAt).toBeTruthy()
    expect(after!.classes[classIdx].platformAttributes?.['__s3_test_key__']).toBe('second')
  }, 30_000)

  // ────────────────────────────────────────────────────────────────────
  // Test 4 — push-brownfield with cancel on a shared control is a no-op
  // ────────────────────────────────────────────────────────────────────
  it('push-brownfield sharedOwnership=cancel on a shared control leaves file + platform untouched', async () => {
    // Seed a pendingEdit on the shared control so the method has something
    // to Step-0-check against.
    const sharedBefore = await readControlFile(DEMO2_PATH!, SHARED_ID!)
    const sharedClassIdx = sharedBefore!.classes.findIndex(c => !!c.classId)
    expect(sharedClassIdx).toBeGreaterThanOrEqual(0)

    await manageControlsTool.execute(
      {
        action: 'set-local-edited',
        directory_path: DEMO2_PATH!,
        control_id: SHARED_ID!,
        class_idx: sharedClassIdx,
        new_attributes: { __s3_cancel_probe__: Date.now() },
        edited_by: 'agent',
      } as any,
      ctx,
    )

    const seeded = await readControlFile(DEMO2_PATH!, SHARED_ID!)
    const seededClassId = seeded!.classes[sharedClassIdx].classId
    const snapshot = JSON.stringify(seeded!.classes[sharedClassIdx])

    const freshPlatformAttrs = {
      [seededClassId]: seeded!.classes[sharedClassIdx].platformAttributes ?? {},
    }

    const result = await manageControlsTool.execute(
      {
        action: 'push-brownfield',
        directory_path: DEMO2_PATH!,
        control_id: SHARED_ID!,
        decision: { sharedOwnership: 'cancel' },
        fresh_platform_attrs: freshPlatformAttrs,
        live_assigned_model_ids: seeded!.platformState?.assignedModelIds ?? [
          THIS_MODEL_ID!,
          'other-model',
        ],
        this_model_id: THIS_MODEL_ID!,
      } as any,
      ctx,
    )
    expect(result.success).toBe(true)
    const data = (result.data ?? {}) as { mutated?: boolean }
    expect(data.mutated).toBe(false)

    const after = await readControlFile(DEMO2_PATH!, SHARED_ID!)
    expect(JSON.stringify(after!.classes[sharedClassIdx])).toEqual(snapshot)
  }, 30_000)

  // ────────────────────────────────────────────────────────────────────
  // Test 5 — canonical DEC-CL-11 partial-payload regression
  // Editing only key A leaves platform-side keys B, C unchanged.
  // ────────────────────────────────────────────────────────────────────
  it('push-brownfield partial-payload does NOT touch unlisted platform keys (DEC-CL-11)', async () => {
    // Re-pull for a clean baseline.
    await manageControlsTool.execute(
      {
        action: 'pull-controls',
        directory_path: DEMO2_PATH!,
        control_ids: [ALONE_ID!],
      } as any,
      ctx,
    )

    const baseline = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    const classIdx = baseline!.classes.findIndex(c => c.classId === CLASS_ID)
    const baselinePlatformAttrs = { ...baseline!.classes[classIdx].platformAttributes! }

    // Plant two "other" keys on the platform so we have something to
    // observe the partial-payload guarantee against.
    await manageControlsTool.execute(
      {
        action: 'set-local-edited',
        directory_path: DEMO2_PATH!,
        control_id: ALONE_ID!,
        class_idx: classIdx,
        new_attributes: {
          __dec_cl_11_B__: 'untouched_B',
          __dec_cl_11_C__: 'untouched_C',
        },
        edited_by: 'agent',
      } as any,
      ctx,
    )
    const planted = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    const plantedFresh = { [CLASS_ID!]: planted!.classes[classIdx].platformAttributes! }
    await manageControlsTool.execute(
      {
        action: 'push-brownfield',
        directory_path: DEMO2_PATH!,
        control_id: ALONE_ID!,
        decision: { sharedOwnership: 'push-anyway' },
        fresh_platform_attrs: plantedFresh,
        live_assigned_model_ids: planted!.platformState?.assignedModelIds ?? [THIS_MODEL_ID!],
        this_model_id: THIS_MODEL_ID!,
      } as any,
      ctx,
    )

    // Now edit ONLY key A. Keys B and C must remain untouched server-side.
    await manageControlsTool.execute(
      {
        action: 'set-local-edited',
        directory_path: DEMO2_PATH!,
        control_id: ALONE_ID!,
        class_idx: classIdx,
        new_attributes: { __dec_cl_11_A__: 'edited_A' },
        edited_by: 'agent',
      } as any,
      ctx,
    )
    const withA = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    const withAFresh = { [CLASS_ID!]: withA!.classes[classIdx].platformAttributes! }
    await manageControlsTool.execute(
      {
        action: 'push-brownfield',
        directory_path: DEMO2_PATH!,
        control_id: ALONE_ID!,
        decision: { sharedOwnership: 'push-anyway' },
        fresh_platform_attrs: withAFresh,
        live_assigned_model_ids: withA!.platformState?.assignedModelIds ?? [THIS_MODEL_ID!],
        this_model_id: THIS_MODEL_ID!,
      } as any,
      ctx,
    )

    // Re-pull to observe fresh platform state.
    await manageControlsTool.execute(
      {
        action: 'pull-controls',
        directory_path: DEMO2_PATH!,
        control_ids: [ALONE_ID!],
      } as any,
      ctx,
    )
    const final = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    const finalPlatform = final!.classes[classIdx].platformAttributes ?? {}

    expect(finalPlatform['__dec_cl_11_A__']).toBe('edited_A')
    expect(finalPlatform['__dec_cl_11_B__']).toBe('untouched_B')
    expect(finalPlatform['__dec_cl_11_C__']).toBe('untouched_C')

    // And the baseline keys that existed before our test are all still there.
    for (const [k, v] of Object.entries(baselinePlatformAttrs)) {
      expect(finalPlatform[k]).toEqual(v)
    }
  }, 60_000)

  // ────────────────────────────────────────────────────────────────────
  // Test 6 — re-pulling is idempotent
  // ────────────────────────────────────────────────────────────────────
  it('re-pull advances lastSyncedAt but otherwise leaves local state untouched', async () => {
    const first = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    const firstSynced = first!.platformState!.lastSyncedAt as string
    const firstAttrsSnapshot = JSON.stringify(
      first!.classes.map(c => ({ classId: c.classId, attributes: c.attributes })),
    )

    // Small delay to guarantee a distinct ISO timestamp.
    await new Promise(r => setTimeout(r, 25))

    await manageControlsTool.execute(
      {
        action: 'pull-controls',
        directory_path: DEMO2_PATH!,
        control_ids: [ALONE_ID!],
      } as any,
      ctx,
    )
    const second = await readControlFile(DEMO2_PATH!, ALONE_ID!)
    const secondSynced = second!.platformState!.lastSyncedAt as string
    const secondAttrsSnapshot = JSON.stringify(
      second!.classes.map(c => ({ classId: c.classId, attributes: c.attributes })),
    )

    expect(secondSynced > firstSynced).toBe(true)
    expect(secondAttrsSnapshot).toEqual(firstAttrsSnapshot)
  }, 30_000)
})

// Keep fs/join imports used even in the skipIf branch so the linter
// does not strip them before the describe block runs.
void fs
void join
