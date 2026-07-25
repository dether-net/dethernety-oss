import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Direct source import of the CLI entry point. The CLI lives under
// `oss/scripts/` which is outside dt-ws's rootDir; ts-jest compiles the
// file in-memory and resolves `@dethernety/dt-module/embedding` via the
// package's exports field (resolves to the pure embedding-text bundle,
// no ESM-only transitive deps).
import { runEmbed } from '../../../../scripts/module-manager/embed';
import {
  classEmbeddingText,
  hashEmbeddingText,
} from '../../../../packages/dt-module/src/embedding-text';

type Fetch = typeof fetch;

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

function scaffoldOpaModule(
  root: string,
  moduleName: string,
  classes: Array<{
    typeDir: string;
    slug: string;
    name: string;
    type?: string;
    description?: string;
    category?: string;
  }>,
): void {
  writeJson(path.join(root, 'manifest.json'), { name: moduleName, version: '1.0.0' });
  const dataDir = path.join(root, 'data', moduleName);
  writeJson(path.join(dataDir, 'module.json'), { name: moduleName, version: '1.0.0' });
  for (const c of classes) {
    writeJson(path.join(dataDir, c.typeDir, c.slug, 'class.json'), {
      name: c.name,
      type: c.type,
      description: c.description,
      category: c.category,
    });
  }
}

function scaffoldJsonModule(
  root: string,
  moduleName: string,
  classes: Array<{
    typeDir: string;
    slug: string;
    name: string;
    type?: string;
    description?: string;
    category?: string;
  }>,
): void {
  writeJson(path.join(root, 'manifest.json'), { name: moduleName, version: '1.0.0' });
  const dataDir = path.join(root, 'data', moduleName);
  writeJson(path.join(dataDir, 'metadata.json'), { name: moduleName, version: '1.0.0' });
  for (const c of classes) {
    writeJson(path.join(dataDir, c.typeDir, c.slug, 'metadata.json'), {
      name: c.name,
      type: c.type,
      description: c.description,
      category: c.category,
    });
  }
}

function silentLogger(): Pick<Console, 'log' | 'warn' | 'error'> {
  return {
    log: () => {},
    warn: () => {},
    error: () => {},
  };
}

/** A fetch stub that returns an Ollama `/api/embed` shaped response. */
function ollamaEmbedStub(
  capture: Array<{ url: string; body: any }>,
  vectorFor?: (input: string, idx: number) => number[],
): Fetch {
  return (async (input: any, init: any) => {
    const body = JSON.parse(init.body);
    capture.push({ url: String(input), body });
    const embeddings = body.input.map(
      (t: string, i: number) => vectorFor?.(t, i) ?? [i, i + 1, i + 2],
    );
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ embeddings }),
      text: async () => '',
    } as any;
  }) as unknown as Fetch;
}

