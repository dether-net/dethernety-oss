import { describe, it, expect } from 'vitest'
import {
  parseSearchQuery,
  buildRemoteFilterParams,
  applyLocalFiltering,
  validateSearchQuery,
  findUnrecognizedRemoteKeys,
} from '../issueSearchUtils'

describe('parseSearchQuery', () => {
  it('should return empty result for empty query', () => {
    const result = parseSearchQuery('')
    expect(result.remoteConditions).toHaveLength(0)
    expect(result.localGroups).toHaveLength(0)
  })

  it('should return empty result for whitespace query', () => {
    const result = parseSearchQuery('   ')
    expect(result.remoteConditions).toHaveLength(0)
    expect(result.localGroups).toHaveLength(0)
  })

  it('should parse remote key:value conditions', () => {
    const result = parseSearchQuery('name:SQL classType:exposure')
    expect(result.remoteConditions).toHaveLength(2)
    expect(result.remoteConditions[0]).toEqual({ key: 'name', value: 'SQL' })
    expect(result.remoteConditions[1]).toEqual({ key: 'classType', value: 'exposure' })
  })

  it('should ignore unknown remote keys', () => {
    const result = parseSearchQuery('unknownKey:value name:test')
    expect(result.remoteConditions).toHaveLength(1)
    expect(result.remoteConditions[0].key).toBe('name')
  })

  it('should parse local groups in parentheses with AND', () => {
    const result = parseSearchQuery('(type:threat AND category:spoofing)')
    expect(result.localGroups).toHaveLength(1)
    expect(result.localGroups[0].operator).toBe('AND')
    expect(result.localGroups[0].conditions).toHaveLength(2)
  })

  it('should parse local groups with OR operator', () => {
    const result = parseSearchQuery('(type:threat OR type:vulnerability)')
    expect(result.localGroups).toHaveLength(1)
    expect(result.localGroups[0].operator).toBe('OR')
    expect(result.localGroups[0].conditions).toHaveLength(2)
  })

  it('should handle mixed remote and local conditions', () => {
    const result = parseSearchQuery('name:test (type:threat AND category:dos)')
    expect(result.remoteConditions).toHaveLength(1)
    expect(result.remoteConditions[0]).toEqual({ key: 'name', value: 'test' })
    expect(result.localGroups).toHaveLength(1)
  })

  it('should parse an unquoted remote value (the help-text form)', () => {
    const result = parseSearchQuery('issueStatus:open')
    expect(result.remoteConditions).toHaveLength(1)
    expect(result.remoteConditions[0]).toEqual({ key: 'issueStatus', value: 'open' })
  })

  it('should parse separate top-level groups as distinct local groups', () => {
    const result = parseSearchQuery('(status:"open") (severity:"high" OR severity:"low")')
    expect(result.localGroups).toHaveLength(2)
    // Quoted local values carry the quoted flag so they match exactly downstream.
    expect(result.localGroups[0].conditions).toEqual([{ key: 'status', value: 'open', quoted: true }])
    expect(result.localGroups[1].operator).toBe('OR')
    expect(result.localGroups[1].conditions).toHaveLength(2)
  })

  it('flags a quoted local value as quoted and an unquoted one as not', () => {
    const quoted = parseSearchQuery('(likelihood:"low")')
    expect(quoted.localGroups[0].conditions).toEqual([{ key: 'likelihood', value: 'low', quoted: true }])
    const unquoted = parseSearchQuery('(likelihood:low)')
    expect(unquoted.localGroups[0].conditions).toEqual([{ key: 'likelihood', value: 'low', quoted: false }])
  })

  it('should not truncate a remote value containing an apostrophe', () => {
    // The old [^'"] value class stopped at the first quote (name:O'Brien -> "O").
    const result = parseSearchQuery("name:O'Brien")
    expect(result.remoteConditions).toEqual([{ key: 'name', value: "O'Brien" }])
  })

  it('should parse a double-quoted multi-word remote value alongside another key', () => {
    const result = parseSearchQuery('name:"Security Issue" classId:abc')
    expect(result.remoteConditions).toEqual([
      { key: 'name', value: 'Security Issue' },
      { key: 'classId', value: 'abc' },
    ])
  })

  it('should preserve an unquoted multi-word remote value up to the next key', () => {
    const result = parseSearchQuery('name:SQL Injection classType:exposure')
    expect(result.remoteConditions).toEqual([
      { key: 'name', value: 'SQL Injection' },
      { key: 'classType', value: 'exposure' },
    ])
  })
})

