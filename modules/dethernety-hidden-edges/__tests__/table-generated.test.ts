import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDGE_KIND_TABLE } from '../src/edge-kinds.table';

describe('the compiled-in table', () => {
  it('equals edge-kinds.json (regenerate with `pnpm generate:table`)', () => {
    const json = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'src', 'edge-kinds.json'), 'utf8'));
    expect(EDGE_KIND_TABLE).toEqual(json);
  });
});
