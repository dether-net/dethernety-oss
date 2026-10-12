/**
 * Built-in embedding profiles: schema validation and its constraints, lookup by id, prompt
 * application (single pass, shared adversarial fixtures) and the profile content hash.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { describe, it, expect } from 'vitest';

import {
  applyPrompt,
  getProfile,
  listProfiles,
  profileContentHash,
  validateProfile,
  type ProfileKind,
} from '../embedding-profile';
import { hashEmbeddingText } from '../embedding-text';

const PROFILE_DIR = join(__dirname, '..', 'embedding-profiles');
const FIXTURES = join(__dirname, '..', '..', 'test', 'fixtures', 'apply-prompt-cases.json');

const EG1 = 'embeddinggemma-300m-retrieval-v1';
const EG2 = 'embeddinggemma-2-text-retrieval-v1';
const LEGACY = 'embeddinggemma';

/** A deep copy of a built-in profile, to break one rule at a time. */
const copyOf = (id: string): any => JSON.parse(JSON.stringify(getProfile(id)));

const problemsOf = (candidate: unknown): string => {
  try {
    validateProfile(candidate);
  } catch (err) {
    return (err as Error).message;
  }
  return '';
};

describe('built-in profiles', () => {
  it('lists the three built-in profiles in id order', () => {
    expect(listProfiles().map((p) => p.id)).toEqual([EG2, EG1, LEGACY].sort());
  });

  it('every JSON file in the profile directory is a built-in profile, unchanged by loading', () => {
    const files = readdirSync(PROFILE_DIR).filter((f) => f.endsWith('.json')).sort();
    expect(files).toEqual(listProfiles().map((p) => `${p.id}.json`).sort());
    for (const f of files) {
      const raw = JSON.parse(readFileSync(join(PROFILE_DIR, f), 'utf-8'));
      expect(getProfile(raw.id)).toEqual(raw);
    }
  });

  it('pins the text-graph files only, with a sha256 per file', () => {
    for (const id of [EG1, EG2]) {
      const paths = getProfile(id).source!.files.map((f) => f.path);
      expect(paths).toEqual(['config.json', 'onnx/model.onnx', 'onnx/model.onnx_data', 'tokenizer.json', 'tokenizer_config.json']);
    }
  });

  it('the legacy profile has no prompts and no pinned source', () => {
    const legacy = getProfile(LEGACY);
    expect(legacy.runtime.engine).toBe('http');
    expect(legacy.prompts).toBeUndefined();
    expect(legacy.source).toBeUndefined();
    expect(legacy.thresholds).toEqual({ classes: 0.4, mitre: 0.4, components: null });
  });
});

describe('getProfile', () => {
  it('names the valid ids for an unknown id', () => {
    expect(() => getProfile('nomic-embed-text')).toThrow(
      `Unknown EMBEDDING_MODEL "nomic-embed-text". Valid profile ids: ${listProfiles().map((p) => p.id).join(', ')}`,
    );
  });
});

