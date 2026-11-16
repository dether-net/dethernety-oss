import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { BrandingController } from '../branding.controller';
import type { BrandLogo, BrandingService } from '../branding.service';

/** The logo route: only the current hash answers, from memory, with an immutable public cache. */

const HASH = 'a'.repeat(64);
const logo: BrandLogo = { hash: HASH, type: 'image/png', width: 10, height: 10, bytes: Buffer.from('png-bytes') };

function controllerWith(current: BrandLogo | null) {
  const service = { logo: jest.fn((hash: string) => (current && current.hash === hash ? current : null)) };
  return { controller: new BrandingController(service as unknown as BrandingService), service };
}

function fakeResponse() {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as Buffer | undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    set(field: string | Record<string, string>, value?: string) {
      if (typeof field === 'string') res.headers[field] = value!;
      else Object.assign(res.headers, field);
      return res;
    },
    end(body?: Buffer) {
      res.body = body;
      return res;
    },
  };
  return res;
}

describe('GET /branding/logo/:hash', () => {
  it('serves the current logo with its type, a public immutable cache and an ETag', () => {
    const { controller } = controllerWith(logo);
    const res = fakeResponse();
    controller.getLogo(HASH, undefined, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.headers).toEqual({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${HASH}"`,
      'Content-Length': String(logo.bytes.length),
    });
    expect(res.body).toBe(logo.bytes);
  });

  it('answers 304 to a matching If-None-Match, weak or strong', () => {
    const { controller } = controllerWith(logo);
    for (const tag of [`"${HASH}"`, `W/"${HASH}"`, '*']) {
      const res = fakeResponse();
      controller.getLogo(HASH, tag, res as unknown as Response);
      expect(res.statusCode).toBe(304);
      expect(res.body).toBeUndefined();
    }
  });

  it('is a 404 for another hash', () => {
    const { controller } = controllerWith(logo);
    expect(() => controller.getLogo('b'.repeat(64), undefined, fakeResponse() as unknown as Response)).toThrow(
      NotFoundException,
    );
  });

  it.each([
    ['not hex', 'z'.repeat(64)],
    ['upper case', 'A'.repeat(64)],
    ['too short', 'a'.repeat(63)],
    ['a path', '../brand.json'],
  ])('is a 404 for a hash that is %s, without asking the service', (_label, hash) => {
    const { controller, service } = controllerWith(logo);
    expect(() => controller.getLogo(hash, undefined, fakeResponse() as unknown as Response)).toThrow(
      NotFoundException,
    );
    expect(service.logo).not.toHaveBeenCalled();
  });

  it('is a 404 when the installation has no logo', () => {
    const { controller } = controllerWith(null);
    expect(() => controller.getLogo(HASH, undefined, fakeResponse() as unknown as Response)).toThrow(
      NotFoundException,
    );
  });

  it('carries no guard: the route is public, like /config', () => {
    expect(Reflect.getMetadata('__guards__', BrandingController)).toBeUndefined();
    expect(Reflect.getMetadata('__guards__', BrandingController.prototype.getLogo)).toBeUndefined();
  });
});
