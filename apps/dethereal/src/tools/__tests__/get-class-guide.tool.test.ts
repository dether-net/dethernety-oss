/**
 * get_class_guide: the filter to the requested keys, the security impact that never leaves the tool, the uniform
 * "no guidance" answers, the document chosen by element kind, and a failed read as a tool failure.
 */
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { CombinedGraphQLErrors } from '@apollo/client'
import type { ToolContext } from '../base-tool.js'
import { registerSecret } from '../../auth/redact.js'
import { GUIDE_QUERY_BY_KIND, filterGuideEntries, getClassGuideTool, type GetClassGuideOutput } from '../get-class-guide.tool.js'

const authoredEntry = {
  option_name: 'audit_log_tamper_evident',
  option_description: 'Whether indexed events are tamper-evident.',
  security_impact: 'One of the triggers for the exposure "Log tampering"; MUST NEVER LEAVE THE TOOL.',
  how_to_obtain: [
    {
      type: 'config_file',
      instruction: 'Grep indexes.conf for the per-index data-integrity control.',
      command: "grep -R 'enableDataIntegrityControl' $SPLUNK_HOME/etc/",
      expectedOutput: 'enableDataIntegrityControl=true',
    },
    { type: 'manual', instruction: 'Confirm WORM/append-only storage on the audit index.' },
  ],
  value_type: 'boolean',
  typical_values: [true, false],
}

const otherEntry = {
  option_name: 'retention_days',
  how_to_obtain: [{ instruction: 'Read the retention policy.', expected_output: '90', source: 'policy.md' }],
}

type QueryFn = (options: { query: unknown; variables?: Record<string, unknown> }) => Promise<unknown>
const contextWith = (query: QueryFn): ToolContext => ({ apolloClient: { query } as never, debug: false })

describe('filterGuideEntries', () => {
  it('keeps the requested keys and maps each entry', () => {
    const entries = filterGuideEntries(JSON.stringify([authoredEntry, otherEntry]), ['audit_log_tamper_evident'])
    expect(entries).toEqual([
      {
        optionName: 'audit_log_tamper_evident',
        optionDescription: 'Whether indexed events are tamper-evident.',
        valueType: 'boolean',
        typicalValues: [true, false],
        howToObtain: [
          {
            type: 'config_file',
            instruction: 'Grep indexes.conf for the per-index data-integrity control.',
            command: "grep -R 'enableDataIntegrityControl' $SPLUNK_HOME/etc/",
            expectedOutput: 'enableDataIntegrityControl=true',
          },
          { type: 'manual', instruction: 'Confirm WORM/append-only storage on the audit index.' },
        ],
      },
    ])
  })

  it('never copies the security impact', () => {
    const serialized = JSON.stringify(filterGuideEntries(JSON.stringify([authoredEntry]), ['audit_log_tamper_evident']))
    expect(serialized).not.toContain('security_impact')
    expect(serialized).not.toContain('securityImpact')
    expect(serialized).not.toContain('MUST NEVER LEAVE THE TOOL')
  })

  it('a step without a type is manual; expected_output is read as expectedOutput', () => {
    expect(filterGuideEntries([otherEntry], ['retention_days'])).toEqual([
      { optionName: 'retention_days', howToObtain: [{ type: 'manual', instruction: 'Read the retention policy.', expectedOutput: '90', source: 'policy.md' }] },
    ])
  })

  it('unmatched keys, a malformed guide and a guide that is not a list all give no entries', () => {
    expect(filterGuideEntries(JSON.stringify([authoredEntry]), ['some_other_key'])).toEqual([])
    expect(filterGuideEntries('{"broken', ['x'])).toEqual([])
    expect(filterGuideEntries(JSON.stringify({ fallback: true }), ['x'])).toEqual([])
    expect(filterGuideEntries(null, ['x'])).toEqual([])
    expect(filterGuideEntries(undefined, ['x'])).toEqual([])
    expect(filterGuideEntries(JSON.stringify([null, 'x', 3, { option_name: 7 }]), ['x'])).toEqual([])
  })

  it('an entry with no usable step is no guidance', () => {
    expect(filterGuideEntries(JSON.stringify([{ option_name: 'x', how_to_obtain: [] }]), ['x'])).toEqual([])
    expect(filterGuideEntries(JSON.stringify([{ option_name: 'x', how_to_obtain: [{ type: 'manual' }, 'not-a-step', null, { instruction: '' }] }]), ['x'])).toEqual([])
    expect(filterGuideEntries(JSON.stringify([{ option_name: 'x', how_to_obtain: 'read it' }]), ['x'])).toEqual([])
  })
})

