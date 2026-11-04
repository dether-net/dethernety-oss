/**
 * What the app shows when the platform's runtime configuration cannot be read at startup.
 *
 * A production build has no other source for its configuration, so it does not start: it shows the
 * ConfigUnavailable screen, mounted as its own small app, and a retry starts the app again with a fresh page load,
 * from the page the person opened. The router's first navigation may already have moved the address (to /login), so
 * that page is the address captured before the router was installed.
 */
import { createApp, type App } from 'vue'
import ConfigUnavailable from '@/components/ConfigUnavailable.vue'
import { ConfigUnavailableError } from '@/config/environment'

export function isConfigUnavailable(error: unknown): boolean {
  return error instanceof ConfigUnavailableError
}

type Navigation = Pick<Location, 'href' | 'reload' | 'replace'>

// replace, not assign: Back should not return to the address the failed start moved to. Replacing an address that
// differs only in its #fragment just scrolls, so on the same page the address is put back and the page reloaded.
export function retryFrom(bootHref: string, location: Navigation = window.location): void {
  const page = (href: string) => href.split('#')[0]
  if (page(location.href) !== page(bootHref)) {
    location.replace(bootHref)
    return
  }
  if (location.href !== bootHref) location.replace(bootHref)
  location.reload()
}

export function mountConfigUnavailable(target: string | Element, bootHref: string): App {
  const screen = createApp(ConfigUnavailable, { retry: () => retryFrom(bootHref) })
  screen.mount(target)
  return screen
}
