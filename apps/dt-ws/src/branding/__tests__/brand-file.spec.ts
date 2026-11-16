import { LOGO_MAX_PIXELS, parseBrandJson, sniffLogo } from '../brand-file';
import {
  gifLogo,
  jpegDecoyFrame,
  jpegHeader,
  jpegProgressive,
  jpegTwoFrames,
  jpegWithImageAfterEnd,
  jpegWithMultiPicture,
  jpegWithTableBeforeFrame,
  jpegWithoutScan,
  pngHeader,
  svgLogo,
  webpExtendedHeader,
  webpLosslessHeader,
  webpLossyHeader,
} from './logo-fixtures';

/** The brand file's rules on bytes alone: what `brand.json` may hold, and which logos pass. */

const parse = (value: unknown) => parseBrandJson(JSON.stringify(value));
const refusal = (value: unknown) => {
  const result = parse(value);
  return result.kind === 'refused' ? result.reason : null;
};

describe('parseBrandJson', () => {
  it('accepts a full brand, trimmed', () => {
    expect(
      parse({ name: '  Example Studio ', url: 'https://example.com/about', footer: ' Confidential ', logo: 'logo.png' }),
    ).toEqual({
      kind: 'ok',
      brand: { name: 'Example Studio', url: 'https://example.com/about', footer: 'Confidential', logo: 'logo.png' },
      ignoredKeys: [],
    });
  });

  it('needs only a name, and leaves empty optional fields out', () => {
    expect(parse({ name: 'Example', footer: '  ', url: '' })).toEqual({
      kind: 'ok',
      brand: { name: 'Example' },
      ignoredKeys: [],
    });
  });

  it('ignores unknown keys and reports them, so a newer file works here', () => {
    expect(parse({ name: 'Example', colors: { accent: '#123456' } })).toEqual({
      kind: 'ok',
      brand: { name: 'Example' },
      ignoredKeys: ['colors'],
    });
  });

  it.each([
    ['not JSON', '{name:', 'it is not valid JSON'],
    ['an array', '[]', 'it is not a JSON object'],
    ['null', 'null', 'it is not a JSON object'],
  ])('refuses %s', (_label, source, reason) => {
    expect(parseBrandJson(source)).toEqual({ kind: 'refused', reason });
  });

  it('reads a file saved with a byte-order mark', () => {
    expect(parseBrandJson('\ufeff' + JSON.stringify({ name: 'Example' }))).toEqual({
      kind: 'ok',
      brand: { name: 'Example' },
      ignoredKeys: [],
    });
  });

  it.each([
    ['no name', {}],
    ['an empty name', { name: '   ' }],
    ['a name that is not a string', { name: 42 }],
  ])('refuses %s', (_label, value) => {
    expect(refusal(value)).toMatch(/"name"/);
  });

  it('counts the name and footer limits in code points', () => {
    expect(refusal({ name: '🙂'.repeat(120) })).toBeNull();
    expect(refusal({ name: '🙂'.repeat(121) })).toMatch(/longer than 120/);
    expect(refusal({ name: 'x', footer: 'é'.repeat(300) })).toBeNull();
    expect(refusal({ name: 'x', footer: 'é'.repeat(301) })).toMatch(/longer than 300/);
  });

  it.each([
    ['a C0 control', 'Exam\u0007ple'],
    ['a C1 control', 'Exam\u0085ple'],
    ['a bidi override', 'Exam\u202eple'],
    ['a bidi isolate', 'Exam\u2066ple'],
    ['a newline', 'Exam\nple'],
    ['a line separator', 'Exam\u2028ple'],
  ])('refuses %s in the name and the footer', (_label, value) => {
    expect(refusal({ name: value })).toMatch(/control or text-direction/);
    expect(refusal({ name: 'x', footer: value })).toMatch(/control or text-direction/);
  });

  it.each([
    ['http', 'http://example.com', /https/],
    ['javascript', 'javascript:alert(1)', /https/],
    ['a protocol-relative URL', '//example.com', /not a valid URL/],
    ['user info', 'https://user:pass@example.com', /user name or password/],
    ['a user name alone', 'https://user@example.com', /user name or password/],
    ['a URL over 300 characters', `https://example.com/${'a'.repeat(300)}`, /longer than 300/],
    ['a non-string', 12, /must be a string/],
  ])('refuses a url with %s', (_label, url, reason) => {
    expect(refusal({ name: 'x', url })).toMatch(reason);
  });

  it.each([
    ['empty', ''],
    ['a dot', '.'],
    ['a dot file', '.logo.png'],
    ['a parent path', '../logo.png'],
    ['a sub-folder', 'img/logo.png'],
    ['a backslash', 'img\\logo.png'],
    ['a non-string', 7],
  ])('drops only the logo when its name is %s', (_label, logo) => {
    expect(parse({ name: 'x', footer: 'f', logo })).toEqual({
      kind: 'ok',
      brand: { name: 'x', footer: 'f' },
      ignoredKeys: [],
      logoProblem: '"logo" must be a plain file name in the same folder',
    });
  });

  it('refuses a url with a control or text-direction character', () => {
    expect(refusal({ name: 'x', url: 'https://example.com/\u202eabc' })).toMatch(/control or text-direction/);
  });
});