describe('buildRemoteFilterParams', () => {
  it('should map conditions to filter params', () => {
    const params = buildRemoteFilterParams([
      { key: 'name', value: 'SQL Injection' },
      { key: 'issueStatus', value: 'open' },
    ])
    expect(params.name).toBe('SQL Injection')
    expect(params.issueStatus).toBe('open')
  })

  it('should split elementIds by comma', () => {
    const params = buildRemoteFilterParams([{ key: 'elementIds', value: 'id1, id2, id3' }])
    expect(params.elementIds).toEqual(['id1', 'id2', 'id3'])
  })

  it('should reject invalid issueStatus values', () => {
    const params = buildRemoteFilterParams([{ key: 'issueStatus', value: 'invalid' }])
    expect(params.issueStatus).toBeUndefined()
  })

  it('should accept closed issueStatus', () => {
    const params = buildRemoteFilterParams([{ key: 'issueStatus', value: 'closed' }])
    expect(params.issueStatus).toBe('closed')
  })

  it('should lowercase issueStatus values (case-insensitive)', () => {
    const params = buildRemoteFilterParams([{ key: 'issueStatus', value: 'OPEN' }])
    expect(params.issueStatus).toBe('open')
  })

  it('should handle all known keys', () => {
    const params = buildRemoteFilterParams([
      { key: 'name', value: 'test' },
      { key: 'issueId', value: 'id-1' },
      { key: 'classId', value: 'cls-1' },
      { key: 'classType', value: 'exposure' },
      { key: 'moduleId', value: 'mod-1' },
      { key: 'moduleName', value: 'my-module' },
    ])
    expect(params.name).toBe('test')
    expect(params.issueId).toBe('id-1')
    expect(params.classId).toBe('cls-1')
    expect(params.classType).toBe('exposure')
    expect(params.moduleId).toBe('mod-1')
    expect(params.moduleName).toBe('my-module')
  })

  // The last condition for a duplicated remote key wins (params is an object,
  // assigned per condition). The issues page relies on this: effectiveQuery
  // appends the structured filters AFTER the user's typed text, so a structured
  // Issue-Status filter overrides a same-key value the user typed.
  it('lets the last condition win for a duplicated remote key', () => {
    const params = buildRemoteFilterParams([
      { key: 'issueStatus', value: 'closed' },
      { key: 'issueStatus', value: 'open' },
    ])
    expect(params.issueStatus).toBe('open')
  })
})

describe('applyLocalFiltering', () => {
  const mockIssues = [
    {
      id: '1',
      name: 'SQL Injection',
      type: 'threat',
      category: 'injection',
      issueClass: { name: 'SQLi' },
      syncedAttributes: { severity: 'high' },
    },
    {
      id: '2',
      name: 'XSS',
      type: 'vulnerability',
      category: 'injection',
      issueClass: { name: 'XSS' },
      syncedAttributes: { severity: 'medium' },
    },
    {
      id: '3',
      name: 'DoS',
      type: 'threat',
      category: 'availability',
      issueClass: { name: 'DoS' },
      syncedAttributes: { severity: 'low' },
    },
  ] as any[]

  it('should return all issues when no groups', () => {
    expect(applyLocalFiltering(mockIssues, [])).toHaveLength(3)
  })

  it('should filter with AND conditions', () => {
    const filtered = applyLocalFiltering(mockIssues, [
      {
        operator: 'AND',
        conditions: [
          { key: 'type', value: 'threat' },
          { key: 'category', value: 'injection' },
        ],
      },
    ])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe('SQL Injection')
  })

  it('should filter with OR conditions', () => {
    const filtered = applyLocalFiltering(mockIssues, [
      {
        operator: 'OR',
        conditions: [
          { key: 'name', value: 'sql' },
          { key: 'name', value: 'dos' },
        ],
      },
    ])
    expect(filtered).toHaveLength(2)
  })

  it('should support deep search in syncedAttributes', () => {
    const filtered = applyLocalFiltering(mockIssues, [
      {
        operator: 'AND',
        conditions: [{ key: 'severity', value: 'high' }],
      },
    ])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe('SQL Injection')
  })

  it('should support nested class property access', () => {
    const filtered = applyLocalFiltering(mockIssues, [
      {
        operator: 'AND',
        conditions: [{ key: 'class.name', value: 'sqli' }],
      },
    ])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe('SQL Injection')
  })

  it('should AND across separate local groups', () => {
    // status group ∩ severity group: only SQL Injection is threat + high.
    const filtered = applyLocalFiltering(mockIssues, [
      { operator: 'AND', conditions: [{ key: 'type', value: 'threat' }] },
      { operator: 'AND', conditions: [{ key: 'severity', value: 'high' }] },
    ])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe('SQL Injection')
  })

  // Likelihood filter regression: the UI builds `(likelihood:"low")` (quoted), so
  // a quoted value must match EXACTLY — `low` must not substring-match `very-low`.
  const likelihoodIssues = [
    { id: 'lo', name: 'Low', syncedAttributes: { likelihood: 'low' } },
    { id: 'vlo', name: 'VeryLow', syncedAttributes: { likelihood: 'very-low' } },
  ] as any[]

  it('exact-matches a quoted likelihood filter (low does not match very-low)', () => {
    const filtered = applyLocalFiltering(likelihoodIssues, parseSearchQuery('(likelihood:"low")').localGroups)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe('Low')
  })

  it('exact-matches a quoted very-low likelihood filter to only very-low', () => {
    const filtered = applyLocalFiltering(likelihoodIssues, parseSearchQuery('(likelihood:"very-low")').localGroups)
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe('VeryLow')
  })

  it('still substring-matches an unquoted local value', () => {
    // Proves the fix is a quoted-flag gate, not a blanket switch to exact match:
    // unquoted `low` matches both low and very-low.
    const filtered = applyLocalFiltering(likelihoodIssues, parseSearchQuery('(likelihood:low)').localGroups)
    expect(filtered).toHaveLength(2)
  })

  it('should bound deep attribute search by depth', () => {
    // `severity` is NOT a top-level key here, so evaluateCondition falls through
    // to the bounded deep search rather than the direct-path lookup.
    const deepIssues = [
      {
        id: 'within',
        name: 'WithinCap',
        syncedAttributes: { a: { b: { severity: 'high' } } }, // ~level 3
      },
      {
        id: 'beyond',
        name: 'BeyondCap',
        syncedAttributes: { a: { b: { c: { d: { e: { f: { g: { severity: 'high' } } } } } } } }, // ~level 8
      },
    ] as any[]

    const filtered = applyLocalFiltering(deepIssues, [
      { operator: 'AND', conditions: [{ key: 'severity', value: 'high' }] },
    ])
    expect(filtered).toHaveLength(1)
    expect(filtered[0].name).toBe('WithinCap')
  })
})

