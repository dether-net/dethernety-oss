import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ModuleRegistryService } from '../gql/module-management-services/module-registry.service';
import { bundleResponse } from '../gql/module-management-services/module-frontend';

/**
 * Module frontend bundles at a content-addressed URL. The hash in the path is the bundle's
 * sha256, from the manifest query, so a bundle is immutable under its URL and the browser caches
 * it for good; a new bundle gets a new URL. The bytes come from the registry's in-memory copy,
 * never from disk per request.
 */
@Controller('module-bundles')
@UseGuards(JwtAuthGuard)
export class ModuleBundleController {
  constructor(private readonly moduleRegistryService: ModuleRegistryService) {}

  @Get(':moduleName/:hash/bundle.js')
  getModuleBundle(
    @Param('moduleName') moduleName: string,
    @Param('hash') hash: string,
    @Headers('accept-encoding') acceptEncoding: string | undefined,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() response: Response,
  ): void {
    const found = this.moduleRegistryService.findFrontendBundle(
      moduleName,
      hash,
    );
    if (found.status === 404)
      throw new NotFoundException('Module bundle not found');
    if (found.status === 503)
      throw new ServiceUnavailableException('Module unavailable');

    const { status, headers, vary, body } = bundleResponse(
      found.asset,
      acceptEncoding,
      ifNoneMatch,
    );
    response.status(status).set(headers).vary(vary);
    response.end(body);
  }
}