describe('sniffLogo', () => {
  it.each([
    ['PNG', pngHeader(320, 80), 'image/png'],
    ['JPEG', jpegHeader(320, 80), 'image/jpeg'],
    ['progressive JPEG', jpegHeader(320, 80, 0xc2), 'image/jpeg'],
    ['JPEG with a table and a fill byte before its frame', jpegWithTableBeforeFrame(320, 80), 'image/jpeg'],
    ['progressive JPEG with two scans', jpegProgressive(320, 80), 'image/jpeg'],
    ['lossy WebP', webpLossyHeader(320, 80), 'image/webp'],
    ['lossless WebP', webpLosslessHeader(320, 80), 'image/webp'],
    ['extended WebP', webpExtendedHeader(320, 80), 'image/webp'],
  ])('reads the type and size of a %s logo from its header', (_label, bytes, type) => {
    expect(sniffLogo(bytes)).toEqual({ kind: 'ok', type, width: 320, height: 80 });
  });

  it('takes the type from the bytes, whatever the file is called', () => {
    // There is no name here at all: a PNG saved as logo.jpg is still a PNG.
    expect(sniffLogo(pngHeader(10, 10))).toMatchObject({ type: 'image/png' });
  });

  it.each([
    ['an SVG', svgLogo],
    ['a GIF', gifLogo],
    ['empty bytes', Buffer.alloc(0)],
    ['a truncated PNG', pngHeader(10, 10).subarray(0, 20)],
    ['a JPEG with no frame before its scan', Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0])],
    ['a truncated WebP', webpLossyHeader(10, 10).subarray(0, 24)],
    ['a JPEG hiding its real frame behind a stray FF 00 and a decoy', jpegDecoyFrame()],
    ['a JPEG with two frames', jpegTwoFrames()],
    ['a JPEG with no scan', jpegWithoutScan()],
    ['a JPEG with another image after its end', jpegWithImageAfterEnd()],
    ['a JPEG with a Multi-Picture index', jpegWithMultiPicture()],
    ['a JPEG cut off in its scan', jpegHeader(10, 10).subarray(0, -2)],
  ])('refuses %s', (_label, bytes) => {
    expect(sniffLogo(bytes)).toEqual({ kind: 'refused', reason: 'it is not a PNG, JPEG or WebP image' });
  });

  it('refuses a header that declares no size', () => {
    expect(sniffLogo(pngHeader(0, 10))).toEqual({ kind: 'refused', reason: 'its header declares no size' });
  });

  it.each([
    ['PNG', pngHeader(LOGO_MAX_PIXELS + 1, 10)],
    ['JPEG', jpegHeader(10, LOGO_MAX_PIXELS + 1)],
    ['lossy WebP', webpLossyHeader(LOGO_MAX_PIXELS + 1, 10)],
    ['lossless WebP', webpLosslessHeader(10, LOGO_MAX_PIXELS + 1)],
    ['extended WebP', webpExtendedHeader(30000, 30000)],
  ])('refuses a %s over the pixel limit', (_label, bytes) => {
    expect(sniffLogo(bytes)).toMatchObject({ kind: 'refused', reason: expect.stringMatching(/over the 2048×2048 limit/) });
  });

  it('accepts a logo exactly at the pixel limit', () => {
    expect(sniffLogo(pngHeader(LOGO_MAX_PIXELS, LOGO_MAX_PIXELS))).toMatchObject({ kind: 'ok' });
  });
});
