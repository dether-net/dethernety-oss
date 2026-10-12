import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests that load onnxruntime directly must not send its telemetry either.
    env: { ORT_DISABLE_TELEMETRY: '1' },
  },
});
