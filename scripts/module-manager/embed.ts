/**
 * `module-manager embed` — generate pre-computed class embeddings.
 *
 * Walks a module's on-disk class definitions (V2 OPA or JSON layout),
 * composes embedding text via the shared `@dethernety/dt-module/embedding`
 * helper (byte-equal to the runtime), POSTs chunked batches to the
 * configured embedding endpoint, and writes each class's vector to
 * `{classDir}/embeddings/{modelSlug}.json`.
 *
 * See spec §9 for behavior and §9.3 for non-goals (no retries, no dim check,
 * no stale cleanup).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
// Direct source import — the scripts/ tree is run via tsx (which handles
// TypeScript) and jest (via ts-jest). Both resolve the file path directly;
// using the package subpath (`@dethernety/dt-module/embedding`) works at
// tsx runtime but ts-jest cannot resolve it from outside dt-ws's rootDir.
import {
  composeClassText,
  normalizeClassType,
  parseEmbeddingResponse,
  slugifyModelName,
} from '../../packages/dt-module/src/embedding-text';

export interface EmbedOptions {
  modulePath: string;
  model: string;
  url: string;
  apiKey?: string;
  batchSize: number;
  /** Injected for tests. Real calls use global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests. */
  logger?: Pick<Console, 'log' | 'warn' | 'error'>;
}

/** One class queued for embedding. */
interface ClassJob {
  classDir: string;
  className: string;
  text: string;
}

/** Two supported on-disk layouts. Mirrors EmbeddingFileCache / §6. */
interface Layout {
  name: 'opa' | 'json';
  classTypeDirs: string[];
  classDefinitionFile: 'class.json' | 'metadata.json';
}

const OPA_LAYOUT: Layout = {
  name: 'opa',
  classTypeDirs: ['component', 'dataFlow', 'securityBoundary', 'control', 'data'],
  classDefinitionFile: 'class.json',
};

const JSON_LAYOUT: Layout = {
  name: 'json',
  classTypeDirs: [
    'ComponentClasses',
    'DataFlowClasses',
    'SecurityBoundaryClasses',
    'ControlClasses',
    'DataClasses',
  ],
  classDefinitionFile: 'metadata.json',
};

export async function runEmbed(opts: EmbedOptions): Promise<void> {
  const log = opts.logger ?? console;
  const fetchFn = opts.fetchImpl ?? fetch;

  if (!opts.model) throw new Error('--model is required');
  if (!opts.url) throw new Error('--url is required');

  const moduleName = readModuleName(opts.modulePath);
  const moduleDataDir = path.join(opts.modulePath, 'data', moduleName);
  if (!fs.existsSync(moduleDataDir)) {
    throw new Error(
      `Module data directory not found: ${moduleDataDir}. ` +
        `Expected "<module-path>/data/<moduleName>/" per spec §6.`,
    );
  }

  const layout = detectLayout(moduleDataDir);
  log.log(
    `[embed] module=${moduleName} layout=${layout.name} dataDir=${moduleDataDir}`,
  );

  const jobs = collectJobs(moduleDataDir, layout, log);
  log.log(`[embed] ${jobs.length} classes queued for embedding`);

  if (jobs.length === 0) return;

  const modelSlug = slugifyModelName(opts.model);
  let written = 0;

  for (let i = 0; i < jobs.length; i += opts.batchSize) {
    const chunk = jobs.slice(i, i + opts.batchSize);
    log.log(
      `[embed] POST batch ${Math.floor(i / opts.batchSize) + 1}` +
        ` (${chunk.length} classes, ${i + chunk.length}/${jobs.length} total)`,
    );

    const vectors = await embedChunk(
      chunk.map((j) => j.text),
      opts,
      fetchFn,
    );
    if (vectors.length !== chunk.length) {
      throw new Error(
        `Embedding endpoint returned ${vectors.length} vectors for a ` +
          `batch of ${chunk.length} inputs`,
      );
    }

    for (let k = 0; k < chunk.length; k++) {
      writeVector(chunk[k].classDir, modelSlug, vectors[k]);
      written++;
    }
  }

  log.log(`[embed] done. wrote ${written} vectors (model slug: ${modelSlug})`);
}

