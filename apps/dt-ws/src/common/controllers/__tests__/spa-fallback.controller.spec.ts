import type { NextFunction, Response } from 'express';
import { SpaFallbackController } from '../spa-fallback.controller';

/** The SPA fallback passes the server's own routes on, so a bad URL under them is a real 404, not the app page. */

function requestTo(requestPath: string) {
  const res = { req: { path: requestPath }, sendFile: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  new SpaFallbackController().serveSpaFallback(res as unknown as Response, next as unknown as NextFunction);
  return { res, next };
}

describe('SpaFallbackController', () => {
  it.each(['/graphql', '/config', '/module-bundles/x/y/bundle.js', '/branding/logo/not-a-hash', '/branding/anything'])(
    'passes %s on to the other handlers',
    (requestPath) => {
      const { res, next } = requestTo(requestPath);
      expect(next).toHaveBeenCalled();
      expect(res.sendFile).not.toHaveBeenCalled();
    },
  );
});
