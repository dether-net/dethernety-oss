import type { Harness } from '../types.js'
import { claudeTarget } from './claude/index.js'
import { codexTarget } from './codex/index.js'
import { openCodeTarget } from './opencode/index.js'
import type { Target } from './types.js'

const TARGETS: Partial<Record<Harness, Target>> = {
  claude: claudeTarget,
  codex: codexTarget,
  opencode: openCodeTarget,
}

/** The target for a harness, or undefined when none exists for it. */
export function targetFor(harness: Harness): Target | undefined {
  return TARGETS[harness]
}
