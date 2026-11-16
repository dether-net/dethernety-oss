/**
 * The installation's brand file, checked without touching the disk: the JSON it holds and the logo
 * beside it. Everything here is pure, so the rules can be tested on bytes alone.
 */

import { FORBIDDEN_DISPLAY_CHARS, codePoints } from '../common/utils/display-text';

/** `brand.json` is small text; anything larger is not a brand file. */
export const BRAND_JSON_MAX_BYTES = 8 * 1024;
/** The logo's size on disk. */
export const LOGO_MAX_BYTES = 256 * 1024;
/** The logo's width and height in pixels: a small file can declare a huge image. */
export const LOGO_MAX_PIXELS = 2048;

const NAME_MAX = 120;
const FOOTER_MAX = 300;
const URL_MAX = 300;
const LOGO_NAME_MAX = 255;

/** The fields the brand file may set. */
export interface Brand {
  name: string;
  url?: string;
  footer?: string;
  /** A file name in the brand file's own folder. */
  logo?: string;
}

export type BrandParse =
  /** `logoProblem`: the `logo` value was unusable, so the brand goes without a logo. */
  | { kind: 'ok'; brand: Brand; ignoredKeys: string[]; logoProblem?: string }
  | { kind: 'refused'; reason: string };

export type LogoType = 'image/png' | 'image/jpeg' | 'image/webp';

export type LogoSniff =
  | { kind: 'ok'; type: LogoType; width: number; height: number }
  | { kind: 'refused'; reason: string };

const KNOWN_KEYS = new Set(['name', 'url', 'footer', 'logo']);

function text(value: unknown, key: string, max: number): { value?: string; reason?: string } {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'string') return { reason: `"${key}" must be a string` };
  const trimmed = value.trim();
  if (trimmed === '') return {};
  if (codePoints(trimmed) > max) return { reason: `"${key}" is longer than ${max} characters` };
  if (FORBIDDEN_DISPLAY_CHARS.test(trimmed)) {
    return { reason: `"${key}" contains a control or text-direction character` };
  }
  return { value: trimmed };
}

