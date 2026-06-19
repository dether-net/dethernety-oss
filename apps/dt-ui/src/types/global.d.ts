// src/types/global.d.ts - Simplified
import type { ComponentRegistry } from '@/services/ComponentRegistry'

export interface HostDependencies {
  useHostContext: () => any,
  services: {
    componentRegistry: ComponentRegistry,
  },
  __VUE__?: any,
  // JSONForms engine shared with module bundles (the host already bundles it for its
  // own class-config dialogs). Carries `@jsonforms/core` + `@jsonforms/vue` so a module
  // can render a class's schema/uiSchema through JSONForms while supplying its OWN
  // renderer set (matching the module's design language) — the host's vue-vuetify
  // renderers are intentionally NOT exposed. Mirrors the `__VUE__` single-instance handle.
  __JSONFORMS__?: {
    core: typeof import('@jsonforms/core'),
    vue: typeof import('@jsonforms/vue'),
  },
  __APP_CONTEXT__?: any,
}

declare global {
  interface Window {
    __HOST_DEPENDENCIES__: HostDependencies
  }
}