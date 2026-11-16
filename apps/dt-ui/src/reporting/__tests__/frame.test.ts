import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FRAME_STRINGS,
  MARGIN_FOOTER_MAX,
  REPORT_CSP,
  buildReport,
  clampText,
  formatTimestamp,
  type FrameStrings,
  type ReportInput,
} from '../frame'
import { frameCss } from '../frame.css'

const LOGO = 'data:image/png;base64,iVBORw0KGgo='

const base = (over: Partial<ReportInput> = {}): ReportInput => ({
  kind: 'example-report',
  title: 'Example report',
  brand: null,
  meta: {
    modelName: 'Shop',
    modelId: 'model-1',
    module: { name: 'Example', version: '1.2.3' },
    generatedAt: '2026-11-20 10:15',
    exportedAt: '2026-11-21 09:00',
  },
  sections: [{ id: 'summary', title: 'Summary', html: '<p>Body</p>' }],
  ...over,
})

const styleOf = (html: string) => html.match(/<style>([\s\S]*?)<\/style>/)![1]

describe('buildReport', () => {
  it('carries the exact content security policy at the top of its head, and turns DNS prefetch off', () => {
    const html = buildReport(base())
    expect(html.startsWith('<!DOCTYPE html><html><head><meta charset="utf-8">' +
      `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`)).toBe(true)
    expect(html).toContain('<meta http-equiv="x-dns-prefetch-control" content="off">')
    expect(REPORT_CSP).toBe("default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
  })

  it('prints every fact, escaped, and exportedAt and exportedBy as given', () => {
    const html = buildReport(
      base({
        title: 'A <b>report</b>',
        meta: {
          modelName: 'Shop & "Co"',
          modelId: 'model-1',
          clientName: '<Client>',
          module: { name: 'Example', version: '1.2.3' },
          generatedAt: '2026-11-20 10:15',
          fingerprint: 'abc123',
          stale: true,
          exportedAt: '2026-11-21 09:00',
          exportedBy: "O'Brien",
        },
      }),
    )
    expect(html).toContain('<title>A &lt;b&gt;report&lt;/b&gt;</title>')
    expect(html).toContain('<h1 class="rk-title">A &lt;b&gt;report&lt;/b&gt;</h1>')
    for (const value of ['Shop &amp; &quot;Co&quot;', 'model-1', '&lt;Client&gt;', 'Example 1.2.3', 'abc123', '2026-11-21 09:00', 'O&#39;Brien']) {
      expect(html).toContain(`<dd>${value}</dd>`)
    }
    expect(html).toContain(`<dt>Prepared for</dt><dd>&lt;Client&gt;</dd>`)
    expect(html).toContain(DEFAULT_FRAME_STRINGS.stale)
    expect(html).not.toContain('<Client>')
  })

  it('prints no "Prepared for" without a client', () => {
    expect(buildReport(base())).not.toContain('Prepared for')
  })

  it('prints a report unbranded, branded without a logo, and branded with one', () => {
    expect(buildReport(base())).not.toContain('class="rk-brand')
    const named = buildReport(base({ brand: { name: 'Example Studio', footer: 'Confidential' } }))
    expect(named).toContain('<span class="rk-brand-name">Example Studio</span>')
    expect(named).not.toContain('<img')
    expect(named).toContain('<p class="rk-footer-line">Confidential</p>')
    expect(named).toContain(DEFAULT_FRAME_STRINGS.brandAppliedAtExport)
    const logo = buildReport(base({ brand: { name: 'Example', url: 'https://example.com', logo: { dataUri: LOGO, width: 320, height: 80 } } }))
    expect(logo).toContain(`<img class="rk-logo" src="${LOGO}" width="320" height="80" alt="Example">`)
    expect(logo).toContain('<a class="rk-brand-name" href="https://example.com">Example</a>')
  })

  it('drops a brand url that is not https or carries a login, and a logo that is not an inline image', () => {
    const html = (brand: ReportInput['brand']) => buildReport(base({ brand }))
    expect(html({ name: 'x', url: 'http://example.com' })).not.toContain('href=')
    expect(html({ name: 'x', url: 'https://user:pw@example.com' })).not.toContain('href=')
    expect(html({ name: 'x', url: 'javascript:alert(1)' })).not.toContain('href=')
    for (const dataUri of ['https://evil.example/logo.png', 'data:image/svg+xml;base64,PHN2Zz4=', `${LOGO}"><script>`]) {
      expect(html({ name: 'x', logo: { dataUri, width: 10, height: 10 } })).not.toContain('<img')
    }
  })

  it('validates the locale, the kind and the section ids', () => {
    expect(buildReport(base({ locale: 'hu-HU' }))).toContain('<html lang="hu-HU">')
    expect(buildReport(base({ locale: 'en" onload="x' }))).toContain('<html>')
    expect(buildReport(base({ kind: 'Evil Kind<' }))).toContain('<main class="report-report rk-sections">')
    const html = buildReport(base({ sections: [{ id: 'ok-id', title: 'A', html: '' }, { id: 'bad id"', title: 'B', html: '' }] }))
    expect(html).toContain('<section class="rk-section" id="ok-id">')
    expect(html).toContain('<section class="rk-section"><h2 class="rk-section-title">B</h2>')
  })

  it('replaces every frame word with the strings given: no English default is left, the CSS included', () => {
    const hu: FrameStrings = {
      preparedFor: 'Megrendelő',
      model: 'Modell',
      modelId: 'Modellazonosító',
      client: 'Ügyfél',
      generated: 'Készült',
      module: 'Modul',
      fingerprint: 'Ujjlenyomat',
      exported: 'Exportálva',
      exportedBy: 'Exportálta',
      stale: 'A modell megváltozott a riport készítése óta.',
      brandAppliedAtExport: 'Az arculat az exportáláskor került a riportra.',
      aboutThisReport: 'A riportról',
      page: 'Oldal',
      of: '/',
    }
    const html = buildReport(
      base({
        locale: 'hu',
        strings: hu,
        brand: { name: 'Példa Kft.', footer: 'Bizalmas' },
        pageMark: 'TERVEZET',
        meta: { ...base().meta, clientName: 'Ügyfél Zrt.', fingerprint: 'f', stale: true, exportedBy: 'Kovács' },
      }),
    )
    // Whole words: a Hungarian word may contain an English one ("Modell").
    const word = (text: string) => new RegExp(`(^|[^\\p{L}])${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u')
    for (const english of Object.values(DEFAULT_FRAME_STRINGS)) expect(html).not.toMatch(word(english))
  })

  it('carries the print rules: margins and no paper size, a cover without running boxes, page numbers', () => {
    const css = styleOf(buildReport(base({ brand: { name: 'Example', footer: 'Confidential' } })))
    expect(css).toContain('@page{margin:20mm 16mm 22mm;')
    expect(css).not.toMatch(/@page[^}]*[{;]\s*size\s*:/)
    expect(css).toMatch(/@page :first\{@top-left\{content:none\}@top-right\{content:none\}@bottom-left\{content:none\}@bottom-center\{content:none\}@bottom-right\{content:none\}\}/)
    expect(css).toContain('@top-left{content:"Example"')
    expect(css).toContain('@top-right{content:"Example report"')
    expect(css).toContain('@bottom-left{content:"Confidential"')
    expect(css).toContain('counter(page)')
    expect(css).toContain('counter(pages)')
    expect(css).toContain('print-color-adjust:exact')
    expect(css).toContain('break-inside:avoid')
    expect(css).toContain('max-height:205mm')
  })

  it('escapes the margin-box text, so a brand name cannot end its string or the stylesheet', () => {
    const html = buildReport(base({ brand: { name: 'x"}</style><script>alert(1)</script>' } }))
    expect(html).not.toContain('<script>')
    expect(styleOf(html)).not.toContain('</style')
  })

  it('prints the page mark through one fixed element on every page, the cover included, with its space reserved on each', () => {
    const html = buildReport(base({ pageMark: 'DRAFT <not for distribution>' }))
    expect(html.match(/class="rk-page-mark"/g)).toHaveLength(1)
    expect(html).toContain('<div class="rk-page-mark">DRAFT &lt;not for distribution&gt;</div>')
    const css = styleOf(html)
    expect(css).toContain('.rk-page-mark{position:fixed;top:0')
    // The space is a spacer in a table header, which repeats at the top of every printed page; the whole document,
    // cover included, sits in the table's one body cell.
    expect(html).toMatch(
      /<table class="rk-page-frame" role="presentation"><thead><tr><td class="rk-mark-space"><\/td><\/tr><\/thead><tbody><tr><td class="rk-page-cell"><div class="rk-doc"><header class="rk-cover">/,
    )
    expect(css).toContain('.rk-mark-space{height:9mm;padding:0}')
    expect(css).toMatch(/\.rk-page-frame\{[^}]*table-layout:fixed/)
    expect(css).toContain('.rk-page-frame thead{display:table-header-group}')
    // In no @page rule, so :first cannot drop it, and nothing hides it on the first page.
    for (const rule of css.match(/@page[^{]*\{[^}]*(\{[^}]*\}[^}]*)*\}/g) ?? []) expect(rule).not.toContain('DRAFT')
    expect(css).not.toMatch(/rk-page-mark[^{]*\{[^}]*display:none/)
    const unmarked = buildReport(base())
    expect(unmarked).not.toContain('rk-page-mark')
    expect(unmarked).not.toContain('rk-page-frame')
    expect(unmarked).not.toContain('rk-mark-space')
  })

  it('always has the header block at the start and the footer block at the end', () => {
    for (const input of [base(), base({ sections: [] }), base({ brand: { name: 'x' } }), base({ pageMark: 'DRAFT' })]) {
      const html = buildReport(input)
      expect(html.indexOf('<header class="rk-cover">')).toBeLessThan(html.indexOf('<main'))
      expect(html.indexOf('<footer class="rk-footer">')).toBeGreaterThan(html.indexOf('</main>'))
      expect(html).toMatch(/<\/footer><\/div>(<\/td><\/tr><\/tbody><\/table>)?<\/body><\/html>$/)
    }
  })

  it('starts every selector at a frame class, apart from the page reset', () => {
    const css = frameCss({ topLeft: 'a', topRight: 'b', bottomLeft: 'c', bottomCenter: 'd', page: 'Page', of: 'of' }, true)
    const selectors = css
      .replace(/@page[^{]*\{(?:[^{}]|\{[^}]*\})*\}/g, '')
      .replace(/@media print\{/g, '')
      .match(/(^|\})\s*([^{}@]+)\{/g)!
      .map((s) => s.replace(/^\}?\s*/, '').replace(/\{$/, '').trim())
    for (const group of selectors) {
      for (const selector of group.split(',')) {
        if (['html', 'body'].includes(selector.trim())) continue
        expect(selector.trim()).toMatch(/^\./)
      }
    }
  })

  it('emits no <details>, and opens any a section brings', () => {
    const html = buildReport(base({ sections: [{ id: 's', title: 'S', html: '<details><summary>More</summary><p>x</p></details>' }] }))
    expect(html).not.toMatch(/<details|<summary/i)
    expect(html).toContain('<div><div>More</div><p>x</p></div>')
  })

  it('makes a refresh, a prefetch link or a base in section markup inert', () => {
    const html = buildReport(
      base({
        sections: [
          {
            id: 's',
            title: 'S',
            html: '<meta http-equiv="refresh" content="0;url=https://x.example/?leak"><link rel="dns-prefetch" href="//leak.x.example"><BASE href="https://x.example/">',
          },
        ],
      }),
    )
    const body = html.slice(html.indexOf('<body'))
    expect(body).not.toMatch(/<(meta|link|base)\b/i)
    expect(body).toContain('<x-meta http-equiv="refresh"')
    expect(body).toContain('<x-link rel="dns-prefetch"')
  })
})

describe('timestamps', () => {
  it('reads an ISO timestamp as a day, month, year and time in UTC, in the report language', () => {
    expect(formatTimestamp('2026-11-15T10:00:00.000Z')).toBe('15 Nov 2026, 10:00 UTC')
    expect(formatTimestamp('2026-11-15T23:30:00+02:00', 'en-US')).toBe('15 Nov 2026, 21:30 UTC')
    expect(formatTimestamp('2026-11-15T10:00:00.000Z', 'hu')).toBe('2026. nov. 15. 10:00 UTC')
  })

  it('prints anything else as given', () => {
    expect(formatTimestamp('2026-11-20 10:15')).toBe('2026-11-20 10:15')
    expect(formatTimestamp('2026-13-45T99:00:00Z')).toBe('2026-13-45T99:00:00Z')
    // No zone: no moment to show in UTC.
    expect(formatTimestamp('2026-11-15T10:00:00')).toBe('2026-11-15T10:00:00')
    // A day that does not exist is not carried into the next month.
    expect(formatTimestamp('2026-02-30T10:00:00Z')).toBe('2026-02-30T10:00:00Z')
    expect(formatTimestamp('2026-02-28T23:30:00-02:00')).toBe('1 Mar 2026, 01:30 UTC')
    expect(formatTimestamp(undefined)).toBe('')
  })

  it('prints the cover, the closing block and the running footer with readable times', () => {
    const html = buildReport(
      base({ meta: { ...base().meta, generatedAt: '2026-11-15T10:00:00.000Z', exportedAt: '2026-11-16T08:05:00.000Z' } }),
    )
    expect(html).not.toContain('2026-11-15T10:00')
    // The cover, the closing block and the running footer.
    expect(html.match(/15 Nov 2026, 10:00 UTC/g)).toHaveLength(3)
    expect(html).toContain('16 Nov 2026, 08:05 UTC')
    expect(styleOf(html)).toMatch(/@bottom-center\{content:"Shop \\b7  15 Nov 2026, 10:00 UTC"/)
  })
})

describe('the running footer line', () => {
  const footer = 'Confidential: prepared for the named client only. ' + 'More footer text. '.repeat(20)

  it('is cut to about two lines with an ellipsis, while the closing block keeps all of it', () => {
    const html = buildReport(base({ brand: { name: 'Example', footer } }))
    const box = styleOf(html).match(/@bottom-left\{content:"([^"]*)"/)![1]
    expect(box.endsWith('\\2026 ')).toBe(true)
    expect(html).toContain(`<p class="rk-footer-line">${footer}</p>`)
  })

  it('clamps by code points and leaves short text alone', () => {
    expect(clampText('short', MARGIN_FOOTER_MAX)).toBe('short')
    const long = '🛡'.repeat(MARGIN_FOOTER_MAX + 5)
    const cut = clampText(long, MARGIN_FOOTER_MAX)
    expect([...cut]).toHaveLength(MARGIN_FOOTER_MAX)
    expect(cut.endsWith('…')).toBe(true)
  })
})

describe('print layout', () => {
  it('keeps headings with what follows, rows on one page, and a full-width table inside the page area', () => {
    const css = frameCss({ topLeft: '', topRight: 'T', bottomLeft: '', bottomCenter: '', page: 'Page', of: 'of' }, false)
    const print = css.slice(css.indexOf('@media print{'), css.indexOf('@page{'))
    expect(print).toContain('.rk-sections{padding:0 1px}')
    expect(print).toContain(
      '.rk-section-title,.rk-sections h2,.rk-sections h3,.rk-sections h4{break-after:avoid;page-break-after:avoid;',
    )
    expect(print).toContain('.rk-sections tr,.rk-sections td,.rk-sections th{break-inside:avoid;page-break-inside:avoid}')
    expect(print).toContain('.rk-sections thead{display:table-header-group}')
  })
})

describe('keeping a heading with what follows', () => {
  it('pairs every modern break rule with its legacy alias, which WebKit honours more consistently', () => {
    const css = frameCss({ topLeft: '', topRight: 'T', bottomLeft: '', bottomCenter: '', page: 'Page', of: 'of' }, true)
    for (const rule of css.match(/[^{}]+\{[^{}]*\}/g) ?? []) {
      for (const [, side, value] of rule.matchAll(/(?<![-\w])break-(inside|after|before):(\w+)/g)) {
        const legacy = value === 'page' ? 'always' : value
        expect(rule, rule).toContain(`page-break-${side}:${legacy}`)
      }
    }
  })

  it('puts a section title inside the figure the section opens with, which never splits', () => {
    const html = buildReport(
      base({
        sections: [
          { id: 'model', title: 'Model', html: '<figure class="rk-figure"><svg></svg></figure><p>after</p>' },
          { id: 'text', title: 'Text', html: '<p>Body</p>' },
        ],
      }),
    )
    expect(html).toContain(
      '<section class="rk-section" id="model"><figure class="rk-figure"><h2 class="rk-section-title">Model</h2><svg></svg></figure><p>after</p></section>',
    )
    expect(html).toContain('<section class="rk-section" id="text"><h2 class="rk-section-title">Text</h2><p>Body</p></section>')
  })

  it('reaches every heading\'s unbreakable box further down in print, without taking that space', () => {
    const css = frameCss({ topLeft: '', topRight: 'T', bottomLeft: '', bottomCenter: '', page: 'Page', of: 'of' }, false)
    const print = css.slice(css.indexOf('@media print{'), css.indexOf('@page{'))
    expect(print).toContain(
      '.rk-section-title::after,.rk-sections h2::after,.rk-sections h3::after,.rk-sections h4::after{content:"";' +
        'display:block;height:28mm;margin-bottom:-28mm}',
    )
    expect(css.slice(0, css.indexOf('@media print{'))).not.toContain('::after')
  })
})
