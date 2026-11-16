import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { readRegularFile } from '../read-regular-file';

/** The shared reader: a regular file under a size cap, never through a symlink, named by its label. */

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dt-read-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('readRegularFile', () => {
  it('reads a regular file', async () => {
    await fs.writeFile(path.join(dir, 'a.txt'), 'hello');
    await expect(readRegularFile(path.join(dir, 'a.txt'), 10)).resolves.toEqual({
      kind: 'read',
      bytes: Buffer.from('hello'),
    });
  });

  it('reports a missing file as absent', async () => {
    await expect(readRegularFile(path.join(dir, 'none'), 10)).resolves.toEqual({ kind: 'absent' });
  });

  it('names the file by its base name by default, and by the label when given', async () => {
    await fs.writeFile(path.join(dir, 'big.txt'), 'x'.repeat(11));
    await expect(readRegularFile(path.join(dir, 'big.txt'), 10)).resolves.toEqual({
      kind: 'refused',
      reason: 'big.txt is over 10 bytes',
    });
    await expect(readRegularFile(path.join(dir, 'big.txt'), 10, 'frontend/big.txt')).resolves.toEqual({
      kind: 'refused',
      reason: 'frontend/big.txt is over 10 bytes',
    });
  });

  it('refuses a symlink and a directory', async () => {
    await fs.writeFile(path.join(dir, 'real.txt'), 'x');
    await fs.symlink(path.join(dir, 'real.txt'), path.join(dir, 'link.txt'));
    await fs.mkdir(path.join(dir, 'folder'));
    await expect(readRegularFile(path.join(dir, 'link.txt'), 10)).resolves.toEqual({
      kind: 'refused',
      reason: 'link.txt is not a regular file',
    });
    await expect(readRegularFile(path.join(dir, 'folder'), 10)).resolves.toEqual({
      kind: 'refused',
      reason: 'folder is not a regular file',
    });
  });
});
