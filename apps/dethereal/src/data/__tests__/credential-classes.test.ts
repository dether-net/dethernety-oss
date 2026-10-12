import { describe, it, expect } from 'vitest'
import { credentialClassHint } from '../credential-classes.js'

describe('credentialClassHint', () => {
  it('matches the general credential classes by id, and by name when the id differs', () => {
    expect(credentialClassHint({ id: '2bc04479-7e0c-43f2-88b5-9fe788860642', name: 'Authentication Tokens' })).toBe('class-id')
    expect(credentialClassHint({ id: 'other', name: 'User Credentials' })).toBe('class-name')
  })

  it('recognises credential words in any class name', () => {
    for (const name of ['Agent Credential', 'Service Account Token', 'Secrets', 'Database Password', 'TLS Certificate', 'Private Key', 'API Keys', 'kubeconfig / Cluster-Admin Credentials']) {
      expect(credentialClassHint({ id: 'x', name })).toBe('class-name')
    }
  })

  it('does not match ordinary data classes or an absent class', () => {
    for (const name of ['Customer & Personal Data', 'Security Logs', 'Keyboard Layout', 'Tokenized Payment Reference']) {
      expect(credentialClassHint({ id: 'x', name })).toBeUndefined()
    }
    expect(credentialClassHint(undefined)).toBeUndefined()
    expect(credentialClassHint(null)).toBeUndefined()
  })
})
