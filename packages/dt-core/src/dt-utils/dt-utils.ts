import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'

export interface RetryConfig {
  maxRetries: number
  baseDelay: number
  maxDelay: number
}

const DEFAULT_NETWORK_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 5000
}

export class DtUtils {
  private apolloClient: Apollo.ApolloClient | null = null
  private mutex: Map<string, Promise<any>> = new Map()
  private requestDeduplicator = new Map<string, Promise<any>>()
  private requestMetadata = new Map<string, { timestamp: number; count: number }>()

  constructor(client: Apollo.ApolloClient) {
    this.apolloClient = client
  }

  /**
   * Execute a function with mutex protection to prevent parallel execution
   * @param key - Unique key for the mutex (typically method name + parameters)
   * @param fn - Function to execute
   * @returns Promise result of the function
   */
  async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // If there's already a promise for this key, wait for it
    if (this.mutex.has(key)) {
      await this.mutex.get(key)
    }

    // Create new promise for this execution
    const promise = fn()
    this.mutex.set(key, promise)

    try {
      return await promise
    } finally {
      // Clean up the mutex entry
      this.mutex.delete(key)
    }
  }
  /**
   * Deep merge two objects.
   * @param target - The target object to merge into.
   * @param updates - The object to merge from.
   * @returns The merged object.
   */
  deepMerge (target: any, updates: any) {
    for (const key in updates) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue;
      }
      if (
        updates[key] &&
        typeof updates[key] === 'object' &&
        !Array.isArray(updates[key])
      ) {
        target[key] = target[key] || {}
        this.deepMerge(target[key], updates[key])
      } else {
        target[key] = updates[key]
      }
    }
    return target
  } 

  /**
   * Get a value from an object using a path.
   * @param obj - The object to get the value from.
   * @param path - The path to the value.
   * @returns The value.
   */
 getValueFromPath ({ obj, path }: { obj: any, path: string }): any {
    return path.split('.').reduce((acc, key) => {
    // Handle array indices
      const arrayMatch = key.match(/^([^[]+)\[(\d+)\]$/)
      if (arrayMatch) {
        const arrayKey = arrayMatch[1]
        const index = parseInt(arrayMatch[2], 10)
        return acc && acc[arrayKey] && acc[arrayKey][index]
      } else {
        return acc && acc[key]
      }
    }, obj)
  }

  /**
   * Handle network/transport layer errors with structured logging
   * @param action - The action that caused the error
   * @param error - The error object
   * @param context - Additional context for debugging
   */
  handleError ({ action, error, context }: { action: string, error: any, context?: any }) {
    const timestamp = new Date().toISOString()
    const errorInfo = {
      timestamp,
      action,
      message: error?.message || 'Unknown error',
      type: error?.constructor?.name || 'Error',
      networkError: this.isNetworkError(error),
      context
    }
    
    console.error(`[DtUtils] Network error in ${action}:`, errorInfo)
  }

  /**
   * Check if error is a network/transport related error
   */
  private isNetworkError(error: any): boolean {
    if (!error) return false
    
    const message = (error.message || '').toLowerCase()
    const networkIndicators = [
      'network', 'timeout', 'fetch', 'connection',
      'offline', 'unreachable', '502', '503', '504'
    ]
    
    return networkIndicators.some(indicator => message.includes(indicator)) ||
           error.networkError ||
           error.code === 'NETWORK_ERROR'
  }

  /**
   * Retry network operations with exponential backoff
   */
  private async retryNetworkOperation<T>(
    operation: () => Promise<T>,
    config: RetryConfig = DEFAULT_NETWORK_RETRY
  ): Promise<T> {
    let lastError: any
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error
        
        // Only retry network/transport failures
        if (attempt === config.maxRetries || !this.isNetworkError(error)) {
          throw error
        }
        
        const delay = Math.min(
          config.baseDelay * Math.pow(2, attempt),
          config.maxDelay
        )
        
        console.warn(`[DtUtils] Retrying network operation (attempt ${attempt + 1}/${config.maxRetries + 1}) after ${delay}ms`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    
    throw lastError
  }

  /**
   * Execute operation with request deduplication
   */
  private async withDeduplication<T>(
    key: string,
    operation: () => Promise<T>,
    ttl: number = 5000
  ): Promise<T> {
    // Check for existing request
    if (this.requestDeduplicator.has(key)) {
      const metadata = this.requestMetadata.get(key)!
      metadata.count++
      console.debug(`[DtUtils] Deduplicating request ${key} (${metadata.count} concurrent requests)`)
      return this.requestDeduplicator.get(key)!
    }

    // Start new request
    const promise = operation().finally(() => {
      this.requestDeduplicator.delete(key)
      this.requestMetadata.delete(key)
    })

    this.requestDeduplicator.set(key, promise)
    this.requestMetadata.set(key, { timestamp: Date.now(), count: 1 })

    // Auto-cleanup after TTL
    setTimeout(() => {
      if (this.requestDeduplicator.has(key)) {
        this.requestDeduplicator.delete(key)
        this.requestMetadata.delete(key)
      }
    }, ttl)

    return promise
  }

  /**
   * Execute actual mutation with network error handling
   */
  private async executeActualMutation<T>(
    mutation: any,
    variables: object,
    dataPath: string,
    action: string
  ): Promise<T> {
    return this.retryNetworkOperation(async () => {
      const response = await this.apolloClient?.mutate({ mutation, variables })
      let data: any = response?.data
      if (dataPath) {
        data = this.getValueFromPath({ obj: data, path: dataPath })
      }
      if (!data) throw new Error(`No data returned for ${action}`)
      return data as T
    })
  }

  /**
   * Perform a mutation with network error handling, retry logic, and optional deduplication
   * @param mutation - The mutation to perform
   * @param variables - The variables to pass to the mutation
   * @param dataPath - The path to the data to return
   * @param action - The action to perform
   * @param retryConfig - Optional retry configuration
   * @param deduplicationKey - Optional deduplication key (false = disable deduplication)
   * @returns The data returned from the mutation
   */
  async performMutation<T> (
    { mutation, variables, dataPath, action, retryConfig, deduplicationKey }:
    { 
      mutation: any, 
      variables: object, 
      dataPath: string, 
      action: string,
      retryConfig?: RetryConfig,
      deduplicationKey?: string | false
    }
  ): Promise<T> {
    const mutexKey = `${action}-${JSON.stringify(variables)}`
    
    return this.withMutex(mutexKey, async () => {
      try {
        // Only deduplicate if enabled and key provided
        if (deduplicationKey !== false && deduplicationKey) {
          return this.withDeduplication(deduplicationKey, () => 
            this.executeActualMutation(mutation, variables, dataPath, action)
          )
        }
        
        return this.executeActualMutation(mutation, variables, dataPath, action)
      } catch (error) {
        this.handleError({ action, error, context: { variables, dataPath } })
        throw error
      }
    })
  }

  /**
   * Unflatten properties and reconstruct nested objects from dot-notation keys.
   * Converts flat dictionary with dot-notation keys back into nested structure.
   *
   * @param obj - The flattened object to unflatten
   * @returns Unflattened object with nested structure
   *
   * @example
   * unflattenProperties({"a.b": 1}) => {"a": {"b": 1}}
   * unflattenProperties({"items[0]": 1, "items[1]": 2}) => {"items": [1, 2]}
   * unflattenProperties({"user.name": "John", "user.tags[0]": "admin"}) => {"user": {"name": "John", "tags": ["admin"]}}
   */
  static unflattenProperties(obj: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {}

    // Regex to match property names and array indices
    const regex = /([^\.\[\]]+)|\[(\d+)\]/g

    for (const flatKey of Object.keys(obj)) {
      const value = obj[flatKey]
      const keys: (string | number)[] = []

      let match
      while ((match = regex.exec(flatKey)) !== null) {
        if (match[1] !== undefined) {
          if (match[1] === '__proto__' || match[1] === 'constructor' || match[1] === 'prototype') {
            continue
          }
          keys.push(match[1])
        } else if (match[2] !== undefined) {
          keys.push(parseInt(match[2], 10))
        }
      }
      // Reset regex lastIndex for next iteration
      regex.lastIndex = 0

      // Rebuild the nested structure from the keys
      let current: any = result
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]

        // If we're at the last key, assign the value
        if (i === keys.length - 1) {
          if (Array.isArray(current)) {
            // Ensure the list is large enough
            while (current.length <= (k as number)) {
              current.push(null)
            }
            current[k as number] = value
          } else {
            current[k] = value
          }
        } else {
          // Decide whether the next key is a number (array index) or a property
          const nextKey = keys[i + 1]

          if (typeof nextKey === 'number') {
            // The next key is a number, so we need an array
            if (Array.isArray(current)) {
              while (current.length <= (k as number)) {
                current.push(null)
              }
              if (!Array.isArray(current[k as number])) {
                current[k as number] = []
              }
            } else {
              if (!(k in current) || !Array.isArray(current[k])) {
                current[k] = []
              }
            }
          } else {
            // We need an object
            if (Array.isArray(current)) {
              while (current.length <= (k as number)) {
                current.push(null)
              }
              if (typeof current[k as number] !== 'object' || current[k as number] === null) {
                current[k as number] = {}
              }
            } else {
              if (!(k in current) || typeof current[k] !== 'object' || current[k] === null) {
                current[k] = {}
              }
            }
          }

          // Move deeper into the nested structure
          current = current[k]
        }
      }
    }

    return result
  }

  /**
   * Flatten nested dictionary/object properties into dot-notation keys.
   * Converts nested objects and arrays into a flat dictionary structure.
   *
   * @param obj - The object to flatten (dict, list, or primitive value)
   * @param prefix - The prefix for the current level (used for recursion)
   * @param result - The accumulator object (used for recursion)
   * @returns Flattened object with dot-notation keys
   *
   * @example
   * flattenProperties({"a": {"b": 1}}) => {"a.b": 1}
   * flattenProperties({"items": [1, 2, 3]}) => {"items[0]": 1, "items[1]": 2, "items[2]": 3}
   * flattenProperties({"user": {"name": "John", "tags": ["admin"]}}) => {"user.name": "John", "user.tags[0]": "admin"}
   */
  static flattenProperties(
    obj: any,
    prefix: string = '',
    result: Record<string, any> = {}
  ): Record<string, any> {
    // If obj is a primitive (including string) or null/undefined, assign it directly
    if (obj === null || obj === undefined || (typeof obj !== 'object')) {
      if (prefix) {
        result[prefix] = obj
      }
      return result
    }

    // Handle arrays
    if (Array.isArray(obj)) {
      for (let index = 0; index < obj.length; index++) {
        const item = obj[index]
        const key = `${prefix}[${index}]`
        // Check if the item is not an object
        if (item === null || item === undefined || typeof item !== 'object') {
          result[key] = item
        } else {
          DtUtils.flattenProperties(item, key, result)
        }
      }
      return result
    }

    // Handle dictionaries/objects
    for (const key of Object.keys(obj)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        continue
      }
      const value = obj[key]
      // Build the new key name
      const prefixedKey = prefix ? `${prefix}.${key}` : key

      if (value !== null && value !== undefined && typeof value === 'object') {
        if (Array.isArray(value)) {
          // For arrays, iterate over each element
          for (let index = 0; index < value.length; index++) {
            const item = value[index]
            if (item === null || item === undefined || typeof item !== 'object') {
              result[`${prefixedKey}[${index}]`] = item
            } else {
              DtUtils.flattenProperties(item, `${prefixedKey}[${index}]`, result)
            }
          }
        } else if (Object.keys(value).length > 0) {
          // Recursively flatten non-empty objects
          DtUtils.flattenProperties(value, prefixedKey, result)
        } else {
          // For empty objects, just assign the value
          result[prefixedKey] = value
        }
      } else {
        // For primitive values, assign directly
        result[prefixedKey] = value
      }
    }

    return result
  }

  /**
   * Perform a query with network error handling and retry logic
   * @param query - The GraphQL query
   * @param variables - Query variables
   * @param action - Action name for logging
   * @param fetchPolicy - Apollo fetch policy
   * @param retryConfig - Optional retry configuration
   * @returns Query result data
   */
  async performQuery<T>(
    { query, variables = {}, action, fetchPolicy = 'network-only', retryConfig }:
    {
      query: any,
      variables?: object,
      action: string,
      fetchPolicy?: string,
      retryConfig?: RetryConfig
    }
  ): Promise<T> {
    const mutexKey = `${action}-${JSON.stringify(variables)}`
    
    return this.withMutex(mutexKey, async () => {
      try {
        return await this.retryNetworkOperation(async () => {
          const response = await this.apolloClient?.query({
            query,
            variables,
            fetchPolicy: fetchPolicy as any
          })
          return response?.data as T
        }, retryConfig)
      } catch (error) {
        this.handleError({ action, error, context: { variables, fetchPolicy } })
        throw error
      }
    })
  }
}