describe('validateSearchQuery', () => {
  it('should accept valid queries', () => {
    expect(validateSearchQuery('name:test').valid).toBe(true)
    expect(validateSearchQuery('(type:threat AND category:dos)').valid).toBe(true)
  })

  it('should accept empty query', () => {
    expect(validateSearchQuery('').valid).toBe(true)
  })

  it('should reject unmatched opening parenthesis', () => {
    const result = validateSearchQuery('(type:threat')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('parenthesis')
  })

  it('should reject unmatched closing parenthesis', () => {
    const result = validateSearchQuery('type:threat)')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('parenthesis')
  })

  it('should reject queries without key:value pairs', () => {
    expect(validateSearchQuery('just plain text').valid).toBe(false)
  })

  // Characterization tests — lock the current behavior of validateSearchQuery:
  // a key with an empty value is accepted, an empty parenthesised group has no
  // key:value pair and is rejected.
  it('should accept a key with an empty value', () => {
    expect(validateSearchQuery('key:').valid).toBe(true)
  })

  it('should reject an empty parenthesised group', () => {
    expect(validateSearchQuery('(())').valid).toBe(false)
  })
})

describe('findUnrecognizedRemoteKeys', () => {
  it('returns nothing for an empty query', () => {
    expect(findUnrecognizedRemoteKeys('')).toEqual([])
    expect(findUnrecognizedRemoteKeys('   ')).toEqual([])
  })

  it('does not flag recognized remote keys', () => {
    expect(findUnrecognizedRemoteKeys('name:foo')).toEqual([])
    expect(findUnrecognizedRemoteKeys('issueStatus:open classId:abc')).toEqual([])
  })

  it('flags a bare key that is not a remote filter key', () => {
    // `severity` is a local/custom key — bare, it is silently dropped by the parser.
    expect(findUnrecognizedRemoteKeys('severity:high')).toEqual(['severity'])
    expect(findUnrecognizedRemoteKeys('severty:open')).toEqual(['severty'])
  })

  it('never flags keys inside a parenthesised (local) group', () => {
    expect(findUnrecognizedRemoteKeys('(severity:high)')).toEqual([])
    expect(findUnrecognizedRemoteKeys('(severity:high OR likelihood:low)')).toEqual([])
  })

  it('flags only the bare unknowns in a mixed query', () => {
    expect(findUnrecognizedRemoteKeys('classId:x (severity:high)')).toEqual([])
    expect(findUnrecognizedRemoteKeys('foo:bar (severity:high)')).toEqual(['foo'])
  })

  it('dedupes repeated bare unknown keys', () => {
    expect(findUnrecognizedRemoteKeys('foo:a foo:b')).toEqual(['foo'])
  })
})
