import { getConfig } from '@/config/environment'
import { LOGO_PATH_PREFIX, parseBrandingConfig, type BrandingConfig } from '@/config/branding'

/** The installation's brand as a report prints it: the logo inlined, so the report stays one self-contained file. */
export interface Brand {
  name: string
  url?: string
  footer?: string
  logo?: { dataUri: string; width: number; height: number }
}

export interface BrandDeps {
  /** A development build reads its config from the VITE_ variables, so it reads /config's branding itself. */
  dev: boolean
  config: () => Promise<{ graphqlUrl: string; branding?: BrandingConfig | null }>
  fetch: typeof fetch
}

const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const LOGO_MAX_BYTES = 256 * 1024

function base64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

async function brandingFrom(deps: BrandDeps): Promise<{ branding: BrandingConfig | null; api: string }> {
  const config = await deps.config()
  if (!deps.dev) return { branding: config.branding ?? null, api: config.graphqlUrl }
  const response = await deps.fetch('/config')
  if (!response.ok) return { branding: null, api: config.graphqlUrl }
  const body = (await response.json()) as { branding?: unknown }
  return { branding: parseBrandingConfig(body?.branding), api: config.graphqlUrl }
}

/** The logo as a data URI, fetched from the API server by its hashed path; null when it cannot be had. */
async function logoDataUri(deps: BrandDeps, branding: BrandingConfig, api: string): Promise<string | null> {
  if (!branding.logoUrl) return null
  const base = new URL(api, globalThis.location?.href)
  const url = new URL(branding.logoUrl, base)
  if (url.origin !== base.origin || !url.pathname.startsWith(LOGO_PATH_PREFIX)) return null
  // No redirect: the bytes must come from the path checked above.
  const response = await deps.fetch(url.href, { redirect: 'error' })
  if (!response.ok) return null
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!LOGO_TYPES.has(type)) return null
  if (Number(response.headers.get('content-length') ?? 0) > LOGO_MAX_BYTES) return null
  const bytes = await readCapped(response, LOGO_MAX_BYTES)
  if (!bytes || bytes.length === 0) return null
  return `data:${type};base64,${base64(bytes)}`
}

/** The body, read no further than `max` bytes; null when it is longer. */
async function readCapped(response: Response, max: number): Promise<Uint8Array | null> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.length > max ? null : bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.length
    if (length > max) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

async function loadBrand(deps: BrandDeps): Promise<Brand | null> {
  const { branding, api } = await brandingFrom(deps)
  if (!branding) return null
  const brand: Brand = { name: branding.name }
  if (branding.url) brand.url = branding.url
  if (branding.footer) brand.footer = branding.footer
  try {
    const dataUri = await logoDataUri(deps, branding, api)
    if (dataUri && branding.logoWidth && branding.logoHeight) {
      brand.logo = Object.freeze({ dataUri, width: branding.logoWidth, height: branding.logoHeight })
    }
  } catch {
    // A logo that cannot be fetched leaves the brand without one.
  }
  // Every module gets this one object: frozen, so none can change what another prints.
  return Object.freeze(brand)
}

/**
 * The brand, read once per page load: the first call starts the fetch, and every later call resolves from it, so the
 * download a report makes on a click is not delayed by it. Any failure gives an unbranded report, never an error.
 */
export function createBrandSource(deps: BrandDeps): () => Promise<Brand | null> {
  let pending: Promise<Brand | null> | null = null
  return () => {
    pending ??= loadBrand(deps).catch(() => null)
    return pending
  }
}

export const defaultBrandDeps: BrandDeps = {
  dev: import.meta.env.DEV,
  config: getConfig,
  fetch: (...args) => globalThis.fetch(...args),
}
