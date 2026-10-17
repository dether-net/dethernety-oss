import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Direct source import of the CLI. It lives under `oss/scripts/`, outside dt-ws's rootDir; ts-jest compiles it
// in-memory. The embedder is faked through the `openEmbedder` seam: CI has no model weights.
import { openEmbedDocuments, runEmbed, type DocumentEmbedder, type OpenEmbedderOptions } from '../../../../scripts/module-manager/embed';
import {
  classEmbeddingText,
  hashEmbeddingText,
  normalizeClassType,
} from '../../../../packages/dt-module/src/embedding-text';
import { CLASS_LABELS } from '../../../../packages/dt-module/src/vector-search';
import { CLASS_VECTOR_DIRS, readDefaultProfileId, readVectorProfile } from '../../../../scripts/lib/class-vectors';
import { DEFAULT_EMBEDDING_PROFILE_ID } from '../config/embedding-profile-selection';
import { EmbeddingService } from '../gql/services/embedding.service';

const OSS_ROOT = path.resolve(__dirname, '../../../..');
const PROFILE = readVectorProfile(OSS_ROOT, DEFAULT_EMBEDDING_PROFILE_ID);
const FILE = `${PROFILE.id}.json`;

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}

type ClassSpec = { typeDir: string; slug: string; name: string; type?: string; description?: string; category?: string };

function scaffoldModule(root: string, moduleName: string, classes: ClassSpec[]): string {
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
  return dataDir;
}

/** A unit vector of the profile's length, different per call. */
let seed = 0;
function nextVector(): number[] {
  const v = new Array(PROFILE.dimensions).fill(0);
  v[seed++ % PROFILE.dimensions] = 1;
  return v;
}

/** A fake embed-documents: records what it was asked, answers unit vectors. */
function fakeEmbedder(ready: Partial<DocumentEmbedder['ready']> = {}) {
  const opened: OpenEmbedderOptions[] = [];
  const requests: Array<Array<{ title: string; text: string }>> = [];
  let closed = 0;
  const open = async (options: OpenEmbedderOptions): Promise<DocumentEmbedder> => {
    opened.push(options);
    return {
      ready: {
        profile: PROFILE.id,
        dimensions: PROFILE.dimensions,
        repo: 'onnx-community/embeddinggemma-300m-ONNX',
        revision: PROFILE.revision,
        dtype: 'fp32',
        documentTitle: PROFILE.documentTitle,
        ...ready,
      },
      embed: async (items) => {
        requests.push(items);
        return items.map(() => nextVector());
      },
      close: async () => {
        closed++;
      },
    };
  };
  return { open, opened, requests, closed: () => closed };
}

const silent = { log: () => {}, warn: () => {}, error: () => {} };
const readVector = (dataDir: string, rel: string) => JSON.parse(fs.readFileSync(path.join(dataDir, rel, 'embeddings', FILE), 'utf8'));

