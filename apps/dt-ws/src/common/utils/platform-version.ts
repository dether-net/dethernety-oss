import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The platform version, from dt-ws's package.json (next to dist/ in the image, next to src/ in development).
 * npm_package_version is set only by npm and pnpm scripts, and the image starts `node dist/main.js`.
 */
export function readPlatformVersion(path = join(__dirname, '..', '..', '..', 'package.json')): string {
  try {
    const version = JSON.parse(readFileSync(path, 'utf8')).version;
    return typeof version === 'string' && version ? version : 'unknown';
  } catch {
    return 'unknown';
  }
}

export const PLATFORM_VERSION = readPlatformVersion();
