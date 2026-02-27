// src/types/global.d.ts - Simplified
import type { ComponentRegistry } from '@/services/ComponentRegistry'

export interface HostDependencies {
  useHostContext: () => any,
  services: {
    componentRegistry: ComponentRegistry,
  },
  __VUE__?: any,
  __APP_CONTEXT__?: any,
}

declare global {
  interface Window {
    __HOST_DEPENDENCIES__: HostDependencies
  }
}