import { httpsUrl } from '@/config/branding'
import type { Brand } from './brand'
import { escapeHtml } from './escape'
import { frameCss } from './frame.css'
import type { ReportDetails } from './reportDetails'

/** Every word the frame prints. A report in another language passes them all. */
export interface FrameStrings {
  preparedFor: string
  model: string
  modelId: string
  client: string
  author: string
  project: string
  reportDetails: string
  generated: string
  module: string
  fingerprint: string
  exported: string
  exportedBy: string
  stale: string
  brandAppliedAtExport: string
  aboutThisReport: string
  page: string
  of: string
}

export const DEFAULT_FRAME_STRINGS: FrameStrings = {
  preparedFor: 'Prepared for',
  model: 'Model',
  modelId: 'Model ID',
  client: 'Client',
  author: 'Author',
  project: 'Project',
  reportDetails: 'Report details',
  generated: 'Generated',
  module: 'Module',
  fingerprint: 'Fingerprint',
  exported: 'Exported',
  exportedBy: 'Exported by',
  stale: 'The model has changed since this report was generated.',
  brandAppliedAtExport: 'The brand on this report was applied when it was exported; it is not part of its content.',
  aboutThisReport: 'About this report',
  page: 'Page',
  of: 'of',
}

/** What a report says about itself. */
export interface ReportFacts {
  modelName?: string
  modelId: string
  clientName?: string
  module: { name: string; version: string }
  generatedAt: string
  fingerprint?: string
  stale?: boolean
  /** Taken by the module at the click. */
  exportedAt: string
  /** Printed only when the report details name no author. */
  exportedBy?: string
  /**
   * The analysis's report details as `reportDetails.get` returns them, passed as they are: the frame prints the
   * project, the author and the custom fields, and the client when `clientName` is not given.
   */
  reportDetails?: ReportDetails
}

export interface ReportSection {
  id: string
  title: string
  /** The module's own markup, trusted: the module escapes what it puts in it. */
  html: string
  pageBreakBefore?: boolean
}

export interface ReportInput {
  /** `[a-z0-9-]+`: the module's report class (`<kind>-report`) and its file name stem. */
  kind: string
  title: string
  /** The document's language, e.g. 'en' or 'hu-HU'. */
  locale?: string
  strings?: Partial<FrameStrings>
  /** The brand, passed in so building stays synchronous; checked again here. */
  brand: Brand | null
  meta: ReportFacts
  cover?: { subtitle?: string; notes?: string[] }
  /** Text printed at the top of every page, the cover included, such as a draft mark. */
  pageMark?: string
  sections: ReportSection[]
  /** The module's report CSS, scoped under `.<kind>-report`. */
  css?: string
}

/** The document's policy: everything it needs is inline, so it can load nothing and send nothing. */
export const REPORT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

const KIND = /^[a-z0-9-]+$/
const SECTION_ID = /^[a-z0-9-]+$/
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/
const LOGO_DATA_URI = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/

/** The brand as given, with anything that is not what the platform serves dropped rather than printed. */
function checkedBrand(brand: Brand | null | undefined): Brand | null {
  if (!brand || typeof brand.name !== 'string' || brand.name.trim() === '') return null
  const out: Brand = { name: brand.name }
  const url = httpsUrl(brand.url)
  if (url) out.url = url
  if (typeof brand.footer === 'string' && brand.footer.trim() !== '') out.footer = brand.footer
  const logo = brand.logo
  if (
    logo &&
    typeof logo.dataUri === 'string' &&
    LOGO_DATA_URI.test(logo.dataUri) &&
    Number.isInteger(logo.width) &&
    Number.isInteger(logo.height) &&
    logo.width > 0 &&
    logo.height > 0
  ) {
    out.logo = { dataUri: logo.dataUri, width: logo.width, height: logo.height }
  }
  return out
}

function strings(given: Partial<FrameStrings> | undefined): FrameStrings {
  const out = { ...DEFAULT_FRAME_STRINGS }
  for (const key of Object.keys(DEFAULT_FRAME_STRINGS) as (keyof FrameStrings)[]) {
    const value = given?.[key]
    if (typeof value === 'string') out[key] = value
  }
  return out
}

/**
 * A section's markup as the report carries it. Interactive disclosure prints unpredictably, so a <details> becomes a
 * plain block. And a document-level tag the policy above does not govern (a refresh or a link to prefetch could send
 * text out without any script) is renamed into an inert element, so an escaping slip in a module cannot use one.
 */
