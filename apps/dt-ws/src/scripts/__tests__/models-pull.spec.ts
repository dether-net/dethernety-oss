import { run, type PullDeps } from '../models-pull';

const EG1 = 'embeddinggemma-300m-retrieval-v1';

function deps(ensureWeights: PullDeps['ensureWeights'] = jest.fn(async () => undefined)) {
  const out: string[] = [];
  const err: string[] = [];
  return { deps: { ensureWeights, out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err, ensureWeights };
}

describe('models-pull', () => {
  it('places the default profile\'s weights in EMBEDDING_MODEL_DIR, says what and under which licence, and passes the signal', async () => {
    const d = deps();
    const stop = new AbortController();
    const code = await run({ EMBEDDING_MODEL_DIR: '/models', HF_TOKEN: 't' }, stop.signal, d.deps);
    expect(code).toBe(0);
    expect(d.ensureWeights).toHaveBeenCalledWith(expect.objectContaining({ id: EG1 }), '/models', expect.objectContaining({ token: 't', signal: stop.signal }));
    expect(d.out[0]).toMatch(new RegExp(`^Embedding model ${EG1}: 1\\.\\d\\d GB into /models`));
    expect(d.out).toContain('The model is licensed under the Gemma Terms of Use: https://ai.google.dev/gemma/terms.');
    expect(d.out.at(-1)).toBe('Ready: the platform loads the model from there without downloading it.');
    expect(d.err).toEqual([]);
  });

  it('defaults the directory to the platform\'s, and sends no token when there is none', async () => {
    const d = deps();
    await run({}, new AbortController().signal, d.deps);
    expect(d.ensureWeights).toHaveBeenCalledWith(expect.anything(), 'models', expect.objectContaining({ token: undefined }));
  });

  it.each([
    ['embeddinggemma', 'is no longer supported'],
    ['embeddinggemma-2-text-retrieval-v1', 'is not available in this release'],
    ['nomic-embed-text', 'Unknown EMBEDDING_MODEL'],
  ])('refuses %s as the platform would, and downloads nothing', async (model, message) => {
    const d = deps();
    expect(await run({ EMBEDDING_MODEL: model }, new AbortController().signal, d.deps)).toBe(1);
    expect(d.err.join('\n')).toContain(message);
    expect(d.ensureWeights).not.toHaveBeenCalled();
  });

  it('reports a failed download and exits 1', async () => {
    const d = deps(jest.fn(async () => {
      throw new Error('config.json: download failed with HTTP 404');
    }));
    expect(await run({}, new AbortController().signal, d.deps)).toBe(1);
    expect(d.err).toEqual(['The weights could not be placed: config.json: download failed with HTTP 404']);
  });

  it('stops cleanly when its signal aborts, and exits 130', async () => {
    const stop = new AbortController();
    const d = deps(jest.fn((_p, _d, options) => new Promise<void>((_r, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason));
      setTimeout(() => stop.abort(new Error('stopped by SIGTERM')), 5);
    })));
    expect(await run({}, stop.signal, d.deps)).toBe(130);
    expect(d.err).toEqual(['Stopped; nothing partial was kept. Run it again to continue.']);
  });

  it('prints the download progress the acquisition reports, with the file and never a URL', async () => {
    const d = deps(jest.fn(async (_p, _d, options) => {
      options.log?.('downloading weight file', { profile: EG1, file: 'onnx/model.onnx_data', bytes: 1 });
    }));
    await run({}, new AbortController().signal, d.deps);
    expect(d.out).toContain('downloading weight file: onnx/model.onnx_data');
  });
});
