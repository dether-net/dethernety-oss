/**
 * The `./embedding` entry re-exports the embedding-text helpers its existing importers use, next
 * to the profile API.
 */

import { describe, it, expect } from 'vitest';

import * as entry from '../embedding';

describe('@dethernety/dt-module/embedding', () => {
  it.each([
    'composeClassText',
    'composeElementText',
    'composeTechniqueText',
    'composeMitigationText',
    'classEmbeddingText',
    'hashEmbeddingText',
    'normalizeClassType',
    'slugifyModelName',
    'parseEmbeddingResponse',
    'embeddingVectorDefect',
  ])('still exports %s', (name) => {
    expect(typeof (entry as Record<string, unknown>)[name]).toBe('function');
  });

  it.each(['validateProfile', 'listProfiles', 'getProfile', 'applyPrompt', 'profileContentHash'])('exports %s', (name) => {
    expect(typeof (entry as Record<string, unknown>)[name]).toBe('function');
  });
});
