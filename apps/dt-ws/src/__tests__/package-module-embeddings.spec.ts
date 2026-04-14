import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Verifies that `oss/scripts/package-module.js` recursively copies V2
 * `data/.../embeddings/` directories into the published tarball. The
 * packager itself is unchanged in Sprint 2 (§10) — this test locks in
 * the behavior so future refactors cannot silently drop the embeddings.
 */

const PACKAGER = path.resolve(__dirname, '../../../../scripts/package-module.js');

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function scaffoldFixtureModule(root: string, name: string): void {
  writeJson(path.join(root, 'manifest.json'), { name, version: '1.0.0' });

  // Compiled JS output location the packager reads from: dist/dethernety/<name>/
  const jsDir = path.join(root, 'dist', 'dethernety', name);
  fs.mkdirSync(jsDir, { recursive: true });
  fs.writeFileSync(path.join(jsDir, `${name}.js`), '// stub compiled module\n');

  // V2 data tree with one class that ships a pre-computed embedding
  const classDir = path.join(root, 'data', name, 'component', 'sample-class');
  writeJson(path.join(classDir, 'class.json'), {
    name: 'Sample Class',
    type: 'PROCESS',
  });
  writeJson(path.join(classDir, 'embeddings', 'nomic-embed-text.json'), [
    0.1, 0.2, 0.3,
  ]);
}

describe('package-module: ships V2 embeddings/ directories', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-embed-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('tarball contains embeddings/<slug>.json under each class directory', () => {
    const name = 'fixture-module';
    scaffoldFixtureModule(tmp, name);

    execFileSync('node', [PACKAGER, tmp], { stdio: 'pipe' });

    const archive = path.join(tmp, 'dist', `${name}-1.0.0.tar.gz`);
    expect(fs.existsSync(archive)).toBe(true);

    const contents = execFileSync('tar', ['-tzf', archive], {
      encoding: 'utf8',
    });
    const expectedEntry = `dethernety/${name}/data/${name}/component/sample-class/embeddings/nomic-embed-text.json`;
    expect(contents).toContain(expectedEntry);
  });
});