describe('module-manager embed CLI', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkTmp('mm-embed-');
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const run = (fake: ReturnType<typeof fakeEmbedder>, extra: Partial<Parameters<typeof runEmbed>[0]> = {}) =>
    runEmbed({ modulePaths: [tmp], ossRoot: OSS_ROOT, modelsDir: '/models', batchSize: 16, openEmbedder: fake.open, logger: silent, ...extra });

  it('files the vectors under the platform default profile', () => {
    expect(readDefaultProfileId(OSS_ROOT)).toBe(DEFAULT_EMBEDDING_PROFILE_ID);
  });

  it('embeds every class as a document titled with its name, the text the platform composes, and stamps the file', async () => {
    const dataDir = scaffoldModule(tmp, 'mod-a', [
      { typeDir: 'component', slug: 'web', name: 'Web Server', type: 'process', description: 'Serves pages', category: 'Compute' },
      { typeDir: 'issue', slug: 'gap', name: 'Gap', description: 'A missing control' },
    ]);
    const fake = fakeEmbedder();

    expect(await run(fake)).toEqual({ written: 2, current: 0 });

    const webText = classEmbeddingText({ name: 'Web Server', type: 'process', description: 'Serves pages', category: 'Compute' }, 'component');
    const gapText = classEmbeddingText({ name: 'Gap', description: 'A missing control' }, 'issue');
    expect(fake.requests).toEqual([[{ title: 'Web Server', text: webText }, { title: 'Gap', text: gapText }]]);
    expect(fake.opened).toEqual([{ ossRoot: OSS_ROOT, profileId: PROFILE.id, modelsDir: '/models', download: false }]);
    expect(fake.closed()).toBe(1);
    const web = readVector(dataDir, 'component/web');
    expect(Object.keys(web)).toEqual(['profile', 'revision', 'contentHash', 'vector']);
    expect(web).toMatchObject({ profile: PROFILE.id, revision: PROFILE.revision, contentHash: hashEmbeddingText(webText) });
    expect(web.vector).toHaveLength(PROFILE.dimensions);
    expect(readVector(dataDir, 'issue/gap').contentHash).toBe(hashEmbeddingText(gapText));
  });

  it('covers exactly the searched class labels plus issue', () => {
    const labelOf = (dir: string) => `${dir[0].toUpperCase()}${dir.slice(1)}Class`;
    expect(CLASS_VECTOR_DIRS.filter((d) => d !== 'issue').map(labelOf).sort()).toEqual([...CLASS_LABELS].sort());
  });

  it('applies the platform type normalisation, and skips a component of a type the platform rejects', async () => {
    const dataDir = scaffoldModule(tmp, 'mod-b', [
      { typeDir: 'component', slug: 'ok', name: 'OK', type: 'store' },
      { typeDir: 'component', slug: 'bad', name: 'Bad', type: 'WIDGET' },
      { typeDir: 'dataFlow', slug: 'flow', name: 'Flow', type: 'anything' },
    ]);
    const fake = fakeEmbedder();
    await run(fake);
    expect(fake.requests.flat().map((i) => i.text)).toEqual([
      'OK. . Category: General. Type: STORE.',
      'Flow. . Category: General. Type: DATA_FLOW.',
    ]);
    expect(fs.existsSync(path.join(dataDir, 'component/bad/embeddings'))).toBe(false);
  });

  it('leaves a current class alone, embeds an edited one again, and starts no embedder when all are current', async () => {
    const dataDir = scaffoldModule(tmp, 'mod-c', [
      { typeDir: 'component', slug: 'a', name: 'A', type: 'PROCESS' },
      { typeDir: 'component', slug: 'b', name: 'B', type: 'PROCESS' },
    ]);
    await run(fakeEmbedder());
    const before = readVector(dataDir, 'component/a');

    const idle = fakeEmbedder();
    expect(await run(idle, { modelsDir: undefined })).toEqual({ written: 0, current: 2 });
    expect(idle.opened).toHaveLength(0);

    writeJson(path.join(dataDir, 'component/b/class.json'), { name: 'B', type: 'PROCESS', description: 'now described' });
    const again = fakeEmbedder();
    expect(await run(again)).toEqual({ written: 1, current: 1 });
    expect(again.requests.flat().map((i) => i.title)).toEqual(['B']);
    expect(readVector(dataDir, 'component/a')).toEqual(before);
  });

  it('embeds a class again whose file was made for another profile revision', async () => {
    const dataDir = scaffoldModule(tmp, 'mod-d', [{ typeDir: 'control', slug: 'c', name: 'C' }]);
    await run(fakeEmbedder());
    const file = path.join(dataDir, 'control/c/embeddings', FILE);
    writeJson(file, { ...JSON.parse(fs.readFileSync(file, 'utf8')), revision: 'older' });
    expect((await run(fakeEmbedder())).written).toBe(1);
  });

  it('sends batches of --batch-size classes', async () => {
    scaffoldModule(
      tmp,
      'mod-e',
      Array.from({ length: 5 }, (_v, i) => ({ typeDir: 'data', slug: `d${i}`, name: `D${i}` })),
    );
    const fake = fakeEmbedder();
    await run(fake, { batchSize: 2 });
    expect(fake.requests.map((r) => r.length)).toEqual([2, 2, 1]);
  });

  it('embeds several modules in one embedder session', async () => {
    const one = path.join(tmp, 'one');
    const two = path.join(tmp, 'two');
    scaffoldModule(one, 'one', [{ typeDir: 'data', slug: 'x', name: 'X' }]);
    scaffoldModule(two, 'two', [{ typeDir: 'data', slug: 'y', name: 'Y' }]);
    const fake = fakeEmbedder();
    expect((await run(fake, { modulePaths: [one, two] })).written).toBe(2);
    expect(fake.opened).toHaveLength(1);
  });

  it('refuses an embedder that runs another profile, weights revision, length or title rule', async () => {
    scaffoldModule(tmp, 'mod-f', [{ typeDir: 'data', slug: 'x', name: 'X' }]);
    for (const ready of [{ profile: 'other' }, { revision: 'main' }, { dimensions: 384 }, { documentTitle: 'none' }]) {
      const fake = fakeEmbedder(ready);
      await expect(run(fake)).rejects.toThrow(/not what profile/);
      expect(fake.closed()).toBe(1);
    }
    expect(fs.existsSync(path.join(tmp, 'data/mod-f/data/x/embeddings'))).toBe(false);
  });

  it('refuses a vector that is not of the profile length and unit norm, and writes none from that batch', async () => {
    const dataDir = scaffoldModule(tmp, 'mod-g', [{ typeDir: 'data', slug: 'x', name: 'X' }]);
    const fake = fakeEmbedder();
    const open = async (o: OpenEmbedderOptions) => ({ ...(await fake.open(o)), embed: async () => [[0.5, 0.5]] });
    await expect(run(fake, { openEmbedder: open })).rejects.toThrow(/unusable vector for "X"/);
    expect(fs.existsSync(path.join(dataDir, 'data/x/embeddings'))).toBe(false);
  });

  it('needs a models directory once a class must be embedded', async () => {
    scaffoldModule(tmp, 'mod-h', [{ typeDir: 'data', slug: 'x', name: 'X' }]);
    const saved = process.env.EMBEDDING_MODEL_DIR;
    delete process.env.EMBEDDING_MODEL_DIR;
    try {
      await expect(run(fakeEmbedder(), { modelsDir: undefined })).rejects.toThrow(/--models-dir/);
    } finally {
      if (saved !== undefined) process.env.EMBEDDING_MODEL_DIR = saved;
    }
  });

  it('throws when the module has no data directory named by its manifest', async () => {
    writeJson(path.join(tmp, 'manifest.json'), { name: 'missing', version: '1.0.0' });
    await expect(run(fakeEmbedder())).rejects.toThrow(/no manifest.json naming a data/);
  });

  describe('the embed-documents process', () => {
    // A helper a failed test left running holds its pipes open, and jest never exits; kill every one started.
    const started: number[] = [];
    afterEach(() => {
      for (const pid of started.splice(0)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // already exited
        }
      }
    });
    const open = async (options: OpenEmbedderOptions) => {
      const embedder = await openEmbedDocuments(options);
      started.push((embedder.ready as any).pid);
      return embedder;
    };

    /** An oss root whose embed-documents is a small script: `mode` says how it behaves. */
    function fakeHelper(mode: 'ok' | 'fail-start' | 'die-mid') {
      const root = path.join(tmp, 'fake-oss');
      const script = `
        const readline = require('node:readline');
        const args = process.argv.slice(2);
        if (${JSON.stringify(mode)} === 'fail-start') { process.stderr.write('the weights are missing'); process.exit(1); }
        process.stdout.write(JSON.stringify({ profile: args[args.indexOf('--profile') + 1], args, pid: process.pid }) + '\\n');
        readline.createInterface({ input: process.stdin }).on('line', (line) => {
          if (${JSON.stringify(mode)} === 'die-mid') { process.stderr.write('out of memory'); process.exit(3); }
          const { items } = JSON.parse(line);
          process.stdout.write(JSON.stringify({ vectors: items.map((i) => [i.text.length]) }) + '\\n');
        });
      `;
      fs.mkdirSync(path.join(root, 'packages/embedder/bin'), { recursive: true });
      fs.writeFileSync(path.join(root, 'packages/embedder/bin/embed-documents.mjs'), script.replace(/require\('node:readline'\)/, "(await import('node:readline'))"));
      return root;
    }

    it('passes the profile, weights directory and download flag, and answers each request in order', async () => {
      const embedder = await open({ ossRoot: fakeHelper('ok'), profileId: 'p-1', modelsDir: '/m', download: true });
      expect((embedder.ready as any).args).toEqual(['--profile', 'p-1', '--models-dir', '/m', '--download']);
      expect(await embedder.embed([{ title: 'a', text: 'xx' }, { title: 'b', text: 'yyy' }])).toEqual([[2], [3]]);
      expect(await embedder.embed([{ title: 'c', text: 'z' }])).toEqual([[1]]);
      await embedder.close();
    }, 10_000);

    it('reports what the helper said when it cannot start', async () => {
      await expect(openEmbedDocuments({ ossRoot: fakeHelper('fail-start'), profileId: 'p-1', modelsDir: '/m', download: false })).rejects.toThrow(
        /embed-documents stopped: the weights are missing/,
      );
    }, 10_000);

    it('reports what the helper said when it dies during a request', async () => {
      const embedder = await open({ ossRoot: fakeHelper('die-mid'), profileId: 'p-1', modelsDir: '/m', download: false });
      await expect(embedder.embed([{ title: 'a', text: 'x' }])).rejects.toThrow(/embed-documents stopped: out of memory/);
      await expect(embedder.close()).rejects.toThrow(/exited with 3/);
    }, 10_000);
  });
});

