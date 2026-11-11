/**
 * Repository text on its way to a model: bounded as data, or reduced to a safe
 * name for prose the model reads as context. Light on purpose: hooks import it.
 */

const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Zl}\p{Zp}]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/gu

/** Repository text as data: invisible and control characters removed, at most `max` characters. */
export function boundedText(value: string, max = 128): string {
  return value.replace(INVISIBLE, '').slice(0, max).replace(INVISIBLE, '')
}

/**
 * Repository text for prose the model reads as context: word characters, space,
 * dot and hyphen only, at most 64 characters. Anything else becomes `_`.
 */
export function safeName(value: string): string {
  const safe = value.replace(/[^\w .-]/g, '_').slice(0, 64).trim()
  return safe || 'Unnamed'
}
