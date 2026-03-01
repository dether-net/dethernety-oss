<script setup lang="ts">
  import { ref, computed, h, defineComponent } from 'vue'
  import { useAnalysisStore } from '@/stores/analysisStore'
  import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
  // import { reportComponents } from '@/components/analysisComponents'
  import { componentRegistry } from '@/services/ComponentRegistry'


  interface SnackBar {
    show: boolean
    message: string
    color: string
  }

  const router = useRouter()
  const route = useRoute()
  const analysisId = ref<string | null>(route.query.id as string | null)
  const analysisStore = useAnalysisStore()
  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })

  const indexDocument = ref<object | null>(null)
  const indexPage = ref<string | null>(null)

  // Bridge wrapper: ensure dynamically loaded module components render with the host app context
  const dynamicComponent = computed(() => {
    const key = indexPage.value ?? ''
    const Comp = key ? componentRegistry.getComponent(key) : null
    if (!Comp) return undefined

    const appCtx = (window as any).__HOST_DEPENDENCIES__?.__APP_CONTEXT__

    return defineComponent({
      name: 'ModuleAppContextBridge',
      setup(_, { attrs, slots }) {
        return () => {
          const vnode = h(Comp as any, attrs, slots)
          if (appCtx) {
            // force the child vnode to use the host app context (Vuetify, provides, globals)
            ;(vnode as any).appContext = appCtx
          }
          return vnode
        }
      },
    })
  })

  if (!analysisId.value) {
    snackBar.value = {
      show: true,
      message: 'No analysis ID provided',
      color: 'error',
    }
  } else {
    analysisStore.fetchAnalyses({ analysisId: analysisId.value }).then(analysis => {
      if (analysis && analysis.length > 0) {
        analysisStore.setCurrentAnalysis(analysis[0])
        updateIndexDocument()
      } else {
        snackBar.value = {
          show: true,
          message: 'Analysis not found',
          color: 'error',
        }
      }
    })
  }
  const analysisName = computed(() => analysisStore.currentAnalysis?.name ?? '')
  const analysisElementName = computed(() => analysisStore.currentAnalysis?.element?.name ?? '')

  const updateIndexDocument = () => {
    if (!analysisId.value) return
    analysisStore.getDocument({ analysisId: analysisId.value, filter: { document: 'index' } }).then((doc: any) => {
      if (doc) {
        try {
          indexDocument.value = doc
          const key = Object.keys(indexDocument.value ?? {}).find(key => !key.startsWith('metadata.')) || null
          indexPage.value = key
        } catch (e) {
          console.error(e)
        }
      }
    })
  }

  onBeforeRouteLeave(() => {
    analysisStore.resetStore()
    indexDocument.value = null
    indexPage.value = null
  })

  const openModel = () => {
    router.push({ path: '/dataflow', query: { id: analysisStore.currentAnalysis?.element?.id } })
  }

  const redirectToIssue = () => {
    router.push({ path: '/issues' })
  }

</script>

<template>
  <div class="analysis-page">
    <v-card class="analysis-card">
      <v-toolbar
        class="analysis-toolbar"
        color="primary"
        dark
        :title="'Analysis Results: ' + analysisName + ' - ' + analysisElementName"
      >
        <v-spacer />
        <v-btn
          class="ma-2"
          color="tertiary"
          icon="mdi-vector-polyline"
          size="large"
          variant="plain"
          @click="openModel"
        />
      </v-toolbar>
      <div class="analysis-content">
        <component
          v-if="dynamicComponent"
          :is="dynamicComponent"
          :analysis-id="analysisId"
          :content="indexDocument"
          :scope-id="analysisStore.currentAnalysis?.element?.id"
          @redirect:issue="redirectToIssue"
          @update:content="updateIndexDocument"
        />
      </div>
    </v-card>
  </div>

  <v-snackbar v-model="snackBar.show" :color="snackBar.color" timeout="5000" top>
    {{ snackBar.message }}
  </v-snackbar>
</template>

<style scoped>
.analysis-page {
  height: calc(100vh - 50px); /* Account for app bar and some padding */
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden; /* Prevent page-level scrolling */
}

.analysis-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  opacity: 0.9;
  min-height: 0; /* Important for flex child to shrink */
  overflow: hidden; /* Prevent card from growing */
}

.analysis-toolbar {
  flex-shrink: 0; /* Toolbar keeps its size */
}

.analysis-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0; /* Important for flex child to shrink */
  overflow: hidden; /* Prevent content area from growing */
}
</style>
