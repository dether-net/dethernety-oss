// The npm package's own rules: it runs the carried installer with the user's arguments, refuses Windows outside WSL,
// passes on the installer's exit status, and holds no dependencies or scripts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, exitCode, systemPath } from '../lib.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));

test('runs the carried get-byodt.sh with /bin/sh, and passes every argument on in order', () => {
  assert.deepEqual(command('linux', '/p', ['--yes', '--dir', 'x y']), { cmd: '/bin/sh', args: ['/p/get-byodt.sh', '--yes', '--dir', 'x y'] });
  assert.deepEqual(command('darwin', '/p', []), { cmd: '/bin/sh', args: ['/p/get-byodt.sh'] });
});

test("the installer's PATH leaves out every node_modules/.bin folder npm or npx put in it", () => {
  assert.equal(
    systemPath('/w/node_modules/.bin:/home/u/.npm/_npx/1/node_modules/.bin/:/usr/local/bin::/usr/bin:/opt/node_modules/.binx'),
    '/usr/local/bin:/usr/bin:/opt/node_modules/.binx',
  );
  assert.equal(systemPath(undefined), '');
});

test('refuses Windows outside WSL, pointing to WSL', () => {
  const r = command('win32', '/p', []);
  assert.ok('error' in r && /WSL/.test(r.error));
});

test("ends with the installer's status, or 128 plus the signal that ended it", () => {
  assert.equal(exitCode({ status: 0, signal: null }, { SIGINT: 2 }), 0);
  assert.equal(exitCode({ status: 3, signal: null }, { SIGINT: 2 }), 3);
  assert.equal(exitCode({ status: null, signal: 'SIGINT' }, { SIGINT: 2 }), 130);
  assert.equal(exitCode({ status: null, signal: null, error: new Error('ENOENT') }, {}), 127);
});

test('the package has no dependencies, no scripts, no os field, and lists only its own files', () => {
  for (const key of ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundleDependencies', 'scripts', 'os']) {
    assert.equal(pkg[key], undefined, `package.json must not set ${key}`);
  }
  assert.deepEqual(pkg.files, ['bin/byodt.mjs', 'lib.mjs', 'get-byodt.sh', 'README.md', 'LICENSE']);
  assert.equal(pkg.bin.byodt, 'bin/byodt.mjs');
  assert.match(pkg.repository.url, /github\.com\/dether-net\/dethernety-oss/);
});
