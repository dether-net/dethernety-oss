// src/composables/useHostContext.ts
import { useRouter, useRoute } from 'vue-router'
import { useAnalysisStore } from '@/stores/analysisStore'
import { useIssueStore } from '@/stores/issueStore'
import { componentRegistry } from '@/services/ComponentRegistry'
import { getPageDisplayName } from '@/utils/dataFlowUtils'
import { DtUtils } from '@dethernety/dt-core'
import apolloClient from '@/plugins/apolloClient'

import { 
  resolveComponent, 
  ref, 
  reactive, 
  computed, 
  watch, 
  getCurrentInstance,
  provide,
  inject,
  nextTick,
  onMounted,
  onUnmounted
} from 'vue'

export function useHostContext() {
  const router = useRouter()
  const route = useRoute()
  
  const analysisStore = useAnalysisStore()
  const issueStore = useIssueStore()
  
  const safeResolveComponent = (name: string) => {
    try {
      return resolveComponent(name)
    } catch (error) {
      console.warn(`Failed to resolve component: ${name}`, error)
      return null
    }
  }
  
  return {
    router,
    route,
    stores: {
      analysisStore,
      issueStore
    },
    services: {
      componentRegistry
    },
    vue: {
      ref,
      reactive,
      computed,
      watch,
      getCurrentInstance,
      provide,
      inject,
      nextTick,
      onMounted,
      onUnmounted,
      resolveComponent: safeResolveComponent
    },
    utils: {
      resolveComponent: safeResolveComponent,
      getPageDisplayName,
      dtUtils: new DtUtils(apolloClient)
    }
  }
}