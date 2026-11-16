import { Controller, Get, Headers, NotFoundException, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { noneMatch } from '../common/utils/http-cache';
import { BrandingService } from './branding.service';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * The installation's logo at a content-addressed URL, as `/config` names it. Public, like `/config`:
 * the brand is meant to be seen before sign-in. Only the current logo's hash answers, and the bytes
 * come from memory, never from a path the request names. GET answers HEAD too (Express).
 */
@Controller('branding')
export class BrandingController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get('logo/:hash')
  getLogo(
    @Param('hash') hash: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() response: Response,
  ): void {
    // Checked here rather than in the route pattern, so a malformed hash is a 404 and never falls
    // through to the app's index page.
    const logo = SHA256_HEX.test(hash) ? this.brandingService.logo(hash) : null;
    if (!logo) throw new NotFoundException('Logo not found');

    const etag = `"${logo.hash}"`;
    response.set({
      'Content-Type': logo.type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: etag,
    });
    if (noneMatch(ifNoneMatch, etag)) {
      response.status(304).end();
      return;
    }
    response.status(200).set('Content-Length', String(logo.bytes.length));
    response.end(logo.bytes);
  }
}
