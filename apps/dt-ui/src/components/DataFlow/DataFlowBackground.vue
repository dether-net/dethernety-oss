<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { Background } from '@vue-flow/background'
  import { useFlowStore } from '@/stores/flowStore'
  import { useAnalysisStore } from '@/stores/analysisStore'
  import { badgePhaseForElement, PHASE_COLOR } from '@/utils/analysisPhase'
  import { nodeTypes } from '@/utils/dataFlowUtils'
  import PaletteWindow from '@/components/DataFlow/PaletteWindow.vue'
  import SettingsWindow from '@/components/DataFlow/SettingsWindow.vue'
  import BoundaryZoningOverview from '@/components/DataFlow/BoundaryZoning/BoundaryZoningOverview.vue'
  import ModelAnalysisDialog from '@/components/Dialogs/Analysis/ModelAnalysisDialog.vue'

  interface Props {
    openSettings: boolean
    modelName: string | null
    modelId: string | null
    freshlyCreatedId?: string | null
  }

  const itemName = ref('Select an item')
  const flowStore = useFlowStore()
  const showZoningOverview = ref(false)
  const showAnalyses = ref(false)
  const props = defineProps<Props>()
  const emits = defineEmits(['update:openSettings', 'update:snackBar', 'update:analysisResults', 'openModel', 'editModel', 'delete:node', 'delete:edge', 'redirect:issue', 'clear-freshly-created'])
  const openSettings = ref(props.openSettings)
  const modelName = ref(props.modelName)
  const modelId = ref(props.modelId)
  const open = computed({
    get () {
      return openSettings.value ? 0 : null
    },
    set (val) {
      openSettings.value = val === 0
      emits('update:openSettings', openSettings.value)
    },
  })

  watch(
    () => props.openSettings,
    newVal => {
      openSettings.value = newVal
    }
  )

  const isNode = (item: Node | Edge | null): item is Node => {
    return item !== null && 'type' in item && 'position' in item
  }

  const isEdge = (item: Node | Edge | null): item is Edge => {
    return item !== null && 'source' in item && 'target' in item
  }

  const openModel = (modelId: string) => {
    emits('openModel', modelId)
  }

  const editModel = () => {
    emits('editModel', modelId.value, modelName.value)
  }

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore - Complex type inference issue with flowStore.selectedItem
  watch(() => flowStore.selectedItem, newVal => {
    // @ts-ignore - Type instantiation is excessively deep and possibly infinite
    if (isNode(newVal)) {
      // @ts-ignore - Type instantiation is excessively deep and possibly infinite
      const nodeTypeKey = newVal.type as string
      const nodeTypeInfo = nodeTypes[nodeTypeKey as keyof typeof nodeTypes]
      const displayName = nodeTypeInfo?.displayName || ''
      const label = String(newVal.data?.label || '')
      itemName.value = displayName + ': ' + label
    } else if (isEdge(newVal)) {
      itemName.value = typeof newVal.label === 'string' ? 'Data Flow: ' + newVal.label : ''
    } else {
      itemName.value = 'Select an item'
    }
  })

  watch(() => props.modelName, newVal => {
    modelName.value = newVal
  })

  // Ambient analysis state on the rail. The canvas is where a user waits a run
  // out, so a paused human-in-the-loop interrupt has to be visible without
  // opening anything — this dot previously lived on the model dialog's Analysis
  // tab, where you had to already be looking at it to see it.
  //
  // Slower than the dialog's 5s cadence, because nothing here is being
  // interacted with, and idle while the tab is hidden; becoming visible again
  // refetches at once rather than waiting out the remaining interval.
  const CANVAS_POLL_MS = 20_000
  const analysisStore = useAnalysisStore()
  const analysisPollTimer = ref<ReturnType<typeof setInterval> | null>(null)

  // analysisStore.analyses is a shared global ref that any other poller replaces
  // wholesale, so scope to this model rather than trusting the last fetch. The
  // join key belongs to the helper — see badgePhaseForElement for why it is
  // `element` and not `model`.
  const badgePhase = computed(() => badgePhaseForElement(analysisStore.analyses, modelId.value))

  // Says why the dot is lit without claiming a count — one poll's view of a
  // shared list is a weak basis for a number the user would read as exact.
  const analysesTooltip = computed(() => {
    switch (badgePhase.value) {
      case 'paused': return 'Analyses — needs your input'
      case 'working': return 'Analyses — run in progress'
      case 'failed': return 'Analyses — a run failed'
      default: return 'Analyses'
    }
  })

  const pollAnalyses = () => {
    if (!modelId.value || document.hidden) return
    analysisStore.fetchAnalyses({ elementId: modelId.value })
  }

  // The rail's model-scoped buttons follow the canvas when it switches models.
  // Only modelName was tracked before; the id stayed pinned to whatever model
  // mounted first, which the analysis badge reads as its scope.
  watch(() => props.modelId, newVal => {
    modelId.value = newVal
    showAnalyses.value = false
    pollAnalyses()
  })

  onMounted(() => {
    pollAnalyses()
    analysisPollTimer.value = setInterval(pollAnalyses, CANVAS_POLL_MS)
    document.addEventListener('visibilitychange', pollAnalyses)
  })

  onBeforeUnmount(() => {
    if (analysisPollTimer.value) {
      clearInterval(analysisPollTimer.value)
      analysisPollTimer.value = null
    }
    document.removeEventListener('visibilitychange', pollAnalyses)
  })

  // Palette starts expanded for a model that opened with no elements — there is
  // nothing on the canvas to inspect, so the only useful next action is to drag
  // something in. Keyed to the store's load-time fact rather than to `nodes`, so
  // dropping that first element does not collapse the palette under the cursor,
  // and a user who closes it stays closed. Re-evaluated on model switch, where
  // resetStore flips the fact back to false before the next load decides again.
  const palettePanel = ref<number | null>(null)
  watch(() => flowStore.openedEmpty, isEmpty => {
    palettePanel.value = isEmpty ? 0 : null
  }, { immediate: true })

  </script>