describe('validateProfile', () => {
  it('accepts every built-in profile', () => {
    for (const p of listProfiles()) expect(problemsOf(JSON.parse(JSON.stringify(p)))).toBe('');
  });

  it('rejects a non-object', () => {
    expect(problemsOf(null)).toMatch(/not an object/);
    expect(problemsOf([])).toMatch(/not an object/);
  });

  const rejects: Array<[string, (p: any) => void, RegExp]> = [
    ['an id with upper case', (p) => (p.id = 'EmbeddingGemma'), /id must match/],
    ['an id with a slash', (p) => (p.id = 'org/model'), /id must match/],
    ['an id starting with a dot', (p) => (p.id = '.hidden'), /id must match/],
    ['another schema version', (p) => (p.schemaVersion = 2), /schemaVersion must be 1/],
    ['a repo without an org', (p) => (p.source.repo = 'embeddinggemma'), /source\.repo must be org\/name/],
    ['a repo with a path', (p) => (p.source.repo = 'org/name/extra'), /source\.repo must be org\/name/],
    ['a short revision', (p) => (p.source.revision = 'main'), /source\.revision must be 40/],
    ['an upper-case revision', (p) => (p.source.revision = p.source.revision.toUpperCase()), /source\.revision must be 40/],
    ['a plain-http hub', (p) => (p.source.hub = 'http://huggingface.co'), /source\.hub must be an https URL/],
    ['a path with ..', (p) => (p.source.files[0].path = '../etc/passwd'), /must be relative/],
    ['a path with a .. segment inside', (p) => (p.source.files[0].path = 'onnx/../../x'), /must be relative/],
    ['an absolute path', (p) => (p.source.files[0].path = '/etc/passwd'), /must be relative/],
    ['a path with a backslash', (p) => (p.source.files[0].path = 'onnx\\model.onnx'), /must be relative/],
    ['a path with an empty segment', (p) => (p.source.files[0].path = 'onnx//model.onnx'), /must be relative/],
    ['a short sha256', (p) => (p.source.files[0].sha256 = 'abc'), /sha256 must be 64/],
    ['a zero size', (p) => (p.source.files[0].bytes = 0), /bytes must be a positive integer/],
    ['no files', (p) => (p.source.files = []), /source\.files must be a non-empty list/],
    ['a threshold above 1', (p) => (p.thresholds.classes = 1.5), /thresholds\.classes must be a cosine value/],
    ['a missing threshold', (p) => delete p.thresholds.components, /thresholds\.components is required/],
    ['too many dimensions', (p) => (p.runtime.dimensions = 100000), /runtime\.dimensions must be an integer/],
    ['an unknown engine', (p) => (p.runtime.engine = 'tensorflow'), /runtime\.engine must be/],
    ['a query prompt without {text}', (p) => (p.prompts.query = 'query: '), /prompts\.query must contain \{text\}/],
    ['an unknown title rule', (p) => (p.prompts.title = 'class'), /prompts\.title must be/],
    ['an onnx profile without source', (p) => delete p.source, /source is required for an onnx profile/],
    ['an onnx profile without licence', (p) => delete p.licence, /licence\.name is required/],
    ['an onnx profile without prompts', (p) => delete p.prompts, /prompts is required for an onnx profile/],
    ['an onnx profile without calibration', (p) => delete p.calibration, /calibration .* is required/],
    ['a calibration that names a run instead of its query set', (p) => {
      p.calibration.runId = p.calibration.set;
      delete p.calibration.set;
    }, /calibration \{ set, date, rule \} is required/],
  ];

  it('describes each built-in calibration by its query set, date and rule in plain words', () => {
    for (const p of listProfiles().filter((x) => x.runtime.engine === 'onnx')) {
      expect(Object.keys(p.calibration ?? {}).sort()).toEqual(['date', 'rule', 'set']);
      expect(p.calibration?.rule).toMatch(/^the highest cosine threshold /);
    }
  });

  it.each(rejects)('rejects %s', (_name, breakIt, message) => {
    const p = copyOf(EG1);
    breakIt(p);
    expect(problemsOf(p)).toMatch(message);
  });

  it('lists every problem in one error', () => {
    const p = copyOf(EG1);
    p.id = 'Bad/Id';
    p.source.revision = 'main';
    p.thresholds.mitre = 2;
    const message = problemsOf(p);
    expect(message).toMatch(/id must match/);
    expect(message).toMatch(/source\.revision/);
    expect(message).toMatch(/thresholds\.mitre/);
  });
});

describe('applyPrompt', () => {
  const fixtures: { cases: Array<{ name: string; profile: string; kind: ProfileKind; text: string; title?: string; expected: string }> } =
    JSON.parse(readFileSync(FIXTURES, 'utf-8'));

  it('has fixtures for every built-in profile', () => {
    expect(new Set(fixtures.cases.map((c) => c.profile))).toEqual(new Set([EG1, EG2, LEGACY]));
  });

  it.each(fixtures.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(applyPrompt(getProfile(c.profile), c.kind, c.text, c.title)).toBe(c.expected);
  });
});

describe('profileContentHash', () => {
  it('is sha256 over the profile id and the prompted text, joined by a newline', () => {
    // sha256("embeddinggemma-300m-retrieval-v1\ntask: search result | query: x")
    expect(profileContentHash(EG1, 'task: search result | query: x')).toBe(hashEmbeddingText(`${EG1}\ntask: search result | query: x`));
    expect(profileContentHash(EG1, 'abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs between profiles and from the plain text hash', () => {
    const text = 'title: none | text: Redis';
    expect(profileContentHash(EG1, text)).not.toBe(profileContentHash(EG2, text));
    expect(profileContentHash(EG1, text)).not.toBe(hashEmbeddingText(text));
  });
});
