/** The installation's brand as `/config` carries it under `branding`. */
export interface BrandingConfig {
  name: string
  url?: string
  footer?: string
  /** The logo at its content-addressed path, `/branding/logo/<sha256>`, with its size in pixels. */
  logoUrl?: string
  logoWidth?: number
  logoHeight?: number
}

/** Where dt-ws serves the logo, by the SHA-256 of its bytes. */
export const LOGO_PATH_PREFIX = '/branding/logo/'
const LOGO_DIGEST = /^[0-9a-f]{64}$/
const LOGO_MAX_PIXELS = 2048

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

/** The logo's path: the prefix, then the 64 lower-case hex digits of its SHA-256, and nothing after. */
const logoPath = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(LOGO_PATH_PREFIX) && LOGO_DIGEST.test(value.slice(LOGO_PATH_PREFIX.length))

const pixels = (value: unknown): number | undefined =>
  Number.isInteger(value) && (value as number) > 0 && (value as number) <= LOGO_MAX_PIXELS ? (value as number) : undefined

/** An https URL with no user name or password in it; undefined for anything else. */
export function httpsUrl(value: unknown): string | undefined {
  const raw = text(value)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password ? raw : undefined
  } catch {
    return undefined
  }
}

/**
 * The brand from `/config`, checked again on this side: a value that is not what dt-ws serves is dropped, and a brand
 * without a name is no brand. The logo is kept only with its path and both dimensions.
 */
export function parseBrandingConfig(raw: unknown): BrandingConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const name = text(source.name)
  if (!name) return null
  const brand: BrandingConfig = { name }
  const url = httpsUrl(source.url)
  if (url) brand.url = url
  const footer = text(source.footer)
  if (footer) brand.footer = footer
  const logoUrl = logoPath(source.logoUrl) ? source.logoUrl : undefined
  const logoWidth = pixels(source.logoWidth)
  const logoHeight = pixels(source.logoHeight)
  if (logoUrl && logoWidth && logoHeight) Object.assign(brand, { logoUrl, logoWidth, logoHeight })
  return brand
}
