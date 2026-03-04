import { describe, it, expect } from 'vitest'
import { validatePathConfinement } from '../directory-utils.js'

describe('validatePathConfinement', () => {
  const baseDir = '/home/user/models'

  it('should accept paths within the base directory', () => {
    const result = validatePathConfinement('/home/user/models/my-model', baseDir)
    expect(result).toBe('/home/user/models/my-model')
  })

  it('should accept the base directory itself', () => {
    const result = validatePathConfinement('/home/user/models', baseDir)
    expect(result).toBe('/home/user/models')
  })

  it('should reject paths outside the base directory', () => {
    expect(() => validatePathConfinement('/home/user/other', baseDir)).toThrow(
      'outside the allowed directory',
    )
  })

  it('should reject path traversal attempts', () => {
    expect(() => validatePathConfinement('/home/user/models/../secrets', baseDir)).toThrow(
      'outside the allowed directory',
    )
  })

  it('should reject paths that are prefixes but not subdirectories', () => {
    // "/home/user/models-extra" starts with "/home/user/models" but is not a subdirectory
    expect(() => validatePathConfinement('/home/user/models-extra', baseDir)).toThrow(
      'outside the allowed directory',
    )
  })

  it('should resolve relative paths against cwd when no base dir provided', () => {
    const cwd = process.cwd()
    const result = validatePathConfinement(`${cwd}/subdir`)
    expect(result).toBe(`${cwd}/subdir`)
  })

  it('should accept nested subdirectories', () => {
    const result = validatePathConfinement('/home/user/models/a/b/c', baseDir)
    expect(result).toBe('/home/user/models/a/b/c')
  })
})
