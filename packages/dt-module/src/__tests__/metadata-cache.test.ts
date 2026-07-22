import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '@nestjs/common';
import { MetadataCache, CachedModule } from '../remote/metadata-cache';

function entry(
  moduleKey: string,
  pin: string,
  fetchedAt: string,
  classes: Array<{ id: string; name: string }> = [{ id: 'c1', name: 'Class One' }],
): CachedModule {
  return {
    moduleKey,
    pin,
    fetchedAt,
    document: {
      protocol: '1',
      module: { name: moduleKey, componentClasses: classes as never },
    },
    embeddings: [],
  };
}

describe('MetadataCache', () => {
  let dir: string;
  let logger: Logger;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dtremote-cache-'));
    logger = new Logger('test');
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function cache(): MetadataCache {
    return new MetadataCache({ dir, explicitDir: true, logger });
  }

  it('round-trips an entry through an atomic write', () => {
    const e = entry('acme-compute', 'sha256:aaa', '2026-07-21T00:00:00Z');
    cache().put(e);
    // A fresh instance (cold memo) must read it back from disk identically.
    expect(cache().get('acme-compute', 'sha256:aaa')).toEqual(e);
  });

  it('returns null for an absent entry', () => {
    expect(cache().get('acme-compute', 'sha256:missing')).toBeNull();
  });

  it('treats a corrupt (unparseable) file as absent', () => {
    const e = entry('acme-compute', 'sha256:bbb', '2026-07-21T00:00:00Z');
    cache().put(e);
    const file = path.join(dir, 'acme-compute', 'sha256_bbb.json');
    fs.writeFileSync(file, 'not json at all', 'utf8');
    expect(cache().get('acme-compute', 'sha256:bbb')).toBeNull();
  });

  it('treats a zero-class document as absent but keeps a single-kind module', () => {
    cache().put(entry('acme-compute', 'sha256:empty', '2026-07-21T00:00:00Z', []));
    expect(cache().get('acme-compute', 'sha256:empty')).toBeNull();

    const single = entry('acme-compute', 'sha256:single', '2026-07-21T00:00:00Z', [
      { id: 'only', name: 'Only Class' },
    ]);
    cache().put(single);
    expect(cache().get('acme-compute', 'sha256:single')).toEqual(single);
  });

  it('newestFor returns the max-fetchedAt entry across pins', () => {
    const c = cache();
    c.put(entry('acme-compute', 'sha256:old', '2026-07-01T00:00:00Z'));
    c.put(entry('acme-compute', 'sha256:new', '2026-07-20T00:00:00Z'));
    expect(cache().newestFor('acme-compute')?.pin).toBe('sha256:new');
    expect(cache().newestFor('other-module')).toBeNull();
  });

  it('warns when the cache directory is not writable', () => {
    const file = fs.mkdtempSync(path.join(os.tmpdir(), 'dtremote-file-'));
    const notADir = path.join(file, 'regular-file');
    fs.writeFileSync(notADir, 'x', 'utf8');
    new MetadataCache({ dir: path.join(notADir, 'nested'), explicitDir: true, logger });
    expect(logger.warn).toHaveBeenCalled();
    fs.rmSync(file, { recursive: true, force: true });
  });

  it('warns when MODULE_CONTENT_CACHE_DIR is unset and it falls back to a temp dir', () => {
    const saved = process.env.MODULE_CONTENT_CACHE_DIR;
    delete process.env.MODULE_CONTENT_CACHE_DIR;
    try {
      new MetadataCache({ logger });
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.MODULE_CONTENT_CACHE_DIR = saved;
    }
  });
});
