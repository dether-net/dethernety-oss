import { Controller, Get, Res, Next } from '@nestjs/common';
import { Response, NextFunction } from 'express';
import { join } from 'path';
import { existsSync } from 'fs';

@Controller()
export class SpaFallbackController {
  @Get('*')
  serveSpaFallback(@Res() res: Response, @Next() next: NextFunction) {
    const requestPath = res.req.path;
    
    // Define paths that should NOT fall back to SPA - let them be handled by other controllers
    const apiPaths = [
      '/graphql',    // GraphQL endpoint
      '/static',     // Backend static assets
      '/config',     // Frontend configuration endpoint
      '/health',     // Health check endpoints
      '/ready',      // Readiness probe
    ];
    
    // If it's an API path, pass to next handler (let other controllers handle it)
    if (apiPaths.some(path => requestPath.startsWith(path))) {
      return next();
    }
    
    // Root path is now free for SPA serving
    
    // Check if it's a static file request (has extension, but not .html)
    const hasFileExtension = /\.[^\/]+$/.test(requestPath);
    if (hasFileExtension && !requestPath.endsWith('.html')) {
      // Let static file serving handle it first
      return next();
    }
    
    // Serve the SPA index.html for all other routes (client-side routing)
    const indexPath = join(__dirname, '..', '..', '..', 'public', 'index.html');
    
    if (existsSync(indexPath)) {
      return res.sendFile(indexPath);
    } else {
      // Frontend not built yet - return helpful message
      return res.status(503).json({
        error: 'Frontend Not Available',
        message: 'The frontend application has not been built yet. Please run the build process.',
        hint: 'In development, make sure dt-ui is running on port 3005'
      });
    }
  }
}
