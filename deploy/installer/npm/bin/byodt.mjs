#!/usr/bin/env node
// npx @dethernety/byodt[@VERSION] [options]: runs the installer of the release this package version is.
import { spawnSync } from 'node:child_process';
import { constants } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, exitCode, systemPath } from '../lib.mjs';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const what = command(process.platform, packageDir, process.argv.slice(2));
if ('error' in what) {
  process.stderr.write(`error: ${what.error}\n`);
  process.exit(1);
}
// The installer reads its answers from the terminal itself and takes any proxy from the environment, as under curl.
const result = spawnSync(what.cmd, what.args, { stdio: 'inherit', env: { ...process.env, PATH: systemPath(process.env.PATH) } });
if (result.error) process.stderr.write(`error: could not run sh: ${result.error.message}\n`);
process.exit(exitCode(result, constants.signals));
