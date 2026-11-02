// The npm package is another way to fetch a release's installer: the same get-byodt.sh, with the same pins written
// in, delivered by the npm registry instead of GitHub. It runs that script and nothing else, so there is one installer
// to trust and to test.
import { join } from 'node:path';

/**
 * What to run for this platform: `/bin/sh get-byodt.sh ARGS…` beside this file, or an error to print.
 * @param {string} platform process.platform
 * @param {string} packageDir the package's own directory
 * @param {string[]} args the arguments the user gave
 * @returns {{cmd: string, args: string[]} | {error: string}}
 */
export function command(platform, packageDir, args) {
  if (platform === 'win32') {
    return { error: "Dethernety's self-hosted deployment runs on Linux or macOS. On Windows, run this inside WSL." };
  }
  return { cmd: '/bin/sh', args: [join(packageDir, 'get-byodt.sh'), ...args] };
}

/**
 * PATH without the node_modules/.bin folders npm and npx put in front of it: the installer's curl, cosign, tar and
 * container engine are the system's, never a package's.
 * @param {string | undefined} path the PATH the bin was started with
 * @returns {string}
 */
export function systemPath(path) {
  return (path ?? '')
    .split(':')
    .filter((dir) => dir !== '' && !/(^|\/)node_modules\/\.bin\/?$/.test(dir))
    .join(':');
}

/**
 * The exit status to end with, from the child's status or the signal that ended it.
 * @param {{status: number | null, signal: string | null, error?: Error}} result spawnSync's result
 * @param {Record<string, number>} signals os.constants.signals
 */
export function exitCode(result, signals) {
  if (result.error) return 127;
  if (typeof result.status === 'number') return result.status;
  if (result.signal && signals[result.signal]) return 128 + signals[result.signal];
  return 1;
}