describe('module-manager embed CLI', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkTmp('embed-cli-');
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('walks V2 OPA layout and writes one vector per class', async () => {
    scaffoldOpaModule(tmp, 'mod-opa', [
      { typeDir: 'component', slug: 'app-server', name: 'App Server', type: 'process', description: 'App runtime' },
      { typeDir: 'component', slug: 'db', name: 'DB', type: 'STORE' },
      { typeDir: 'dataFlow', slug: 'http', name: 'HTTP', description: 'HTTP flow' },
    ]);

    const calls: Array<{ url: string; body: any }> = [];
    await runEmbed({
      modulePath: tmp,
      model: 'nomic-embed-text',
      url: 'http://embed.local/api/embed',
      batchSize: 128,
      fetchImpl: ollamaEmbedStub(calls),
      logger: silentLogger(),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://embed.local/api/embed');
    expect(calls[0].body.model).toBe('nomic-embed-text');
    expect(calls[0].body.input).toHaveLength(3);

    // On-disk shape is now { vector, contentHash }; read the vector field.
    const readVec = (typeDir: string, slug: string): number[] =>
      JSON.parse(
        fs.readFileSync(
          path.join(tmp, 'data', 'mod-opa', typeDir, slug, 'embeddings', 'nomic-embed-text.json'),
          'utf8',
        ),
      ).vector;

    expect(readVec('component', 'app-server')).toHaveLength(3);
    expect(readVec('component', 'db')).toHaveLength(3);
    expect(readVec('dataFlow', 'http')).toHaveLength(3);
  });

  it('applies type normalization for OPA layout (component uppercase + forced types)', async () => {
    scaffoldOpaModule(tmp, 'mod-n', [
      { typeDir: 'component', slug: 'app', name: 'App', type: 'process' },
      { typeDir: 'dataFlow', slug: 'flow', name: 'Flow', type: 'irrelevant' },
    ]);

    const calls: Array<{ url: string; body: any }> = [];
    await runEmbed({
      modulePath: tmp,
      model: 'nomic-embed-text',
      url: 'http://x/embed',
      batchSize: 128,
      fetchImpl: ollamaEmbedStub(calls),
      logger: silentLogger(),
    });

    const texts: string[] = calls[0].body.input;
    // component: 'process' → 'PROCESS'
    expect(texts).toContain('App. . Category: General. Type: PROCESS.');
    // dataFlow: forced to 'DATA_FLOW' regardless of raw value
    expect(texts).toContain('Flow. . Category: General. Type: DATA_FLOW.');
  });

  it('skips OPA component classes with invalid type', async () => {
    scaffoldOpaModule(tmp, 'mod-bad', [
      { typeDir: 'component', slug: 'bad', name: 'Bad', type: 'BOGUS' },
      { typeDir: 'component', slug: 'good', name: 'Good', type: 'PROCESS' },
    ]);

    const calls: Array<{ url: string; body: any }> = [];
    await runEmbed({
      modulePath: tmp,
      model: 'nomic-embed-text',
      url: 'http://x/embed',
      batchSize: 128,
      fetchImpl: ollamaEmbedStub(calls),
      logger: silentLogger(),
    });

    expect(calls[0].body.input).toHaveLength(1);
    expect(calls[0].body.input[0]).toContain('Good');
    expect(
      fs.existsSync(
        path.join(tmp, 'data', 'mod-bad', 'component', 'bad', 'embeddings'),
      ),
    ).toBe(false);
  });

  it('walks JSON (PascalCase) layout with metadata.json', async () => {
    scaffoldJsonModule(tmp, 'mod-json', [
      { typeDir: 'ComponentClasses', slug: 'api', name: 'API', type: 'PROCESS' },
      { typeDir: 'DataClasses', slug: 'creds', name: 'Credentials' },
    ]);

    const calls: Array<{ url: string; body: any }> = [];
    await runEmbed({
      modulePath: tmp,
      model: 'nomic-embed-text',
      url: 'http://x/embed',
      batchSize: 128,
      fetchImpl: ollamaEmbedStub(calls),
      logger: silentLogger(),
    });

    expect(calls[0].body.input).toHaveLength(2);
    expect(
      fs.existsSync(
        path.join(tmp, 'data', 'mod-json', 'ComponentClasses', 'api', 'embeddings', 'nomic-embed-text.json'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(tmp, 'data', 'mod-json', 'DataClasses', 'creds', 'embeddings', 'nomic-embed-text.json'),
      ),
    ).toBe(true);
  });

  it('chunks requests at --batch-size', async () => {
    const classes = Array.from({ length: 5 }, (_, i) => ({
      typeDir: 'component',
      slug: `c${i}`,
      name: `C${i}`,
      type: 'PROCESS',
    }));
    scaffoldOpaModule(tmp, 'mod-big', classes);

    const calls: Array<{ url: string; body: any }> = [];
    await runEmbed({
      modulePath: tmp,
      model: 'nomic-embed-text',
      url: 'http://x/embed',
      batchSize: 2,
      fetchImpl: ollamaEmbedStub(calls),
      logger: silentLogger(),
    });

    expect(calls).toHaveLength(3); // 2+2+1
    expect(calls[0].body.input).toHaveLength(2);
    expect(calls[1].body.input).toHaveLength(2);
    expect(calls[2].body.input).toHaveLength(1);
  });

  it('slugifies model names with "/" into a safe filename', async () => {
    scaffoldOpaModule(tmp, 'mod-slug', [
      { typeDir: 'component', slug: 'api', name: 'API', type: 'PROCESS' },
    ]);

    await runEmbed({
      modulePath: tmp,
      model: 'sentence-transformers/all-MiniLM-L6-v2',
      url: 'http://x/embed',
      batchSize: 128,
      fetchImpl: ollamaEmbedStub([]),
      logger: silentLogger(),
    });

    const embedDir = path.join(tmp, 'data', 'mod-slug', 'component', 'api', 'embeddings');
    const files = fs.readdirSync(embedDir);
    expect(files).toEqual(['sentence-transformers-all-MiniLM-L6-v2.json']);
  });

  it('parses OpenAI-style response format', async () => {
    scaffoldOpaModule(tmp, 'mod-oa', [
      { typeDir: 'component', slug: 'a', name: 'A', type: 'PROCESS' },
    ]);

    const openAIStub: Fetch = (async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
      text: async () => '',
    })) as unknown as Fetch;

    await runEmbed({
      modulePath: tmp,
      model: 'text-embedding-3-small',
      url: 'http://x/v1/embeddings',
      batchSize: 128,
      fetchImpl: openAIStub,
      logger: silentLogger(),
    });

    const parsed = JSON.parse(
      fs.readFileSync(
        path.join(tmp, 'data', 'mod-oa', 'component', 'a', 'embeddings', 'text-embedding-3-small.json'),
        'utf8',
      ),
    );
    expect(parsed.vector).toEqual([0.1, 0.2, 0.3]);
    // The vector is bound to the class text it was computed from.
    expect(parsed.contentHash).toBe(
      hashEmbeddingText(classEmbeddingText({ name: 'A', type: 'PROCESS' }, 'component')),
    );
  });

  it('sends Authorization header when --api-key provided', async () => {
    scaffoldOpaModule(tmp, 'mod-auth', [
      { typeDir: 'component', slug: 'a', name: 'A', type: 'PROCESS' },
    ]);

    const captured: Array<Record<string, string>> = [];
    const stub: Fetch = (async (_: any, init: any) => {
      captured.push(init.headers);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ embeddings: [[1, 2, 3]] }),
        text: async () => '',
      } as any;
    }) as unknown as Fetch;

    await runEmbed({
      modulePath: tmp,
      model: 'm',
      url: 'http://x/embed',
      apiKey: 'sekrit',
      batchSize: 128,
      fetchImpl: stub,
      logger: silentLogger(),
    });

    expect(captured[0].Authorization).toBe('Bearer sekrit');
  });

  it('fails loudly on HTTP error (no retries per spec §9.3)', async () => {
    scaffoldOpaModule(tmp, 'mod-err', [
      { typeDir: 'component', slug: 'a', name: 'A', type: 'PROCESS' },
    ]);

    let calls = 0;
    const stub: Fetch = (async () => {
      calls++;
      return {
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text: async () => 'maintenance',
        json: async () => ({}),
      } as any;
    }) as unknown as Fetch;

    await expect(
      runEmbed({
        modulePath: tmp,
        model: 'm',
        url: 'http://x/embed',
        batchSize: 128,
        fetchImpl: stub,
        logger: silentLogger(),
      }),
    ).rejects.toThrow(/503/);
    expect(calls).toBe(1);
  });

  it('throws when module data directory is missing', async () => {
    writeJson(path.join(tmp, 'manifest.json'), { name: 'absent', version: '1.0.0' });
    // no data/ directory
    await expect(
      runEmbed({
        modulePath: tmp,
        model: 'm',
        url: 'http://x/embed',
        batchSize: 128,
        fetchImpl: ollamaEmbedStub([]),
        logger: silentLogger(),
      }),
    ).rejects.toThrow(/data directory not found/);
  });

  it('throws on ambiguous layout (both OPA and JSON dirs)', async () => {
    writeJson(path.join(tmp, 'manifest.json'), { name: 'ambig', version: '1.0.0' });
    const dataDir = path.join(tmp, 'data', 'ambig');
    fs.mkdirSync(path.join(dataDir, 'component'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'ComponentClasses'), { recursive: true });

    await expect(
      runEmbed({
        modulePath: tmp,
        model: 'm',
        url: 'http://x/embed',
        batchSize: 128,
        fetchImpl: ollamaEmbedStub([]),
        logger: silentLogger(),
      }),
    ).rejects.toThrow(/Ambiguous layout/);
  });
});