<template>
  <!-- eslint-disable vue/no-lone-template -->
  <!-- eslint-disable vue/attribute-hyphenation -->
  <div class="dropzone-background">
    <Background
      :gap="20"
      pattern-color="#7D7D7D"
      :size="2"
      variant="dots"
    />
    <v-container class="sidebar-container">
      <v-expansion-panels
        v-model="palettePanel"
        variant="popout"
      >
        <v-expansion-panel
          class="opacity-90 border-thin rounded-lg elevation-11"
        >
          <!-- Header with dynamic class binding -->
          <v-expansion-panel-title
            class="expansion-title"
            color="primary"
          >
            <template #actions>
              <!-- <v-icon color="primary" icon="mdi-hammer-wrench" variant="outlined" /> -->
              <v-sheet class="d-flex justify-center align-center px-1 px-0" color="primary" variant="outlined">
                <v-icon color="tertiary" icon="mdi-vector-polyline-plus" size="large" variant="outlined" />
              </v-sheet>
              <!-- 🛠️ -->
              <!-- Components -->
            </template>
          </v-expansion-panel-title>
          <!-- Content with transition -->
          <v-expand-transition>
            <v-expansion-panel-text>
              <PaletteWindow />
            </v-expansion-panel-text>
          </v-expand-transition>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-container>

    <v-container class="settings-container">
      <v-expansion-panels v-model="open">
        <v-expansion-panel
          class="opacity-90 border-thin rounded-lg elevation-11"
        >
          <!-- Header with dynamic class binding -->
          <v-expansion-panel-title
            class="py-0 my-0 expansion-title"
            color="primary"
            size="50px"
          >
            <v-icon
              class="mr-3"
              color="tertiary"
              icon="mdi-playlist-edit"
              size="small"
              variant="outlined"
            />
            {{ itemName }}
            <template #actions="{ expanded }">
              <v-icon :icon="expanded ? 'mdi-unfold-less-horizontal' : 'mdi-unfold-more-horizontal'" size="small" />
            </template>

          </v-expansion-panel-title>
          <!-- Content with transition -->
          <v-expand-transition>
            <v-expansion-panel-text class="settings-panel-content">
              <SettingsWindow
                :freshly-created-id="props.freshlyCreatedId ?? null"
                @clear-freshly-created="emits('clear-freshly-created')"
                @delete:edge="emits('delete:edge')"
                @delete:node="emits('delete:node')"
                @open-model="openModel"
                @redirect:issue="emits('redirect:issue')"
                @update:open-settings="emits('update:openSettings', $event)"
                @update:snackBar="emits('update:snackBar', $event)"
              />
            </v-expansion-panel-text>
          </v-expand-transition>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-container>

    <div
      v-if="modelName"
      class="pa-1 px-6 model-name-container border-md rounded-lg border-opacity-25 elevation-5"
    >
      <v-icon
        color="tertiary"
        icon="mdi-vector-polyline"
        size="large"
        variant="outlined"
      />
      <span
        class="model-name text-h6 font-italic py-0 pl-2 pr-4"
        :title="modelName ?? ''"
      >
        {{ modelName }}
      </span>
    </div>

    <!-- Canvas rail. One flex column rather than four hand-positioned boxes:
         the toggles were each a fixed-position div with its own hardcoded `top`,
         so the stack could only grow by copy-paste, and the pitch was restated
         at every step. Order is unchanged from when these were separate. -->
    <div class="canvas-rail">
      <v-tooltip v-if="props.modelId" location="right" text="Model settings">
        <template #activator="{ props: tip }">
          <div
            v-bind="tip"
            aria-label="Open model settings"
            class="rail-btn pa-1 px-2 border-md rounded-lg border-opacity-25 elevation-5"
            role="button"
            tabindex="0"
            @click="editModel"
            @keydown.enter.prevent="editModel"
            @keydown.space.prevent="editModel"
          >
            <v-icon
              color="tertiary"
              icon="mdi-receipt-text-edit-outline"
              size="large"
              variant="outlined"
            />
          </div>
        </template>
      </v-tooltip>

      <v-tooltip
        location="right"
        :text="flowStore.editMode ? 'Edit mode (click to lock)' : 'View mode (click to edit)'"
      >
        <template #activator="{ props: tip }">
          <div
            v-bind="tip"
            :aria-label="flowStore.editMode ? 'Lock the canvas (currently editable)' : 'Unlock the canvas for editing'"
            class="rail-btn pa-1 px-2 border-md rounded-lg border-opacity-25 elevation-5"
            role="button"
            tabindex="0"
            @click="flowStore.editMode = !flowStore.editMode"
            @keydown.enter.prevent="flowStore.editMode = !flowStore.editMode"
            @keydown.space.prevent="flowStore.editMode = !flowStore.editMode"
          >
            <v-icon
              :color="flowStore.editMode ? 'warning' : 'tertiary'"
              :icon="flowStore.editMode ? 'mdi-lock-open-variant-outline' : 'mdi-lock-outline'"
              size="large"
              variant="outlined"
            />
          </div>
        </template>
      </v-tooltip>

      <v-tooltip location="right" text="Zoning overview">
        <template #activator="{ props: tip }">
          <div
            v-bind="tip"
            aria-label="Open zoning overview"
            class="rail-btn pa-1 px-2 border-md rounded-lg border-opacity-25 elevation-5"
            role="button"
            tabindex="0"
            @click="showZoningOverview = true"
            @keydown.enter.prevent="showZoningOverview = true"
            @keydown.space.prevent="showZoningOverview = true"
          >
            <v-icon
              color="tertiary"
              icon="mdi-shield-lock-outline"
              size="large"
              variant="outlined"
            />
          </div>
        </template>
      </v-tooltip>

      <v-tooltip v-if="props.modelId" location="right" :text="analysesTooltip">
        <template #activator="{ props: tip }">
          <div
            v-bind="tip"
            :aria-label="analysesTooltip"
            class="rail-btn pa-1 px-2 border-md rounded-lg border-opacity-25 elevation-5"
            role="button"
            tabindex="0"
            @click="showAnalyses = true"
            @keydown.enter.prevent="showAnalyses = true"
            @keydown.space.prevent="showAnalyses = true"
          >
            <v-badge
              :color="badgePhase ? PHASE_COLOR[badgePhase] : undefined"
              dot
              :model-value="badgePhase !== null"
            >
              <v-icon
                color="tertiary"
                icon="mdi-creation"
                size="large"
                variant="outlined"
              />
            </v-badge>
          </div>
        </template>
      </v-tooltip>
    </div>

    <BoundaryZoningOverview v-model="showZoningOverview" />

    <ModelAnalysisDialog
      v-if="showAnalyses && props.modelId"
      :model-id="props.modelId"
      :model-name="modelName ?? ''"
      :show="showAnalyses"
      @analysis:closed="showAnalyses = false"
    />

    <div class="vignette-overlay" />

    <div class="overlay">
      <slot />
    </div>
  </div>