function sectionMarkup(html: string): string {
  return html
    .replace(/<details\b/gi, '<div')
    .replace(/<\/details\s*>/gi, '</div>')
    .replace(/<summary\b/gi, '<div')
    .replace(/<\/summary\s*>/gi, '</div>')
    .replace(/<(\/?)(meta|link|base)\b/gi, '<$1x-$2')
}

const fact = (term: string, value: string | undefined) =>
  value ? `<dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd>` : ''

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

/** The most custom fields the server keeps; the frame prints no more. */
const CUSTOM_FIELDS_MAX = 10

/**
 * The custom fields the frame prints: those whose label and value are both text, in the order given, each read once
 * into a plain copy.
 */
function customFields(details: ReportDetails | undefined): { label: string; value: string }[] {
  const fields: unknown = details?.customFields
  if (!Array.isArray(fields)) return []
  const out: { label: string; value: string }[] = []
  for (const field of fields) {
    if (out.length === CUSTOM_FIELDS_MAX) break
    if (field === null || typeof field !== 'object') continue
    const label = text(field.label)
    const value = text(field.value)
    if (label && value) out.push({ label, value })
  }
  return out
}

const detailRow = (field: { label: string; value: string }) =>
  `<tr><th scope="row">${escapeHtml(field.label)}</th><td>${escapeHtml(field.value)}</td></tr>`

/** How a diagram's figure opens, as renderModelDiagram writes it. */
const FIGURE_OPEN = '<figure class="rk-figure">'

/** The longest brand footer the running footer prints: about two lines of its box; the closing block has it all. */
export const MARGIN_FOOTER_MAX = 90

/** `text` cut to at most `max` characters (counted as code points), ending in an ellipsis when cut. */
export function clampText(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

/** An ISO date and time with its zone (Z or an offset): one that names a moment, so it can be shown in UTC. */
export const ISO_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/

/**
 * An ISO timestamp as a reader reads it, in UTC: "15 Nov 2026, 10:00 UTC" in English, in the report's own language
 * otherwise. Anything else is printed as given: a time without a zone, which names no moment, and a date that does not
 * exist (30 February), which the parser would carry into the next month.
 */
export function formatTimestamp(value: string | undefined, locale?: string): string {
  if (!value) return ''
  const time = ISO_MOMENT.test(value) ? Date.parse(value) : NaN
  if (!Number.isFinite(time) || !sameCalendarDay(value, time)) return value
  const tag = !locale || /^en(-|$)/i.test(locale) ? 'en-GB' : locale
  try {
    const text = new Intl.DateTimeFormat(tag, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'UTC',
    }).format(time)
    return `${text} UTC`
  } catch {
    return value
  }
}

/** Whether the date written in an ISO timestamp is the date it parses to, in its own offset. */
function sameCalendarDay(value: string, time: number): boolean {
  const zone = value.match(/(Z|[+-]\d{2}:?\d{2})$/)![1]
  const offset = zone === 'Z' ? 0 : (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)))
  return new Date(time + offset * 60_000).toISOString().slice(0, 10) === value.slice(0, 10)
}

/**
 * A complete, self-contained HTML document for a report: a cover, the module's sections, and a footer block, with a
 * print stylesheet for the browser's Print to PDF. Every field the frame prints itself is escaped; section markup and
 * CSS are the module's.
 */
