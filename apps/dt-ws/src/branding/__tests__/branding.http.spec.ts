import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { SpaFallbackController } from '../../common/controllers/spa-fallback.controller';
import { BrandingController } from '../branding.controller';
import { BrandingService, type BrandLogo } from '../branding.service';

/**
 * The logo route over HTTP, behind the same SPA fallback the app registers after it: HEAD answers like GET without
 * a body, and a hash that is not the current one, malformed or not, is a 404, never the app's index page. No
 * database; the brand comes from a stand-in service.
 */

const HASH = 'c'.repeat(64);
const logo: BrandLogo = { hash: HASH, type: 'image/webp', width: 4, height: 4, bytes: Buffer.from('webp-bytes') };

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    controllers: [BrandingController, SpaFallbackController],
    providers: [{ provide: BrandingService, useValue: { logo: (hash: string) => (hash === HASH ? logo : null) } }],
  }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
});

afterAll(async () => {
  await app.close();
});

describe('GET /branding/logo/:hash over HTTP', () => {
  it('serves the logo with its type and cache headers, and needs no token', async () => {
    const res = await request(app.getHttpServer()).get(`/branding/logo/${HASH}`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers.etag).toBe(`"${HASH}"`);
    expect(res.body).toEqual(logo.bytes);
  });

  it('answers HEAD with the headers and no body', async () => {
    const res = await request(app.getHttpServer()).head(`/branding/logo/${HASH}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.text ?? '').toBe('');
  });

  it('answers 304 to a matching If-None-Match', async () => {
    const res = await request(app.getHttpServer()).get(`/branding/logo/${HASH}`).set('If-None-Match', `"${HASH}"`);
    expect(res.status).toBe(304);
  });

  it.each([
    ['another hash', 'd'.repeat(64)],
    ['a malformed hash', 'not-a-hash'],
  ])('is a 404 for %s, not the app page', async (_label, hash) => {
    const res = await request(app.getHttpServer()).get(`/branding/logo/${hash}`);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).not.toMatch(/text\/html/);
  });
});
