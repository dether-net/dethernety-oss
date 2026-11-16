/** The parts of a report's file name: `<kind>[-<variant>]-<stamp>`. */
export interface ReportFileName {
  kind: string
  stamp: string
  variant?: string
}

// Only characters that are safe in a file name on every system; anything else becomes a dash.
const part = (value: string | undefined) =>
  String(value ?? '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

/** The file name a report downloads as. */
export function reportFileName(name: ReportFileName): string {
  const stem = [part(name.kind) || 'report', part(name.variant), part(name.stamp)].filter(Boolean).join('-')
  return `${stem}.html`
}

/**
 * Saves the report. The only place that knows the output format: today an HTML file the reader prints to PDF from
 * the browser; a later format changes this, and the modules that call it do not change.
 */
export function download(report: string, name: ReportFileName): void {
  const url = URL.createObjectURL(new Blob([report], { type: 'text/html;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = reportFileName(name)
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoked on the next task: some browsers read the URL after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
