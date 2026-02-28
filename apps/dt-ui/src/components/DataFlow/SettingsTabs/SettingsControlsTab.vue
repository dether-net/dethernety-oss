<script setup lang="ts">
  import { ref, watch } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { Control, Model } from '@dethernety/dt-core'
  import ControlDialog from '@/components/Dialogs/Control/ControlDialog.vue'
  import ContentSelectDialog from '@/components/Dialogs/Browser/ContentSelectDialog.vue'

  // Props
  interface Props {
    selectedItem: Node | Edge | null;
    selectedControlIds: string[];
    controls: Control[];
  }

  const props = defineProps<Props>()

  // Emits
  const emit = defineEmits<{
    'update:selectedControlIds': [value: string[]];
    'update:controls': [value: Control[]];
    'update:addControls': [value: Control[]];
  }>()

  // Control table headers
  const controlTableHeaders = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
    { title: 'Classes', key: 'controlClasses' },
    { title: '', key: 'actions' },
  ]

  const itemsPerPage = [
    { value: 5, title: '5' },
    { value: 10, title: '10' },
    { value: 25, title: '25' },
    { value: 50, title: '50' },
    { value: -1, title: '$vuetify.dataFooter.itemsPerPageAll' },
  ]

  // Control-related refs
  const selectedControlId = ref<string | null>(null)
  const showControlDialog = ref(false)
  const showContentSelectDialog = ref(false)

  // Initialize controls based on selectedControlIds
  const initializeControls = () => {
    emit('update:controls', props.controls)
  }

  // Watch for changes in selectedControlIds and update controls
  watch(() => props.selectedControlIds, () => {
    initializeControls()
  }, { immediate: true })

  // Methods
  const updateSelectedControlIds = (value: string[]) => {
    emit('update:selectedControlIds', value)
  }

  const addControl = () => {
    showContentSelectDialog.value = true
  }

  const editControl = (id: string) => {
    selectedControlId.value = id
    showControlDialog.value = true
  }

  const onSaveControl = () => {
    showControlDialog.value = false
    selectedControlId.value = null
  }

  const onSelectContent = (selectedModels: Model[], selectedControls: Control[]) => {
    emit('update:addControls', selectedControls)
    showContentSelectDialog.value = false
  }

  // Initialize controls on component mount
  initializeControls()
</script>

<template>
  <div>
    <v-data-table
      v-if="selectedItem"
      class="controls-table"
      :headers="controlTableHeaders"
      item-key="id"
      :items="controls"
      items-per-page="5"
      :items-per-page-options="itemsPerPage"
      :model-value="selectedControlIds"
      show-select
      @update:model-value="updateSelectedControlIds"
    >
      <!-- Search Bar -->
      <template #top>
        <div class="d-flex justify-end mb-6">
          <v-btn
            class="mx-3 my-0"
            color="secondary"
            icon="mdi-shield-plus-outline"
            size="x-large"
            variant="outlined"
            @click="addControl"
          />
        </div>
      </template>
      <template #item.controlClasses="{ item }">
        <div>
          <v-chip
            v-for="templ in item.controlClasses || []"
            :key="templ.id"
            class="ma-1"
            small
          >
            {{ templ.name }}
          </v-chip>
        </div>
      </template>
      <template #item.actions="{ item }">
        <v-btn
          class="ma-1"
          color="secondary"
          icon="mdi-pencil"
          variant="plain"
          @click="editControl(item.id ?? '')"
        />
      </template>
    </v-data-table>
    <v-alert v-else dismissible type="info">No item selected.</v-alert>

    <ControlDialog
      v-if="showControlDialog && selectedControlId !== null"
      :id="selectedControlId ?? ''"
      :show="showControlDialog && selectedControlId !== null"
      :show-file-actions="false"
      @control:closed="showControlDialog = false; selectedControlId = null"
      @control:saved="onSaveControl"
    />
    <ContentSelectDialog
      v-if="showContentSelectDialog"
      content-type="Control"
      enable-create
      select-type="multiple"
      :show="showContentSelectDialog"
      @close="showContentSelectDialog = false"
      @select="onSelectContent"
    />
  </div>
</template>

<style scoped>
  .controls-table {
    max-height: 300px;
    overflow-y: auto;
  }
</style>
