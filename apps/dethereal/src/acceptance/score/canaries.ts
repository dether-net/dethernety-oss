/**
 * The fixture's secret-file canaries, for a leak search over a run directory: each value, the forms it may take
 * (raw, URL-encoded, base64 at each alignment), the secret file that holds it, and that file's class. A copy of
 * the owning file that is byte-identical to the fixture's is the fixture itself, not a leak.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { ExpectedKey } from '../key.js'
import { canaryForms } from './h3.js'

export interface FixtureCanary {
  value: string
  forms: string[]
  /** The secret file that holds it, relative to the fixture's `source/` */
  file: string
  class: string
}

/** The canaries of a fixture directory (one holding `key/expected.json`). */
export function fixtureCanaries(fixtureDir: string): FixtureCanary[] {
  const key = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'key', 'expected.json'), 'utf8')) as ExpectedKey
  return key.secret_files.flatMap((f) => (f.canary ? [{ value: f.canary, forms: canaryForms(f.canary), file: f.file, class: f.class }] : []))
}
