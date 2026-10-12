/**
 * onnxruntime reads its telemetry opt-out once, when it loads. The embedder must set it before that
 * happens, whatever the environment says.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('onnxruntime telemetry opt-out', () => {
  const original = process.env.ORT_DISABLE_TELEMETRY;

  afterEach(() => {
    vi.doUnmock('onnxruntime-node');
    vi.resetModules();
    if (original === undefined) delete process.env.ORT_DISABLE_TELEMETRY;
    else process.env.ORT_DISABLE_TELEMETRY = original;
  });

  it.each([
    ['unset', undefined],
    ['set to 0', '0'],
  ])('is on when onnxruntime loads, with the variable %s', async (_label, value) => {
    if (value === undefined) delete process.env.ORT_DISABLE_TELEMETRY;
    else process.env.ORT_DISABLE_TELEMETRY = value;

    let seenAtLoad: string | undefined = 'onnxruntime never loaded';
    vi.resetModules();
    vi.doMock('onnxruntime-node', () => {
      seenAtLoad = process.env.ORT_DISABLE_TELEMETRY;
      return { InferenceSession: { create: vi.fn() }, Tensor: class {} };
    });

    await import('../index');

    expect(seenAtLoad).toBe('1');
  });
});