// A shipped vector is what the platform's install would compute for the same class: the platform's EmbeddingService,
// on its worker embedder, embedding the class's text as a document titled with its name. Needs the profile's weights.
const MODEL_DIR = process.env.EMBEDDER_TEST_MODEL_DIR;
(MODEL_DIR ? describe : describe.skip)('a shipped class vector and the install path (real weights)', () => {
  it('agree to a cosine of at least 1 - 1e-6', async () => {
    const settings: Record<string, string> = { EMBEDDING_ENABLED: 'true', EMBEDDING_MODEL_DIR: MODEL_DIR! };
    const service = new EmbeddingService({ get: (key: string) => settings[key] } as any);
    service.onModuleInit();
    try {
      await service.whenStartupChecked();
      expect(service.isEnabled()).toBe(true);
      const classDir = path.join(OSS_ROOT, 'modules/dethernety-general/data/dethernety-general/component/web-server');
      const def = JSON.parse(fs.readFileSync(path.join(classDir, 'class.json'), 'utf8'));
      const shipped = JSON.parse(fs.readFileSync(path.join(classDir, 'embeddings', FILE), 'utf8')).vector as number[];
      const text = service.composeClassText({ ...def, type: normalizeClassType('component', def.type) ?? undefined });
      const [computed] = (await service.embedBatch([text], 'document', [def.name]))!;
      const cosine = shipped.reduce((sum, v, i) => sum + v * computed[i], 0);
      expect(cosine).toBeGreaterThanOrEqual(1 - 1e-6);
    } finally {
      await service.onModuleDestroy();
    }
  }, 300_000);
});
