<script setup lang="ts">
  import { ref, computed, h, defineComponent, watch } from 'vue'
  import { useAnalysisStore } from '@/stores/analysisStore'
  import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
  // import { reportComponents } from '@/components/analysisComponents'
  import { componentRegistry } from '@/services/ComponentRegistry'
  import { moduleLoader, ModuleFrontendError, type ModuleFrontendErrorKind } from '@/services/ModuleLoader'
  import { timingMeasure } from '@/utils/userTiming'
  import ModelAnalysisDialog from '@/components/Dialogs/Analysis/ModelAnalysisDialog.vue'


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
  const viewLoading = ref(false)
  const viewError = ref<string | null>(null)

  // The module component for the index key: undefined until its module frontend has registered it
  // (the registry is reactive), so neither the template nor the dt:view measure sees a placeholder.
  // A separate computed, so a registration elsewhere does not rebuild the bridge below.
  const viewComponent = computed(() => (indexPage.value ? componentRegistry.get(indexPage.value) : undefined))

  // Bridge wrapper: ensure dynamically loaded module components render with the host app context
  const dynamicComponent = computed(() => {
    const Comp = viewComponent.value
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

  const VIEW_ERRORS: Record<ModuleFrontendErrorKind, string> = {
    'unloadable': "This analysis view couldn't be loaded.",
    'unavailable': 'This analysis view is unavailable right now. Try again shortly.',
    'host-api': "This analysis view needs a different version of the app. Reload the page; if that doesn't help, ask an administrator to update the module.",
  }

  // Each load gets a number, so only the latest one sets the view's state.
  let viewGeneration = 0

  const resetView = () => {
    viewGeneration++
    viewLoading.value = false
    viewError.value = null
  }

  const loadView = async (key: string) => {
    const generation = ++viewGeneration
    viewError.value = null
    viewLoading.value = true
    try {
      await moduleLoader.ensure(key)
    } catch (error) {
      if (generation === viewGeneration) {
        viewError.value = VIEW_ERRORS[error instanceof ModuleFrontendError ? error.kind : 'unloadable']
        viewStart = 0 // a failed view is not measured
      }
    } finally {
      if (generation === viewGeneration) viewLoading.value = false
    }
  }

  const retryView = () => {
    if (indexPage.value) loadView(indexPage.value)
  }

  // User Timing: dt:view:<key> runs from the analysis fetch to its module component rendering that analysis.
  let viewStart = 0
  watch(() => [dynamicComponent.value, indexDocument.value], ([comp]) => {
    if (!comp || !viewStart) return
    timingMeasure(`dt:view:${indexPage.value}`, viewStart)
    viewStart = 0
  }, { flush: 'post' })

  // Re-read the id from the route and (re)fetch. Wired to a route.query.id watcher
  // below so navigating between two analysis results (same path, different ?id=)
  // refetches instead of showing the first analysis captured at setup.
  const loadAnalysis = () => {
    viewStart = performance.now()
    resetView()
    analysisId.value = route.query.id as string | null
    if (!analysisId.value) {
      snackBar.value = {
        show: true,
        message: 'No analysis ID provided',
        color: 'error',
      }
      return
    }
    analysisStore.fetchAnalyses({ analysisId: analysisId.value }).then(analysis => {
      if (analysis && analysis.length > 0) {
        analysisStore.setCurrentAnalysis(analysis[0])
        // The analysis class's module owns the view: start loading its frontend alongside the index
        // document, rather than after it.
        const owner = analysis[0].analysisClass?.module?.name
        if (owner) moduleLoader.prefetch(owner)
        updateIndexDocument()
      } else if (analysisStore.error) {
        // Distinguish a fetch failure from a genuinely-empty result: the finder
        // resolves to [] and sets analysisStore.error on failure (no throw).
        snackBar.value = {
          show: true,
          message: analysisStore.error,
          color: 'error',
        }
      } else {
        snackBar.value = {
          show: true,
          message: 'Analysis not found',
          color: 'error',
        }
      }
    })
  }

  loadAnalysis()
  watch(() => route.query.id, () => {
    // Guard against a navigate-away that nulls the id firing a spurious "No analysis ID" snackbar.
    if (route.path !== '/analysisresults') return
    loadAnalysis()
  })

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
          // Also called on the module's own content updates, once its component is registered.
          if (key && !componentRegistry.get(key)) loadView(key)
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
    resetView()
  })

  const openModel = () => {
    router.push({ path: '/dataflow', query: { id: analysisStore.currentAnalysis?.element?.id } })
  }

  const redirectToIssue = () => {
    router.push({ path: '/issues' })
  }

  const showAnalysisDialog = ref(false)

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
        <!-- Outlined rather than plain: these read as toolbar decoration at
             `variant="plain"`, so the thin border is what marks them actionable. -->
        <v-btn
          aria-label="Open model"
          class="ma-2"
          color="tertiary"
          icon="mdi-vector-polyline"
          size="large"
          title="Open model"
          variant="outlined"
          @click="openModel"
        />
        <v-btn
          aria-label="Open analyses"
          class="ma-2"
          color="tertiary"
          :disabled="!analysisStore.currentAnalysis?.element?.id"
          icon="mdi-creation"
          size="large"
          title="Analyses"
          variant="outlined"
          @click="showAnalysisDialog = true"
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
        <div v-else-if="viewError" class="d-flex align-center justify-center flex-grow-1 pa-6">
          <v-alert type="error" variant="tonal" :text="viewError">
            <!-- The surface's text colour: the default `primary` is a header colour and nearly vanishes
                 on the tonal alert, and no theme accent is readable on it in both themes. -->
            <template #append>
              <v-btn
                color="rgb(var(--v-theme-on-surface))"
                size="small"
                variant="outlined"
                @click="retryView"
              >Retry</v-btn>
            </template>
          </v-alert>
        </div>
        <div v-else-if="viewLoading" class="d-flex flex-column align-center justify-center flex-grow-1 pa-6">
          <v-progress-circular color="primary" indeterminate :size="48" :width="4" />
          <span class="mt-3 text-medium-emphasis">Loading analysis view…</span>
        </div>
      </div>
    </v-card>
  </div>

  <ModelAnalysisDialog
    v-if="showAnalysisDialog && analysisStore.currentAnalysis?.element?.id"
    :model-id="analysisStore.currentAnalysis?.element?.id ?? ''"
    :model-name="analysisElementName"
    :show="showAnalysisDialog"
    @analysis:closed="showAnalysisDialog = false"
  />

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
