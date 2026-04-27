import data from './source-globs.v1.json' with { type: 'json' }

export const DISCOVERY_GLOBS: readonly string[] = Object.freeze([...data.globs])
