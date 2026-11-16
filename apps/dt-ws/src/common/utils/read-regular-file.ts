import * as fs from 'fs/promises';
import { constants as fsConstants } from 'fs';
import * as path from 'path';

export type FileRead =
  | { kind: 'absent' }
  | { kind: 'refused'; reason: string }
  | { kind: 'read'; bytes: Buffer };

/**
 * Reads a regular file of at most `max` bytes without following a symlink. The type and the size
 * are checked on the open handle, and the read stops past `max`, so a file swapped or grown after
 * the check cannot get past either. O_NONBLOCK keeps a FIFO from blocking the open; `isFile()` then
 * refuses it. `label` names the file in refusal reasons (the file's base name by default). Any
 * error other than a missing file or a symlink is thrown.
 */
export async function readRegularFile(
  filePath: string,
  max: number,
  label: string = path.basename(filePath),
): Promise<FileRead> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(
      filePath,
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { kind: 'absent' };
    // A symlink: ELOOP on Linux and macOS, EMLINK on FreeBSD.
    if (code === 'ELOOP' || code === 'EMLINK')
      return { kind: 'refused', reason: `${label} is not a regular file` };
    throw error;
  }
  try {
    const tooBig: FileRead = {
      kind: 'refused',
      reason: `${label} is over ${max} bytes`,
    };
    const stats = await handle.stat();
    if (!stats.isFile())
      return { kind: 'refused', reason: `${label} is not a regular file` };
    if (stats.size > max) return tooBig;
    const chunks: Buffer[] = [];
    let length = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(
        Math.min(
          Math.max(stats.size + 1 - length, 64 * 1024),
          1024 * 1024,
          max + 1 - length,
        ),
      );
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, length);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      length += bytesRead;
      if (length > max) return tooBig;
    }
    return { kind: 'read', bytes: Buffer.concat(chunks, length) };
  } finally {
    await handle.close();
  }
}
