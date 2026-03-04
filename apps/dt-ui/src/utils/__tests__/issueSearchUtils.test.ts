import { describe, it, expect } from 'vitest'
import {
  parseSearchQuery,
  buildRemoteFilterParams,
  applyLocalFiltering,
  validateSearchQuery,
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
})