</template>

<style scoped>
.expansion-title {
  min-height: 45px!important;
}

.sidebar-container {
  position: fixed;
  top: 43px;
  right: 10px;
  z-index: 1000;
  width: 110pt;
}
.settings-container {
  position: fixed;
  bottom: 30px;
  left: 60px;
  z-index: 1000;
  width: 900pt;
}

.settings-panel-content {
  height: 330px; /* Set max height */
  width: 100%; /* Set width */
  overflow-y: auto; /* Set overflow to none */
}

.model-name-container {
  position: fixed;
  top: 65px;
  left: 80px;
  z-index: 1000;
  font-family: 'JetBrains Mono', monospace !important;
  /* The box is fixed-position with no intrinsic width, so without a cap a long
     name grows to the viewport edge and then wraps down onto the toggle stack
     below it. Bound the width and ellipsise instead; the full name stays
     reachable via the title tooltip. */
  display: flex;
  align-items: center;
  max-width: 480px;
}

.canvas-rail {
  position: fixed;
  top: 120px;
  left: 80px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  /* The button box measures 40px (4px padding + 2px border + a 28px large
     icon, doubled), so 15px reproduces the 55px pitch the three toggles were
     hand-positioned at and the first three keep their exact former positions. */
  gap: 15px;
}

.rail-btn {
  cursor: pointer;
  background-color: rgb(var(--v-theme-surface));
  opacity: 0.9;
  /* The buttons are content-sized; a column stretches its items by default, so
     without this the widest one (the badged icon) would set the whole rail. */
  align-self: flex-start;
  /* Flex, not the default block: v-badge is inline-block and baseline-aligned,
     so wrapping an icon in one leaves the parent strut's descender hanging
     below it and the button measures 43px against the plain buttons' 40px.
     Removing the line box holds all four to the same height, and stops that
     depending on how each browser synthesises the badge's baseline. */
  display: flex;
  align-items: center;
}

.model-name {
  font-family: 'JetBrains Mono', monospace !important;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.vignette-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: radial-gradient(
    ellipse at center,
    transparent 0%,
    transparent 30%,
    rgba(0, 0, 0, 0.15) 60%,
    rgba(0, 0, 0, 0.4) 85%,
    rgba(0, 0, 0, 0.6) 100%
  );
  pointer-events: none;
  z-index: 1;
}

</style>