/** Parses and checks `brand.json`. Unknown keys are ignored and reported, so a newer file works here. */
export function parseBrandJson(source: string): BrandParse {
  let parsed: unknown;
  try {
    // A file saved with a byte-order mark is still JSON.
    parsed = JSON.parse(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  } catch {
    return { kind: 'refused', reason: 'it is not valid JSON' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { kind: 'refused', reason: 'it is not a JSON object' };
  }
  const input = parsed as Record<string, unknown>;

  const name = text(input.name, 'name', NAME_MAX);
  if (name.reason) return { kind: 'refused', reason: name.reason };
  if (!name.value) return { kind: 'refused', reason: '"name" is required' };

  const footer = text(input.footer, 'footer', FOOTER_MAX);
  if (footer.reason) return { kind: 'refused', reason: footer.reason };

  const brand: Brand = { name: name.value };
  if (footer.value) brand.footer = footer.value;

  if (input.url !== undefined && input.url !== null && input.url !== '') {
    if (typeof input.url !== 'string') return { kind: 'refused', reason: '"url" must be a string' };
    const url = checkUrl(input.url.trim());
    if ('reason' in url) return { kind: 'refused', reason: url.reason };
    brand.url = url.href;
  }

  // An unusable logo value costs the logo only, as an unusable logo file does: the rest of the brand applies.
  let logoProblem: string | undefined;
  if (input.logo !== undefined && input.logo !== null) {
    const logo = input.logo;
    if (
      typeof logo !== 'string' ||
      logo === '' ||
      logo.startsWith('.') ||
      logo.includes('/') ||
      logo.includes('\\') ||
      codePoints(logo) > LOGO_NAME_MAX ||
      FORBIDDEN_DISPLAY_CHARS.test(logo)
    ) {
      logoProblem = '"logo" must be a plain file name in the same folder';
    } else {
      brand.logo = logo;
    }
  }

  const ignoredKeys = Object.keys(input).filter((key) => !KNOWN_KEYS.has(key));
  return { kind: 'ok', brand, ignoredKeys, ...(logoProblem ? { logoProblem } : {}) };
}

/** An https URL with no user name or password. */
export function checkUrl(value: string): { href: string } | { reason: string } {
  if (codePoints(value) > URL_MAX) return { reason: `"url" is longer than ${URL_MAX} characters` };
  if (FORBIDDEN_DISPLAY_CHARS.test(value)) return { reason: '"url" contains a control or text-direction character' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { reason: '"url" is not a valid URL' };
  }
  if (url.protocol !== 'https:') return { reason: '"url" must start with https://' };
  if (url.username || url.password) return { reason: '"url" must not carry a user name or password' };
  return { href: url.href };
}

/**
 * The logo's type and pixel size, read from the header bytes. The type comes from the bytes, never
 * from the file name: PNG, JPEG and WebP only, so an SVG (or anything else) is refused.
 */
export function sniffLogo(bytes: Buffer): LogoSniff {
  const size = sniffSize(bytes);
  if (!size) return { kind: 'refused', reason: 'it is not a PNG, JPEG or WebP image' };
  const { type, width, height } = size;
  if (!(width > 0 && height > 0)) return { kind: 'refused', reason: 'its header declares no size' };
  if (width > LOGO_MAX_PIXELS || height > LOGO_MAX_PIXELS) {
    return {
      kind: 'refused',
      reason: `it is ${width}×${height} pixels, over the ${LOGO_MAX_PIXELS}×${LOGO_MAX_PIXELS} limit`,
    };
  }
  return { kind: 'ok', type, width, height };
}

function sniffSize(bytes: Buffer): { type: LogoType; width: number; height: number } | null {
  if (isPng(bytes)) return png(bytes);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return jpeg(bytes);
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    return webp(bytes);
  }
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const isPng = (bytes: Buffer) => bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);

function png(bytes: Buffer) {
  // The first chunk is IHDR: length (4), type (4), then width and height (4 each, big-endian).
  if (bytes.length < 24 || bytes.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { type: 'image/png' as const, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// Start-of-frame markers carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but do not.
const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

// The segments that may come before the scan besides the frame: APPn, COM, DQT, DHT, DAC and DRI.
const isHeaderSegment = (marker: number) =>
  (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe || marker === 0xdb || marker === 0xc4 || marker === 0xcc || marker === 0xdd;

/** An APP2 segment holding a Multi-Picture Format index, which points a decoder at a second image in the file. */
const isMultiPicture = (bytes: Buffer, marker: number, at: number, length: number) =>
  marker === 0xe2 && length >= 6 && bytes.toString('latin1', at + 2, at + 6) === 'MPF\0';

/**
 * The frame size of a JPEG, read the strict way, start to end: every segment must be one that may come where it is,
 * with a length inside the file; there is exactly one frame; the scans are followed to the end-of-image marker, and
 * nothing may come after it. A decoder skips what it does not understand and reads the next marker it finds, and some
 * decode a second image appended after the first (a gain map), so anything looser lets a hidden frame escape the size
 * limit.
 */
function jpeg(bytes: Buffer) {
  let size: { type: 'image/jpeg'; width: number; height: number } | null = null;
  let scanned = false;
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    // Fill bytes: any number of 0xFF before the marker.
    while (i < bytes.length && bytes[i] === 0xff) i++;
    if (i >= bytes.length) return null;
    const marker = bytes[i];
    i++;
    // The end of the image: valid only after a scan, and only as the last thing in the file.
    if (marker === 0xd9) return scanned && i === bytes.length ? size : null;
    if (i + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(i);
    if (length < 2 || i + length > bytes.length) return null;
    if (marker === 0xda) {
      if (!size) return null;
      i += length;
      // The scan's coded data, up to the next marker: in it, 0xFF is followed by a stuffed 00, a restart marker, or
      // more fill bytes.
      for (;;) {
        while (i < bytes.length && bytes[i] !== 0xff) i++;
        let j = i + 1;
        while (j < bytes.length && bytes[j] === 0xff) j++;
        if (j >= bytes.length) return null;
        if (bytes[j] === 0x00 || (bytes[j] >= 0xd0 && bytes[j] <= 0xd7)) {
          i = j + 1;
          continue;
        }
        break;
      }
      scanned = true;
      continue;
    }
    if (isStartOfFrame(marker)) {
      // A second frame, or one too short for its size fields: length (2), precision (1), height (2), width (2).
      if (size || length < 7) return null;
      size = { type: 'image/jpeg', height: bytes.readUInt16BE(i + 3), width: bytes.readUInt16BE(i + 5) };
    } else if (!isHeaderSegment(marker) || isMultiPicture(bytes, marker, i, length)) {
      return null;
    }
    i += length;
  }
  return null;
}

function webp(bytes: Buffer) {
  if (bytes.length < 30) return null;
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8 ') {
    // Lossy: a 3-byte frame tag, the start code 9D 01 2A, then 14-bit width and height.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      type: 'image/webp' as const,
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === 'VP8L') {
    // Lossless: the signature 0x2F, then width - 1 and height - 1 in 14 bits each.
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes.readUInt32LE(21);
    return { type: 'image/webp' as const, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Extended: flags (1), reserved (3), then canvas width - 1 and height - 1 in 24 bits each.
    return { type: 'image/webp' as const, width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  return null;
}