export function buildReport(input: ReportInput): string {
  const s = strings(input.strings)
  const brand = checkedBrand(input.brand)
  const meta = input.meta
  const kind = KIND.test(input.kind) ? input.kind : 'report'
  const lang = typeof input.locale === 'string' && LOCALE.test(input.locale) ? ` lang="${input.locale}"` : ''
  const modelLabel = meta.modelName || meta.modelId
  const locale = lang ? input.locale : undefined
  const generatedAt = formatTimestamp(meta.generatedAt, locale)
  const exportedAt = formatTimestamp(meta.exportedAt, locale)
  const mark = typeof input.pageMark === 'string' && input.pageMark.trim() !== '' ? input.pageMark : ''
  const details = meta.reportDetails !== null && typeof meta.reportDetails === 'object' ? meta.reportDetails : undefined
  const client = meta.clientName || text(details?.client)
  const author = text(details?.author)
  const project = text(details?.project)
  const fields = customFields(details)

  const css = frameCss(
    {
      topLeft: brand?.name ?? '',
      topRight: input.title,
      bottomLeft: clampText(brand?.footer ?? '', MARGIN_FOOTER_MAX),
      bottomCenter: [modelLabel, generatedAt].filter(Boolean).join(' · '),
      page: s.page,
      of: s.of,
    },
    Boolean(mark),
  )

  const brandBlock = brand
    ? `<div class="rk-brand">${
        brand.logo
          ? `<img class="rk-logo" src="${escapeHtml(brand.logo.dataUri)}" width="${brand.logo.width}" ` +
            `height="${brand.logo.height}" alt="${escapeHtml(brand.name)}">`
          : ''
      }${
        brand.url
          ? `<a class="rk-brand-name" href="${escapeHtml(brand.url)}">${escapeHtml(brand.name)}</a>`
          : `<span class="rk-brand-name">${escapeHtml(brand.name)}</span>`
      }</div>`
    : ''

  const notes = (input.cover?.notes ?? []).filter((note) => typeof note === 'string' && note !== '')
  const cover =
    `<header class="rk-cover">${brandBlock}<h1 class="rk-title">${escapeHtml(input.title)}</h1>` +
    (input.cover?.subtitle ? `<p class="rk-subtitle">${escapeHtml(input.cover.subtitle)}</p>` : '') +
    `<dl class="rk-facts">` +
    fact(s.model, modelLabel) +
    fact(s.preparedFor, client) +
    fact(s.project, project) +
    fact(s.author, author) +
    fact(s.generated, generatedAt) +
    fact(s.module, `${meta.module.name} ${meta.module.version}`.trim()) +
    `</dl>` +
    // What the user added, titled and styled apart from the facts above, so a label cannot pass for one of them.
    (fields.length
      ? `<section class="rk-details"><p class="rk-details-title">${escapeHtml(s.reportDetails)}</p><table><tbody>` +
        fields.map(detailRow).join('') +
        `</tbody></table></section>`
      : '') +
    (meta.stale ? `<p class="rk-stale">${escapeHtml(s.stale)}</p>` : '') +
    (notes.length ? `<ul class="rk-notes">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul>` : '') +
    `</header>`

  const sections = input.sections
    .map((section) => {
      const id = typeof section.id === 'string' && SECTION_ID.test(section.id) ? ` id="${section.id}"` : ''
      const cls = section.pageBreakBefore ? 'rk-section rk-page-break' : 'rk-section'
      const title = `<h2 class="rk-section-title">${escapeHtml(section.title)}</h2>`
      const body = sectionMarkup(String(section.html ?? ''))
      // A section that opens with a figure (a diagram) carries its title inside that figure, which never splits, so
      // the title cannot stay behind on the page before the drawing.
      return body.startsWith(FIGURE_OPEN)
        ? `<section class="${cls}"${id}>${FIGURE_OPEN}${title}${body.slice(FIGURE_OPEN.length)}</section>`
        : `<section class="${cls}"${id}>${title}${body}</section>`
    })
    .join('')

  const footer =
    `<footer class="rk-footer">` +
    (brand?.footer ? `<p class="rk-footer-line">${escapeHtml(brand.footer)}</p>` : '') +
    `<h2 class="rk-section-title">${escapeHtml(s.aboutThisReport)}</h2>` +
    `<dl class="rk-facts">` +
    fact(s.model, meta.modelName) +
    fact(s.modelId, meta.modelId) +
    fact(s.client, client) +
    fact(s.project, project) +
    fact(s.module, `${meta.module.name} ${meta.module.version}`.trim()) +
    fact(s.generated, generatedAt) +
    fact(s.fingerprint, meta.fingerprint) +
    fact(s.exported, exportedAt) +
    fact(s.author, author) +
    // An author named by the user replaces the exporting account, which can be an email address.
    (author ? '' : fact(s.exportedBy, meta.exportedBy)) +
    `</dl>` +
    (meta.stale ? `<p class="rk-stale">${escapeHtml(s.stale)}</p>` : '') +
    (brand ? `<p class="rk-brand-note">${escapeHtml(s.brandAppliedAtExport)}</p>` : '') +
    `</footer>`

  const doc = `<div class="rk-doc">${cover}<main class="${kind}-report rk-sections">${sections}</main>${footer}</div>`

  return (
    `<!DOCTYPE html><html${lang}><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">` +
    // DNS prefetch is outside the policy in some browsers.
    `<meta http-equiv="x-dns-prefetch-control" content="off">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escapeHtml(input.title)}</title><style>${css}</style>` +
    (input.css ? `<style>${input.css}</style>` : '') +
    `</head><body>` +
    (mark
      ? `<div class="rk-page-mark">${escapeHtml(mark)}</div>` +
        `<table class="rk-page-frame" role="presentation"><thead><tr><td class="rk-mark-space"></td></tr></thead>` +
        `<tbody><tr><td class="rk-page-cell">${doc}</td></tr></tbody></table>`
      : doc) +
    `</body></html>`
  )
}
