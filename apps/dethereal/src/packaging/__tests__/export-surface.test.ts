/**
 * The two modules allowed to start processes export exactly what they do
 * today: a new export (a generic spawn, say) fails here until it is reviewed.
 * This complements the bundle check, which allows child_process in these two
 * files only.
 */
import { describe, it, expect } from 'vitest'
import * as git from '../../utils/git.js'
import * as browser from '../../auth/browser.js'

describe('the modules that start processes', () => {
  it('export only their reviewed surface', () => {
    expect(Object.keys(git).sort()).toEqual([
      'GitRefusal', 'NEUTRAL_DIR', 'assertGitUsable', 'isAncestor', 'isInsideWorkTree',
      'openRepository', 'resolveBinary', 'resolveCommit', 'resolveGitBinary', 'runGit', 'safePathEntries',
    ])
    expect(Object.keys(browser).sort()).toEqual(['buildAuthorizationUrl', 'launchCommand', 'openBrowser', 'signInPort'])
  })
})
