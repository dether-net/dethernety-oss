import { Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as reader from '../../common/utils/read-regular-file';
import { BRAND_JSON_MAX_BYTES, LOGO_MAX_BYTES } from '../brand-file';
import { BrandingService } from '../branding.service';
import { gifLogo, pngHeader, svgLogo } from './logo-fixtures';

/**
 * The brand file is read once at start-up. Whatever is wrong with it, the service logs one line and the
 * platform carries on unbranded: it never throws.
 */

let dir: string;
let warn: jest.SpyInstance;
let info: jest.SpyInstance;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dt-brand-'));
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  info = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

const write = (name: string, content: string | Buffer) => fs.writeFile(path.join(dir, name), content);
const brandJson = (value: unknown) => write('brand.json', JSON.stringify(value));

async function loaded(): Promise<BrandingService> {
  const service = new BrandingService();
  await expect(service.load(path.join(dir, 'brand.json'))).resolves.toBeUndefined();
  return service;
}

describe('BrandingService', () => {
  it('is unbranded when BRANDING_FILE is unset or blank, without a log line', async () => {
    const service = new BrandingService();
    await service.load(undefined);
    expect(service.publicConfig()).toBeNull();
    await service.load('   ');
    expect(service.publicConfig()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads BRANDING_FILE at start-up', async () => {
    await brandJson({ name: 'Example Studio' });
    const previous = process.env.BRANDING_FILE;
    process.env.BRANDING_FILE = path.join(dir, 'brand.json');
    try {
      const service = new BrandingService();
      await service.onModuleInit();
      expect(service.publicConfig()).toEqual({ name: 'Example Studio' });
    } finally {
      if (previous === undefined) delete process.env.BRANDING_FILE;
      else process.env.BRANDING_FILE = previous;
    }
  });

  it('serves the name, URL, footer and the logo by its hash and size', async () => {
    const logo = pngHeader(320, 80);
    await write('logo.png', logo);
    await brandJson({ name: 'Example Studio', url: 'https://example.com', footer: 'Confidential', logo: 'logo.png' });
    const service = await loaded();

    const config = service.publicConfig()!;
    expect(config).toEqual({
      name: 'Example Studio',
      url: 'https://example.com/',
      footer: 'Confidential',
      logoUrl: expect.stringMatching(/^\/branding\/logo\/[0-9a-f]{64}$/),
      logoWidth: 320,
      logoHeight: 80,
    });
    const hash = config.logoUrl!.split('/').pop()!;
    expect(service.logo(hash)).toMatchObject({ type: 'image/png', width: 320, height: 80, bytes: logo });
    expect(service.logo('0'.repeat(64))).toBeNull();
  });

  it('is unbranded when the file is missing, with an information line rather than a warning', async () => {
    const service = await loaded();
    expect(service.publicConfig()).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toMatch(/brand\.json does not exist; reports are unbranded/);
  });

  it.each([
    ['the file is not JSON', () => write('brand.json', '{'), /not valid JSON/],
    ['the name is missing', () => brandJson({ url: 'https://example.com' }), /"name" is required/],
    ['the URL is http', () => brandJson({ name: 'x', url: 'http://example.com' }), /https/],
    ['the name has a bidi control', () => brandJson({ name: 'x\u202ey' }), /text-direction/],
    ['the file is too large', () => write('brand.json', ' '.repeat(BRAND_JSON_MAX_BYTES + 1)), /over 8192 bytes/],
  ])('is unbranded, with one log line, when %s', async (_label, prepare, reason) => {
    await prepare();
    const service = await loaded();
    expect(service.publicConfig()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(reason);
  });

  it('refuses a symlinked brand file', async () => {
    await write('real.json', JSON.stringify({ name: 'x' }));
    await fs.symlink(path.join(dir, 'real.json'), path.join(dir, 'brand.json'));
    const service = await loaded();
    expect(service.publicConfig()).toBeNull();
    expect(warn.mock.calls[0][0]).toMatch(/brand\.json is not a regular file/);
  });

  it('is unbranded, not stopped, when the file cannot be opened (EACCES)', async () => {
    await brandJson({ name: 'x' });
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    jest.spyOn(reader, 'readRegularFile').mockRejectedValue(denied);
    const service = await loaded();
    expect(service.publicConfig()).toBeNull();
    expect(warn.mock.calls[0][0]).toMatch(/could not be read \(EACCES\)/);
  });

  it('keeps the brand without a logo when the logo cannot be opened (EACCES)', async () => {
    await brandJson({ name: 'x', logo: 'logo.png' });
    await write('logo.png', pngHeader(10, 10));
    const real = reader.readRegularFile;
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    jest
      .spyOn(reader, 'readRegularFile')
      .mockImplementation((file, max, label) =>
        file.endsWith('logo.png') ? Promise.reject(denied) : real(file, max, label),
      );
    const service = await loaded();
    expect(service.publicConfig()).toEqual({ name: 'x' });
    expect(warn.mock.calls[0][0]).toMatch(/logo .* could not be read \(EACCES\)/);
  });

  it.each([
    ['missing', async () => undefined, /does not exist/],
    ['an SVG, even named .png', () => write('logo.png', svgLogo), /not a PNG, JPEG or WebP/],
    ['a GIF', () => write('logo.png', gifLogo), /not a PNG, JPEG or WebP/],
    ['over the byte limit', () => write('logo.png', Buffer.concat([pngHeader(10, 10), Buffer.alloc(LOGO_MAX_BYTES)])), /over 262144 bytes/],
    ['over the pixel limit', () => write('logo.png', pngHeader(4096, 10)), /2048×2048/],
  ])('keeps the brand without a logo when the logo is %s', async (_label, prepare, reason) => {
    await brandJson({ name: 'x', logo: 'logo.png' });
    await prepare();
    const service = await loaded();
    expect(service.publicConfig()).toEqual({ name: 'x' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(reason);
  });

  it('keeps the brand without a logo when the logo value is not a plain file name, with one log line', async () => {
    await brandJson({ name: 'x', logo: '../logo.png' });
    const service = await loaded();
    expect(service.publicConfig()).toEqual({ name: 'x' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/"logo" must be a plain file name/);
  });

  it('accepts a logo whose name does not match its type', async () => {
    await brandJson({ name: 'x', logo: 'logo.jpg' });
    await write('logo.jpg', pngHeader(10, 10));
    const service = await loaded();
    const hash = service.publicConfig()!.logoUrl!.split('/').pop()!;
    expect(service.logo(hash)?.type).toBe('image/png');
  });

  it('logs the unknown keys it ignores, and still brands', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    await brandJson({ name: 'x', colors: {} });
    const service = await loaded();
    expect(service.publicConfig()).toEqual({ name: 'x' });
    expect(log.mock.calls.some(([message]) => /ignoring unknown keys "colors"/.test(String(message)))).toBe(true);
  });

  it('starts from nothing on every load', async () => {
    await brandJson({ name: 'x' });
    const service = await loaded();
    await fs.rm(path.join(dir, 'brand.json'));
    await service.load(path.join(dir, 'brand.json'));
    expect(service.publicConfig()).toBeNull();
  });
});