describe('get_class_guide', () => {
  it('asks the document for the element kind, by class id, and filters its guide', async () => {
    for (const [kind, { query: doc, field }] of Object.entries(GUIDE_QUERY_BY_KIND)) {
      const query = vi.fn<QueryFn>(async () => ({ data: { [field]: [{ guide: JSON.stringify([authoredEntry, otherEntry]) }] } }))
      const r = await getClassGuideTool.run({ class_id: 'cls-1', element_kind: kind, attribute_keys: ['retention_days'] }, contextWith(query))
      expect(query).toHaveBeenCalledWith({ query: doc, variables: { id: 'cls-1' } })
      expect(r.success).toBe(true)
      expect((r.data as GetClassGuideOutput).entries.map((e) => e.optionName)).toEqual(['retention_days'])
    }
  })

  it('a class that does not exist, or has no guide, gives no entries', async () => {
    const none = await getClassGuideTool.run(
      { class_id: 'missing', element_kind: 'component', attribute_keys: ['x'] },
      contextWith(async () => ({ data: { componentClasses: [] } })),
    )
    expect(none).toEqual({ success: true, data: { entries: [] } })
    const empty = await getClassGuideTool.run(
      { class_id: 'c', element_kind: 'dataItem', attribute_keys: ['x'] },
      contextWith(async () => ({ data: { dataClasses: [{ guide: null }] } })),
    )
    expect(empty).toEqual({ success: true, data: { entries: [] } })
  })

  it('a failed read is a tool failure with the redacted message and code', async () => {
    const secret = 'guide-test-bearer-0123456789abcdef'
    registerSecret(secret)
    const r = await getClassGuideTool.run(
      { class_id: 'c', element_kind: 'component', attribute_keys: ['x'] },
      contextWith(async () => {
        throw new CombinedGraphQLErrors({ errors: [{ message: `boom ${secret}`, extensions: { code: 'INTERNAL_SERVER_ERROR' } }] })
      }),
    )
    expect(r.success).toBe(false)
    expect(r.error).toContain('the class guide read failed:')
    expect(r.error).toContain('(INTERNAL_SERVER_ERROR)')
    expect(r.error).not.toContain(secret)
  })

  it('a refused session points at the login tool', async () => {
    const r = await getClassGuideTool.run(
      { class_id: 'c', element_kind: 'component', attribute_keys: ['x'] },
      contextWith(async () => {
        throw new CombinedGraphQLErrors({ errors: [{ message: 'Unauthorized', extensions: { code: 'UNAUTHENTICATED' } }] })
      }),
    )
    expect(r).toEqual({ success: false, error: 'the platform refused this session. Call the "login" tool, then retry.' })
  })

  it('refuses an unknown key, a malformed class id, an unknown kind and an empty, over-long or oversized key list', async () => {
    const ctx = contextWith(async () => ({ data: {} }))
    const base = { class_id: 'c', element_kind: 'component', attribute_keys: ['x'] }
    for (const input of [
      { ...base, extra: true },
      { ...base, class_id: 'a/b' },
      { ...base, element_kind: 'model' },
      { ...base, attribute_keys: [] },
      { ...base, attribute_keys: ['k'.repeat(201)] },
      { ...base, attribute_keys: Array.from({ length: 101 }, (_, i) => `k${i}`) },
      { class_id: 'c', element_kind: 'component' },
    ]) {
      expect((await getClassGuideTool.run(input, ctx)).success).toBe(false)
    }
  })

  it('advertises the three inputs, all required', () => {
    const schema = z.toJSONSchema(getClassGuideTool.inputSchema, { target: 'draft-07' }) as { required: string[]; properties: Record<string, unknown> }
    expect(schema.required.sort()).toEqual(['attribute_keys', 'class_id', 'element_kind'])
    expect(schema.properties.element_kind).toMatchObject({ enum: ['component', 'securityBoundary', 'dataFlow', 'dataItem'] })
  })
})
