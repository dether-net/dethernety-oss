import { describe, expect, it } from 'vitest'
import { cssString, escapeHtml } from '../escape'
import { reportUserName } from '../userName'
import { reportFileName } from '../download'
import { parseBrandingConfig } from '@/config/branding'

describe('escapeHtml', () => {
  it('escapes all five of & < > " \'', () => {
    expect(escapeHtml(`a&b<c>d"e'f`)).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
  })

  it('prints null and undefined as nothing, and other values as their string', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(42)).toBe('42')
    expect(escapeHtml(false)).toBe('false')
  })
})

describe('cssString', () => {
  it.each([
    ['a quote', 'a"b'],
    ['a backslash', 'a\\b'],
    ['a newline', 'a\nb'],
    ['the end of a style element', 'a</style><script>x</script>'],
    ['an ampersand and angle brackets', 'a & <b>'],
  ])('keeps %s from ending the string or the stylesheet', (_label, text) => {
    const out = cssString(text)
    expect(out.startsWith('"') && out.endsWith('"')).toBe(true)
    const inner = out.slice(1, -1)
    expect(inner).not.toMatch(/["\n<>&]/)
    expect(inner.replace(/\\[0-9a-f]+ /g, '')).not.toContain('\\')
  })

  it('leaves letters, digits and plain punctuation as they are', () => {
    expect(cssString('Example Studio, Ltd. (2026)')).toBe('"Example Studio, Ltd. (2026)"')
  })
})

describe('reportUserName', () => {
  it.each([['Jane Doe'], ['Jane'], ['admin'], ['jdoe42'], ['someone@example.com']])('prints %s', (name) => {
    expect(reportUserName(name)).toBe(name)
  })

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['the Unknown fallback', 'Unknown'],
    ['a UUID, as many identity providers make a subject id', '3F2C8A10-5B7E-4C2D-9A61-0F4E2B7C9D13'],
    ['a long token with a digit', 'auth0_5f9c2e1a7b3d4c6e8f0a'],
    ['not a string', 12],
  ])('is null for %s', (_label, name) => {
    expect(reportUserName(name)).toBeNull()
  })
})

describe('reportFileName', () => {
  it('is <kind>[-<variant>]-<stamp>.html', () => {
    expect(reportFileName({ kind: 'threat-report', stamp: '2026-11-20T1015' })).toBe('threat-report-2026-11-20T1015.html')
    expect(reportFileName({ kind: 'example-report', variant: 'nis2', stamp: '20261120' })).toBe(
      'example-report-nis2-20261120.html',
    )
  })

  it('keeps only characters that are safe in a file name', () => {
    expect(reportFileName({ kind: '../evil', stamp: 'a b/c' })).toBe('evil-a-b-c.html')
    expect(reportFileName({ kind: '', stamp: 'x' })).toBe('report-x.html')
  })
})

describe('parseBrandingConfig', () => {
  const logo = { logoUrl: `/branding/logo/${'a'.repeat(64)}`, logoWidth: 320, logoHeight: 80 }

  it('is null for no brand, and for a brand without a name', () => {
    expect(parseBrandingConfig(null)).toBeNull()
    expect(parseBrandingConfig({ url: 'https://example.com' })).toBeNull()
  })

  it('keeps what dt-ws serves', () => {
    expect(parseBrandingConfig({ name: 'Example', url: 'https://example.com/', footer: 'Confidential', ...logo })).toEqual({
      name: 'Example',
      url: 'https://example.com/',
      footer: 'Confidential',
      ...logo,
    })
  })

  it('drops a url that is not https or carries a login, a logo path off the route, and a logo without its size', () => {
    expect(parseBrandingConfig({ name: 'x', url: 'http://example.com' })).toEqual({ name: 'x' })
    expect(parseBrandingConfig({ name: 'x', url: 'https://user:pass@example.com' })).toEqual({ name: 'x' })
    expect(parseBrandingConfig({ name: 'x', ...logo, logoUrl: 'https://evil.example/logo.png' })).toEqual({ name: 'x' })
    expect(parseBrandingConfig({ name: 'x', ...logo, logoWidth: 0 })).toEqual({ name: 'x' })
    expect(parseBrandingConfig({ name: 'x', ...logo, logoHeight: 5000 })).toEqual({ name: 'x' })
  })

  it('keeps a logo path only as the route, then exactly 64 lower-case hex digits', () => {
    const hex = '0123456789abcdef'.repeat(4)
    const kept = (logoUrl: unknown) => parseBrandingConfig({ name: 'x', ...logo, logoUrl })?.logoUrl
    expect(kept(`/branding/logo/${hex}`)).toBe(`/branding/logo/${hex}`)
    expect(kept(`/branding/logos/${hex}`)).toBeUndefined()
    expect(kept(`/branding/logo${hex}`)).toBeUndefined()
    expect(kept(`branding/logo/${hex}`)).toBeUndefined()
    expect(kept(`\\branding\\logo\\${hex}`)).toBeUndefined()
    expect(kept(`/x/branding/logo/${hex}`)).toBeUndefined()
    expect(kept(`/branding/logo/${hex.toUpperCase()}`)).toBeUndefined()
    expect(kept(`/branding/logo/${hex.slice(1)}`)).toBeUndefined()
    expect(kept(`/branding/logo/${hex}0`)).toBeUndefined()
    expect(kept(`/branding/logo/${hex}/`)).toBeUndefined()
    expect(kept(`/branding/logo/${hex}.png`)).toBeUndefined()
    expect(kept(`/branding/logo/${hex}\n`)).toBeUndefined()
    expect(kept(42)).toBeUndefined()
  })
})