function readModuleName(modulePath: string): string {
  const manifestPath = path.join(modulePath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.name || typeof manifest.name !== 'string') {
    throw new Error('manifest.json must contain a string "name" field');
  }
  return manifest.name;
}

function detectLayout(moduleDataDir: string): Layout {
  const hasOpa = OPA_LAYOUT.classTypeDirs.some((d) =>
    fs.existsSync(path.join(moduleDataDir, d)),
  );
  const hasJson = JSON_LAYOUT.classTypeDirs.some((d) =>
    fs.existsSync(path.join(moduleDataDir, d)),
  );
  if (hasOpa && hasJson) {
    throw new Error(
      `Ambiguous layout: both OPA and JSON class-type directories exist under ${moduleDataDir}`,
    );
  }
  if (hasOpa) return OPA_LAYOUT;
  if (hasJson) return JSON_LAYOUT;
  throw new Error(
    `No class-type directories found under ${moduleDataDir}. ` +
      `Expected one of: ${[...OPA_LAYOUT.classTypeDirs, ...JSON_LAYOUT.classTypeDirs].join(', ')}`,
  );
}

function collectJobs(
  moduleDataDir: string,
  layout: Layout,
  log: Pick<Console, 'log' | 'warn' | 'error'>,
): ClassJob[] {
  const jobs: ClassJob[] = [];

  for (const classTypeDir of layout.classTypeDirs) {
    const typeRoot = path.join(moduleDataDir, classTypeDir);
    if (!fs.existsSync(typeRoot)) continue;

    for (const entry of fs.readdirSync(typeRoot)) {
      const classDir = path.join(typeRoot, entry);
      let stat;
      try {
        stat = fs.statSync(classDir);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;

      const defPath = path.join(classDir, layout.classDefinitionFile);
      if (!fs.existsSync(defPath)) continue;

      let def: any;
      try {
        def = JSON.parse(fs.readFileSync(defPath, 'utf8'));
      } catch (err) {
        log.warn(
          `[embed] skipping ${classDir}: malformed ${layout.classDefinitionFile} (${
            err instanceof Error ? err.message : String(err)
          })`,
        );
        continue;
      }

      if (typeof def?.name !== 'string' || def.name.length === 0) {
        log.warn(`[embed] skipping ${classDir}: missing "name" field`);
        continue;
      }

      // OPA layout applies the same FORCED_TYPES / component-uppercase
      // normalization the runtime does before composing text. JSON layout
      // returns rawType unchanged (the retired JSON-Logic layout never normalized).
      const normalizedType =
        layout.name === 'opa'
          ? normalizeClassType(classTypeDir, def.type)
          : (def.type ?? '');
      if (normalizedType === null) {
        log.warn(
          `[embed] skipping "${def.name}" in ${classTypeDir}: invalid component type "${def.type}"`,
        );
        continue;
      }

      const text = composeClassText({
        name: def.name,
        description: def.description,
        category: def.category,
        type: normalizedType,
      });

      jobs.push({ classDir, className: def.name, text });
    }
  }

  return jobs;
}

async function embedChunk(
  texts: string[],
  opts: EmbedOptions,
  fetchFn: typeof fetch,
): Promise<number[][]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;

  const response = await fetchFn(opts.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: opts.model, input: texts }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `Embedding endpoint ${opts.url} returned ${response.status} ${response.statusText}${
        body ? `: ${body.slice(0, 500)}` : ''
      }`,
    );
  }
  const data = await response.json();
  return parseEmbeddingResponse(data, texts.length);
}

function writeVector(classDir: string, modelSlug: string, vector: number[]): void {
  const embeddingsDir = path.join(classDir, 'embeddings');
  fs.mkdirSync(embeddingsDir, { recursive: true });
  const file = path.join(embeddingsDir, `${modelSlug}.json`);
  fs.writeFileSync(file, JSON.stringify(vector));
}
