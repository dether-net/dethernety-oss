// @vitest-environment happy-dom

/**
 * The screen shown when a production build cannot read the platform's configuration, and how its retry starts the app
 * again: from the page the person opened, with a fresh load, without leaving the address the failed start moved to in
 * the history.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import type { App } from 'vue'
import ConfigUnavailable from '@/components/ConfigUnavailable.vue'
import { ConfigUnavailableError } from '@/config/environment'
import { isConfigUnavailable, mountConfigUnavailable, retryFrom } from '../configUnavailable'

const nav = (href: string) => ({ href, reload: vi.fn(), replace: vi.fn() })

describe('the configuration-unavailable screen', () => {
  it('says the configuration is unavailable and the app did not start, and offers only a retry', async () => {
    const retry = vi.fn()
    const w = mount(ConfigUnavailable, { props: { retry }, attachTo: document.body })
    expect(w.get('[role="alert"]').text()).toContain("The platform's configuration is unavailable")
    expect(w.text()).toContain('did not start')
    expect(w.findAll('button')).toHaveLength(1)
    expect(w.find('a').exists()).toBe(false)
    expect(document.activeElement).toBe(w.get('[data-config-unavailable-retry]').element)
    await w.get('[data-config-unavailable-retry]').trigger('click')
    expect(retry).toHaveBeenCalledOnce()
    w.unmount()
  })
})

describe('mountConfigUnavailable', () => {
  let target: HTMLElement
  let screen: App | undefined

  beforeEach(() => {
    target = document.createElement('div')
    document.body.appendChild(target)
  })

  afterEach(() => {
    screen?.unmount()
    target.remove()
  })

  it('mounts the screen into the target', () => {
    screen = mountConfigUnavailable(target, 'https://app.example.test/dataflow?id=1')
    expect(target.querySelector('[data-config-unavailable]')).not.toBeNull()
  })
})

describe('retryFrom', () => {
  it('returns to the page the person opened, replacing the address the failed start moved to', () => {
    const location = nav('https://app.example.test/login')
    retryFrom('https://app.example.test/dataflow?id=1#flow', location)
    expect(location.replace).toHaveBeenCalledWith('https://app.example.test/dataflow?id=1#flow')
    expect(location.reload).not.toHaveBeenCalled()
  })

  it('reloads when the address has not moved, so a #fragment address still loads again', () => {
    const location = nav('https://app.example.test/dataflow#flow')
    retryFrom('https://app.example.test/dataflow#flow', location)
    expect(location.reload).toHaveBeenCalledOnce()
    expect(location.replace).not.toHaveBeenCalled()
  })

  it('puts back a #fragment the failed start changed, and reloads', () => {
    const location = nav('https://app.example.test/dataflow#other')
    retryFrom('https://app.example.test/dataflow#flow', location)
    expect(location.replace).toHaveBeenCalledWith('https://app.example.test/dataflow#flow')
    expect(location.reload).toHaveBeenCalledOnce()
  })
})

describe('isConfigUnavailable', () => {
  it('recognises the error and nothing else', () => {
    expect(isConfigUnavailable(new ConfigUnavailableError(new TypeError('Failed to fetch')))).toBe(true)
    expect(isConfigUnavailable(new Error('Frontend configuration validation failed'))).toBe(false)
    expect(isConfigUnavailable('ConfigUnavailableError')).toBe(false)
    expect(isConfigUnavailable(undefined)).toBe(false)
  })
})
