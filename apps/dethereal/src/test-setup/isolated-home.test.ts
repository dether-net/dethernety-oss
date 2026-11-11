import { describe, it, expect } from 'vitest'
import os from 'node:os'

describe('test isolation', () => {
  it('runs with HOME outside the account home', () => {
    expect(os.homedir()).not.toBe(os.userInfo().homedir)
    expect(os.homedir()).toContain('dethereal-test-home-')
  })
})
