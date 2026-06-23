import { Issue } from '@dethernety/dt-core'

// Remote filter params accepted by issueStore.fetchIssues (and produced by
// buildRemoteFilterParams below). Lives here — the leaf util that maps search
// conditions to the param shape — so the store and the issues page import it
// from the util rather than the util reaching back into the store.
export interface FetchIssuesParams {
  name?: string
  issueId?: string
  classId?: string
  elementIds?: string[]
  classType?: string
  moduleId?: string
  moduleName?: string
  issueStatus?: string
}

export interface SearchCondition {
  key: string
  value: string
}

export interface SearchGroup {
  conditions: SearchCondition[]
  operator: 'AND' | 'OR'
}

export interface ParsedSearch {
  remoteConditions: SearchCondition[]
  localGroups: SearchGroup[]
}

// Remote filtering keys that can be used with fetchIssues
const REMOTE_FILTER_KEYS = ['name', 'issueId', 'classId', 'elementIds', 'classType', 'moduleId', 'moduleName', 'issueStatus']

// Issue interface keys for local filtering
const ISSUE_INTERFACE_KEYS = [
  'id', 'name', 'description', 'type', 'category', 'attributes', 'lastSyncAt',
  'createdAt', 'updatedAt', 'open', 'comments',
]

/**
 * Parse search query with key:value format
 * Remote: key:value (no operators)
 * Local: (key:value AND/OR key:value)
 */
export function parseSearchQuery (query: string): ParsedSearch {
  const result: ParsedSearch = {
    remoteConditions: [],
    localGroups: [],
  }

  if (!query.trim()) {
    return result
  }

  // Split by parentheses to separate remote and local conditions
  const parts = query.split(/(\([^)]+\))/).filter(part => part.trim())

  for (const part of parts) {
    const trimmedPart = part.trim()

    if (trimmedPart.startsWith('(') && trimmedPart.endsWith(')')) {
      // Local filtering (in parentheses)
      const localQuery = trimmedPart.slice(1, -1) // Remove parentheses
      const localGroup = parseLocalGroup(localQuery)
      if (localGroup.conditions.length > 0) {
        result.localGroups.push(localGroup)
      }
    } else {
      // Remote filtering (outside parentheses)
      const remoteConditions = parseRemoteConditions(trimmedPart)
      result.remoteConditions.push(...remoteConditions)
    }
  }

  return result
}

function parseRemoteConditions (query: string): SearchCondition[] {
  const conditions: SearchCondition[] = []
  // key:value where value is either "double-quoted", 'single-quoted', or an
  // unquoted run up to the next `key:` or end. The quoted alternatives let a
  // value contain a quote/apostrophe (e.g. name:O'Brien) without truncating —
  // the old [^'"] class stopped at the first quote.
  const keyValueRegex = /(\w+):(?:"([^"]*)"|'([^']*)'|(.+?))(?=\s+\w+:|$)/g

  let match
  while ((match = keyValueRegex.exec(query)) !== null) {
    const key = match[1]
    const value = (match[2] ?? match[3] ?? match[4] ?? '').trim()
    if (REMOTE_FILTER_KEYS.includes(key) && value) {
      conditions.push({ key, value })
    }
  }

  return conditions
}

function parseLocalGroup (query: string): SearchGroup {
  const group: SearchGroup = {
    conditions: [],
    operator: 'AND', // Default operator
  }

  // Determine operator (AND or OR)
  if (query.toUpperCase().includes(' OR ')) {
    group.operator = 'OR'
    query = query.replace(/\s+OR\s+/gi, ' OR ')
  } else if (query.toUpperCase().includes(' AND ')) {
    group.operator = 'AND'
    query = query.replace(/\s+AND\s+/gi, ' AND ')
  }

  // Split by the determined operator
  const parts = group.operator === 'OR'
    ? query.split(/\s+OR\s+/i)
    : query.split(/\s+AND\s+/i)

  for (const part of parts) {
    const keyValueRegex = /(\w+(?:\.\w+)?):['"]?([^'"]*?)['"]?$/
    const match = part.trim().match(keyValueRegex)

    if (match) {
      const [, key, value] = match
      if (value.trim()) {
        group.conditions.push({ key, value: value.trim() })
      }
    }
  }

  return group
}

/**
 * Find bare (non-parenthesised) keys that are NOT recognized remote-filter keys.
 *
 * `parseRemoteConditions` silently drops any bare `key:value` whose key isn't in
 * REMOTE_FILTER_KEYS — so `severty:open`, or even `severity:high` typed without
 * parentheses, does nothing. This surfaces those keys for a non-blocking advisory
 * hint. Keys INSIDE parentheses are local and open-ended (custom synced-attribute
 * keys), so they are never reported.
 */
export function findUnrecognizedRemoteKeys (query: string): string[] {
  if (!query.trim()) return []

  const unknown = new Set<string>()
  // Same split as parseSearchQuery: parenthesised groups vs bare remote text.
  const parts = query.split(/(\([^)]+\))/).filter(part => part.trim())

  for (const part of parts) {
    const trimmedPart = part.trim()
    // Skip local groups — their keys are open-ended (custom attributes).
    if (trimmedPart.startsWith('(') && trimmedPart.endsWith(')')) continue

    const keyRegex = /(\w+(?:\.\w+)?):/g
    let match
    while ((match = keyRegex.exec(trimmedPart)) !== null) {
      const key = match[1]
      if (!REMOTE_FILTER_KEYS.includes(key)) {
        unknown.add(key)
      }
    }
  }

  return [...unknown]
}

/**
 * Convert remote search conditions to fetchIssues parameters
 */
