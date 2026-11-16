/**
 * Escaping for the text a report prints: HTML text and attributes, and strings placed in a stylesheet.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Text for HTML content or a quoted attribute. null and undefined print as nothing; anything else as its string. */
export function escapeHtml(text: unknown): string {
  if (text === null || text === undefined) return ''
  return String(text).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch])
}

// Letters, digits, space and punctuation that cannot end a CSS string or the <style> element around it.
const CSS_SAFE = /[A-Za-z0-9 .,:;!?()\-_/@#%+=*]/

/**
 * A quoted CSS string for `content:` in a stylesheet. Every character outside a small safe set is hex-escaped (quotes,
 * backslashes, `<`, `>`, `&` and line breaks included), so the text can end neither the string nor the `<style>`
 * element.
 */
export function cssString(text: unknown): string {
  let out = ''
  for (const ch of String(text ?? '')) {
    out += CSS_SAFE.test(ch) ? ch : `\\${ch.codePointAt(0)!.toString(16)} `
  }
  return `"${out}"`
}
