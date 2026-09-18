/**
 * Shared setup for every unit test.
 *
 * ONE CLASS OF VUE WARNING IS DROPPED, AND ONLY ONE: "Failed to resolve component".
 *
 * The app build registers two families of components through Vite plugins — Vuetify's tags
 * (`v-card`, `v-btn`, …) and the app's own auto-imported components (`IssueDialog`,
 * `AttributesForm`, …). The test build deliberately loads neither: Vuetify's component CSS cannot be
 * parsed in this environment, and a unit test stubs or ignores its children rather than rendering
 * the whole tree. So every mount of a component that uses them warns once per unresolved tag — about
 * twenty thousand warnings per run, every one about the harness rather than the code.
 *
 * That volume was not merely noise. Each warning crosses the worker's console channel to the runner,
 * and in CI, where the runner prints them, a worker could be closed while one was still in flight:
 * vitest then failed the whole run with "EnvironmentTeardownError: Closing rpc while
 * onUserConsoleLog was pending", with every test green.
 *
 * Every other Vue warning is still printed, formatted as Vue formats it.
 */
import { config } from '@vue/test-utils'

const UNRESOLVED = 'Failed to resolve component:'

config.global.config.warnHandler = (msg, _instance, trace) => {
  if (msg.startsWith(UNRESOLVED)) return
  console.warn(`[Vue warn]: ${msg}${trace ? `\n${trace}` : ''}`)
}
