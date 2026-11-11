// Every test file runs with HOME pointed at a fresh temporary directory, so no test can read or
// write the real ~/.dethernety/ (token store, waiver key, model registry) by accident. Tests that
// need a specific home still set HOME themselves.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.HOME = mkdtempSync(path.join(tmpdir(), 'dethereal-test-home-'))

// The suite runs with the settlement on, as most of it tests the settlement; the files that test it off say so
// themselves, and the shipped default (off) has its own suite.
process.env.DETHEREAL_SETTLEMENT = 'on'