export function buildRemoteFilterParams (conditions: SearchCondition[]): FetchIssuesParams {
  const params: FetchIssuesParams = {}

  for (const condition of conditions) {
    switch (condition.key) {
      case 'name':
        params.name = condition.value
        break
      case 'issueId':
        params.issueId = condition.value
        break
      case 'classId':
        params.classId = condition.value
        break
      case 'elementIds':
        // Handle comma-separated element IDs
        params.elementIds = condition.value.split(',').map(id => id.trim()).filter(id => id)
        break
      case 'classType':
        params.classType = condition.value
        break
      case 'moduleId':
        params.moduleId = condition.value
        break
      case 'moduleName':
        params.moduleName = condition.value
        break
      case 'issueStatus':
        // Validate issueStatus value
        const lowerValue = condition.value.toLowerCase()
        if (lowerValue === 'open' || lowerValue === 'closed') {
          params.issueStatus = lowerValue
        } else {
          console.warn(`Invalid issueStatus value: ${condition.value}. Expected 'open' or 'closed'.`)
          // Don't set the parameter if the value is invalid
        }
        break
    }
  }

  return params
}

/**
 * Apply local filtering to issues array
 */
export function applyLocalFiltering (issues: Issue[], localGroups: SearchGroup[]): Issue[] {
  if (localGroups.length === 0) {
    return issues
  }

  return issues.filter(issue => {
    // All groups must match (AND between groups)
    return localGroups.every(group => evaluateGroup(issue, group))
  })
}

function evaluateGroup (issue: Issue, group: SearchGroup): boolean {
  if (group.conditions.length === 0) {
    return true
  }

  if (group.operator === 'OR') {
    // At least one condition must match
    return group.conditions.some(condition => evaluateCondition(issue, condition))
  } else {
    // All conditions must match
    return group.conditions.every(condition => evaluateCondition(issue, condition))
  }
}

function evaluateCondition (issue: Issue, condition: SearchCondition): boolean {
  const { key, value } = condition
  const searchValue = value.toLowerCase()

  // Handle nested class properties
  if (key.startsWith('class.')) {
    const classKey = key.substring(6) // Remove 'class.' prefix
    const classValue = getNestedValue(issue.issueClass, classKey)
    return matchValue(classValue, searchValue)
  }

  // Handle direct issue properties
  if (ISSUE_INTERFACE_KEYS.includes(key)) {
    const issueValue = getNestedValue(issue, key)
    return matchValue(issueValue, searchValue)
  }

  // Handle custom attributes in syncedAttributes with deep search
  if (issue.syncedAttributes && typeof issue.syncedAttributes === 'object') {
    // First try direct nested path access (e.g., attributes.severity)
    const directValue = getNestedValue(issue.syncedAttributes, key)
    if (directValue !== null && matchValue(directValue, searchValue)) {
      return true
    }

    // Then try deep search for the key anywhere in the nested structure
    return deepSearchInObject(issue.syncedAttributes, key, searchValue)
  }

  return false
}

function getNestedValue (obj: any, key: string): any {
  if (!obj || typeof obj !== 'object') {
    return null
  }

  const keys = key.split('.')
  let current = obj

  for (const k of keys) {
    if (current && typeof current === 'object' && k in current) {
      current = current[k]
    } else {
      return null
    }
  }

  return current
}

// Bound the recursive attribute search so a deeply-nested (or cyclic) synced
// payload can't stall the main thread on every keystroke.
const MAX_DEEP_SEARCH_DEPTH = 5

/**
 * Deep search for a key-value pair in nested objects
 * This recursively searches through all nested objects and arrays, up to
 * MAX_DEEP_SEARCH_DEPTH levels and guarding against reference cycles.
 */
function deepSearchInObject (
  obj: any,
  searchKey: string,
  searchValue: string,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): boolean {
  if (!obj || typeof obj !== 'object') {
    return false
  }
  if (depth >= MAX_DEEP_SEARCH_DEPTH) {
    return false
  }
  if (seen.has(obj)) {
    return false
  }
  seen.add(obj)

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.some(item => deepSearchInObject(item, searchKey, searchValue, depth + 1, seen))
  }

  // Check all keys in the current object
  for (const [key, value] of Object.entries(obj)) {
    // Direct key match
    if (key === searchKey) {
      if (matchValue(value, searchValue)) {
        return true
      }
    }

    // Recursive search in nested objects/arrays
    if (value && typeof value === 'object') {
      if (deepSearchInObject(value, searchKey, searchValue, depth + 1, seen)) {
        return true
      }
    }
  }

  return false
}

function matchValue (actualValue: any, searchValue: string): boolean {
  if (actualValue === null || actualValue === undefined) {
    return false
  }

  const actualStr = String(actualValue).toLowerCase()

  // Exact match for quoted values
  if (searchValue.startsWith('"') && searchValue.endsWith('"')) {
    const exactValue = searchValue.slice(1, -1)
    return actualStr === exactValue
  }

  // Partial match for unquoted values
  return actualStr.includes(searchValue)
}

/**
 * Validate search query syntax
 */
export function validateSearchQuery (query: string): { valid: boolean; error?: string } {
  if (!query.trim()) {
    return { valid: true }
  }

  try {
    // Check for balanced parentheses
    let openParens = 0
    for (const char of query) {
      if (char === '(') openParens++
      else if (char === ')') openParens--
      if (openParens < 0) {
        return { valid: false, error: 'Unmatched closing parenthesis' }
      }
    }
    if (openParens > 0) {
      return { valid: false, error: 'Unmatched opening parenthesis' }
    }

    // Check for valid key:value format
    const keyValueRegex = /\w+(?:\.\w+)?:['"]?[^'"]*['"]?/g
    const matches = query.match(keyValueRegex)

    if (!matches || matches.length === 0) {
      return { valid: false, error: 'No valid key:value pairs found' }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid search syntax' }
  }
}
