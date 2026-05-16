import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { ToolContext } from '../base-tool.js'

// Stub @dethernety/dt-core's DtClass so we can drive matchClasses' return
// shape — including the new `vectorAvailable` flag — without spinning up Apollo.
const { mockMatchClasses } = vi.hoisted(() => ({ mockMatchClasses: vi.fn() }))

vi.mock('@dethernety/dt-core', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    DtClass: class MockDtClass {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
      constructor(_apolloClient: any) {}
      matchClasses = mockMatchClasses
    },
  }
})

import { matchClassesTool } from '../match-classes.tool.js'

describe('MatchClassesTool', () => {
  it('should have the correct tool name', () => {
    expect(matchClassesTool.name).toBe('match_classes')
  })

  it('should require a client', () => {
    expect(matchClassesTool.requiresClient).toBe(true)
  })

  it('should accept valid input with required fields', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'Web Application Firewall' }],
      classLabel: 'CONTROL',
    })
    expect(result.success).toBe(true)
  })

  it('should accept elements with optional type and description', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'API Gateway', type: 'PROCESS', description: 'REST API entry point' }],
      classLabel: 'COMPONENT',
    })
    expect(result.success).toBe(true)
  })

  it('should reject empty elements array', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [],
      classLabel: 'COMPONENT',
    })
    expect(result.success).toBe(false)
  })

  it('should reject elements array exceeding max 100', () => {
    const elements = Array.from({ length: 101 }, (_, i) => ({ name: `Element ${i}` }))
    const result = matchClassesTool.inputSchema.safeParse({
      elements,
      classLabel: 'COMPONENT',
    })
    expect(result.success).toBe(false)
  })

  it('should accept optional componentType for COMPONENT classLabel', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'DB' }],
      classLabel: 'COMPONENT',
      componentType: 'STORE',
    })
    expect(result.success).toBe(true)
  })

  it('should accept all valid classLabel values', () => {
    for (const label of ['COMPONENT', 'SECURITY_BOUNDARY', 'DATA_FLOW', 'DATA', 'CONTROL']) {
      const result = matchClassesTool.inputSchema.safeParse({
        elements: [{ name: 'Test' }],
        classLabel: label,
      })
      expect(result.success).toBe(true)
    }
  })

  it('should reject invalid classLabel', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'Test' }],
      classLabel: 'INVALID',
    })
    expect(result.success).toBe(false)
  })

  it('should default topN to 3', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'DB' }],
      classLabel: 'COMPONENT',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.topN).toBe(3)
    }
  })

  it('should reject topN > 10', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'DB' }],
      classLabel: 'COMPONENT',
      topN: 15,
    })
    expect(result.success).toBe(false)
  })

  it('should accept optional moduleIds', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'DB' }],
      classLabel: 'COMPONENT',
      moduleIds: ['mod-1', 'mod-2'],
    })
    expect(result.success).toBe(true)
  })

  it('should accept optional fields filter', () => {
    const result = matchClassesTool.inputSchema.safeParse({
      elements: [{ name: 'DB' }],
      classLabel: 'COMPONENT',
      fields: ['description', 'category'],
    })
    expect(result.success).toBe(true)
  })
})

describe('MatchClassesTool.execute', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contextWithClient: ToolContext = { debug: false, apolloClient: {} as any }
  const contextWithoutClient: ToolContext = { debug: false }

  const sampleCandidate = {
    classId: 'cls-1',
    className: 'AuthService',
    moduleName: 'dethernety-module',
    matchType: 'exact_name',
    confidence: 'high',
  }

  beforeEach(() => {
    mockMatchClasses.mockReset()
  })

  it('surfaces vector_search_available: true and omits clarification when DtClass reports vectorAvailable=true', async () => {
    mockMatchClasses.mockResolvedValueOnce({
      matches: [{ elementName: 'auth-service', candidates: [sampleCandidate] }],
      unmatched: [],
      vectorAvailable: true,
    })

    const result = await matchClassesTool.execute(
      { elements: [{ name: 'auth-service' }], classLabel: 'COMPONENT', topN: 3 },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    const data = result.data!
    expect(data.vector_search_available).toBe(true)
    expect(data.clarification).toBeUndefined()
    expect(data.matches).toHaveLength(1)
    // Confirm the camelCase signal is NOT also leaked through (one canonical spelling).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((data as any).vectorAvailable).toBeUndefined()
  })

  it('surfaces vector_search_available: false and appends the spec clarification when vectorAvailable=false', async () => {
    mockMatchClasses.mockResolvedValueOnce({
      matches: [],
      unmatched: ['unknown-thing'],
      vectorAvailable: false,
    })

    const result = await matchClassesTool.execute(
      { elements: [{ name: 'unknown-thing' }], classLabel: 'COMPONENT', topN: 3 },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    const data = result.data!
    expect(data.vector_search_available).toBe(false)
    expect(data.clarification).toBe(
      'Semantic (vector) search is not available on this deployment; results are name- and type-based only.',
    )
  })

  it('preserves total_elements / matched_count / unmatched_count alongside the new field', async () => {
    mockMatchClasses.mockResolvedValueOnce({
      matches: [
        { elementName: 'a', candidates: [sampleCandidate] },
        { elementName: 'b', candidates: [sampleCandidate] },
      ],
      unmatched: ['c'],
      vectorAvailable: true,
    })

    const result = await matchClassesTool.execute(
      {
        elements: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        classLabel: 'COMPONENT',
        topN: 3,
      },
      contextWithClient,
    )

    expect(result.success).toBe(true)
    const data = result.data!
    expect(data.total_elements).toBe(3)
    expect(data.matched_count).toBe(2)
    expect(data.unmatched_count).toBe(1)
    expect(data.vector_search_available).toBe(true)
  })

  it('returns success: false when context.apolloClient is absent (no DtClass call made)', async () => {
    const result = await matchClassesTool.execute(
      { elements: [{ name: 'x' }], classLabel: 'COMPONENT', topN: 3 },
      contextWithoutClient,
    )

    expect(result.success).toBe(false)
    expect(mockMatchClasses).not.toHaveBeenCalled()
  })
})
