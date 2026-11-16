import { cssString } from './escape'

/** The text of the running header and footer, one string per margin box, unescaped. */
export interface MarginText {
  topLeft: string
  topRight: string
  bottomLeft: string
  bottomCenter: string
  /** "Page" and "of", around the page counters. */
  page: string
  of: string
}

/** How much of what follows a heading must fit on its page: about a table's header and first two rows. */
const KEEP_WITH_NEXT = '28mm'

/** The space the page mark takes at the top of the content area, reserved on every page. */
const MARK_SPACE = '9mm'

/**
 * The frame's stylesheet: a screen layout, and a print layout for the browser's Print to PDF. Every selector starts at
 * a frame class (`.rk-…`), apart from the page reset, so a module's CSS and the frame's cannot restyle each other's
 * blocks.
 */
export function frameCss(margin: MarginText, hasMark: boolean): string {
  const box = (text: string) => (text ? cssString(text) : 'none')
  const pageNumbers = `${cssString(`${margin.page} `)} counter(page) ${cssString(` ${margin.of} `)} counter(pages)`
  return [
    // Page reset.
    'html{-webkit-print-color-adjust:exact;print-color-adjust:exact}',
    'html,body{margin:0;padding:0;background:#ffffff;color:#1b1b1b;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    '.rk-doc{max-width:960px;margin:0 auto;padding:32px 24px}',
    // The cover: the document's header block.
    '.rk-cover{padding:24px 0 32px;border-bottom:2px solid #1b1b1b;margin-bottom:32px}',
    '.rk-brand{display:flex;align-items:center;gap:12px;margin-bottom:24px}',
    '.rk-logo{max-height:48px;max-width:240px;width:auto;height:auto}',
    '.rk-brand-name{font-weight:600;font-size:16px;color:#1b1b1b;text-decoration:none}',
    '.rk-title{font-size:28px;line-height:1.25;margin:0 0 8px}',
    '.rk-subtitle{font-size:16px;margin:0 0 16px;color:#444444}',
    '.rk-facts{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:16px 0 0}',
    '.rk-facts dt{font-weight:600;color:#444444}',
    '.rk-facts dd{margin:0;overflow-wrap:anywhere}',
    '.rk-notes{margin:16px 0 0;padding-left:20px;color:#444444}',
    '.rk-stale{border:1.5px solid #8a5a00;color:#5c3c00;padding:6px 10px;border-radius:4px;margin:12px 0 0}',
    // Sections.
    '.rk-section{margin:0 0 32px}',
    '.rk-section-title{font-size:20px;margin:0 0 12px}',
    // Figures: never split, and never taller than the page box.
    '.rk-figure{margin:16px 0;break-inside:avoid;page-break-inside:avoid}',
    '.rk-figure .rk-diagram{display:block;width:100%;height:auto}',
    '.rk-figcaption{font-size:12px;color:#555555;margin-top:6px}',
    // The footer block, at the end of the document in every browser.
    '.rk-footer{border-top:1px solid #999999;margin-top:40px;padding-top:16px;font-size:12px;color:#444444}',
    '.rk-footer-line{margin:0 0 8px}',
    '.rk-brand-note{margin:8px 0 0;font-style:italic}',
    // The page mark: one fixed element, the only mechanism, so it never prints twice. Its space is reserved on every
    // page by a spacer in a table header, which the browser repeats at the top of each printed page (padding would
    // reserve it on the first page only, and the mark would cover the top of every other).
    ...(hasMark
      ? [
          `.rk-page-mark{position:fixed;top:0;left:0;right:0;height:${MARK_SPACE};display:flex;align-items:center;` +
            'justify-content:center;font-size:11px;font-weight:600;letter-spacing:.04em;color:#7a1f1f;' +
            'border-bottom:1px solid #7a1f1f;background:#ffffff;z-index:10}',
          // Fixed layout: its one cell stays at the page's width, so a wide item cannot widen the whole document.
          '.rk-page-frame{width:100%;table-layout:fixed;border-collapse:collapse;border-spacing:0}',
          `.rk-mark-space{height:${MARK_SPACE};padding:0}`,
          '.rk-page-cell{padding:0;vertical-align:top}',
        ]
      : []),
    '@media print{',
    '.rk-doc{max-width:none;padding:0}',
    ...(hasMark ? ['.rk-page-frame thead{display:table-header-group}'] : []),
    '.rk-cover{break-after:page;page-break-after:always;break-inside:avoid;page-break-inside:avoid;border-bottom:none}',
    // A table's collapsed outer border lies half outside it, and print clips what lies outside the page area: an inset
    // of one pixel keeps a full-width table's right edge on the page.
    '.rk-sections{padding:0 1px}',
    // A heading stays with what follows it, never alone at the foot of a page. Firefox and Safari ignore
    // break-after:avoid, so the heading's unbreakable box also reaches KEEP_WITH_NEXT further down through a block of
    // no height in the layout (its negative margin gives the space back): with less than that left, it moves on.
    '.rk-section-title,.rk-sections h2,.rk-sections h3,.rk-sections h4{break-after:avoid;page-break-after:avoid;' +
      'break-inside:avoid;page-break-inside:avoid}',
    '.rk-section-title::after,.rk-sections h2::after,.rk-sections h3::after,.rk-sections h4::after{content:"";' +
      `display:block;height:${KEEP_WITH_NEXT};margin-bottom:-${KEEP_WITH_NEXT}}`,
    '.rk-page-break{break-before:page;page-break-before:always}',
    // A row on one page: on the row, and on its cells for engines that do not apply it to rows (WebKit).
    '.rk-sections tr,.rk-sections td,.rk-sections th{break-inside:avoid;page-break-inside:avoid}',
    '.rk-sections thead{display:table-header-group}',
    '.rk-figure .rk-diagram{max-height:205mm;width:auto;max-width:100%;margin:0 auto}',
    '.rk-footer{break-inside:avoid;page-break-inside:avoid}',
    '}',
    // No `size`: the reader's printer setting decides the paper.
    '@page{margin:20mm 16mm 22mm;',
    `@top-left{content:${box(margin.topLeft)};font-size:9pt;color:#555555}`,
    `@top-right{content:${box(margin.topRight)};font-size:9pt;color:#555555}`,
    `@bottom-left{content:${box(margin.bottomLeft)};font-size:8pt;color:#555555}`,
    `@bottom-center{content:${box(margin.bottomCenter)};font-size:8pt;color:#555555}`,
    `@bottom-right{content:${pageNumbers};font-size:8pt;color:#555555}`,
    '}',
    // The cover is its own page, with no running header or footer.
    '@page :first{@top-left{content:none}@top-right{content:none}@bottom-left{content:none}' +
      '@bottom-center{content:none}@bottom-right{content:none}}',
  ].join('\n')
}
