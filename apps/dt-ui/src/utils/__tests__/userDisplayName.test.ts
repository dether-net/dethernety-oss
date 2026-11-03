import { describe, it, expect } from 'vitest'
import { userDisplayName } from '../userDisplayName'

describe('userDisplayName', () => {
  it('uses the name claim when present', () => {
    expect(userDisplayName({ name: 'Anna Example', preferred_username: 'anna', email: 'anna@example.test' }))
      .toBe('Anna Example')
  })

  it('falls back to preferred_username when the name claim is absent', () => {
    expect(userDisplayName({ preferred_username: 'anna', email: 'anna@example.test' })).toBe('anna')
  })

  it('falls back to the email when name and preferred_username are absent', () => {
    expect(userDisplayName({ email: 'anna@example.test' })).toBe('anna@example.test')
  })

  it('treats an empty or whitespace-only claim as absent', () => {
    expect(userDisplayName({ name: '   ', preferred_username: '', email: 'anna@example.test' }))
      .toBe('anna@example.test')
  })

  it('trims the claim it uses', () => {
    expect(userDisplayName({ name: '  Anna Example ' })).toBe('Anna Example')
  })

  it('ignores a claim that is not a string', () => {
    expect(userDisplayName({ name: 42 as unknown as string, email: 'anna@example.test' })).toBe('anna@example.test')
  })

  it("returns 'Unknown' when no claim is present", () => {
    expect(userDisplayName({})).toBe('Unknown')
    expect(userDisplayName({ name: ' ', preferred_username: ' ', email: ' ' })).toBe('Unknown')
  })
})
