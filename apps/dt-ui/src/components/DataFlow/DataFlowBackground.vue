<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { Background } from '@vue-flow/background'
  import { useFlowStore } from '@/stores/flowStore'
  import { nodeTypes } from '@/utils/dataFlowUtils'
  import PaletteWindow from '@/components/DataFlow/PaletteWindow.vue'
  import SettingsWindow from '@/components/DataFlow/SettingsWindow.vue'

  interface Props {
    openSettings: boolean
    modelName: string | null
    modelId: string | null
  }

  const itemName = ref('Select an item')
  const flowStore = useFlowStore()
  const props = defineProps<Props>()
  const emits = defineEmits(['update:openSettings', 'update:snackBar', 'update:analysisResults', 'openModel', 'editModel', 'delete:node', 'delete:edge', 'redirect:issue'])
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
                @delete:edge="emits('delete:edge')"
                @delete:node="emits('delete:node')"
                @open-model="openModel"
                @redirect:issue="emits('redirect:issue')"
                @update:open-settings="emits('update:openSettings', $event)"
              />
            </v-expansion-panel-text>
          </v-expand-transition>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-container>

    <div
      v-if="modelName"
      class="pa-1 px-6 model-name-container border-md rounded-lg border-opacity-25 elevation-5"
      @click="editModel"
    >
      <v-icon
        color="tertiary"
        icon="mdi-vector-polyline"
        size="large"
        variant="outlined"
      />
      <span
        class="model-name text-h6 font-italic pa-2 pr-4"
      >
        {{ modelName }}
      </span>
    </div>

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
  cursor: pointer;
}

.model-name {
  font-family: 'JetBrains Mono', monospace !important;
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
