<script setup lang="ts">
  import { markRaw, ref, computed, watch, provide } from 'vue'
  import { JsonForms } from '@jsonforms/vue'
  import { extendedVuetifyRenderers } from '@jsonforms/vue-vuetify'
  import type { UISchemaElement } from '@jsonforms/core'
  import { Class } from '@dethernety/dt-core'
  import CustomCategorizationRenderer, { customCategorizationTester } from '@/components/DataFlow/CustomCategorizationRenderer.vue'

  const emit = defineEmits(['form:updated', 'form:panel-opened', 'form:info-clicked', 'form:panel-closed', 'attributes:changed'])
  
  // Props
  interface Props {
    itemId: string | null;
    itemClass: Class | null;
    attributesData?: object;
    schema?: object | null;
    uischema?: UISchemaElement | null;
    isLoading?: boolean;
    templateWarning?: boolean;
    useExpansionPanels?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    attributesData: () => ({}),
    schema: null,
    uischema: null,
    isLoading: false,
    templateWarning: false,
    useExpansionPanels: true
  })

  // Create a computed property for renderers
  const renderers = computed(() => markRaw([
    ...(props.useExpansionPanels 
      ? [{ tester: customCategorizationTester, renderer: CustomCategorizationRenderer }]
      : []
    ),
    ...extendedVuetifyRenderers,
  ]))

  // Internal reactive data that mirrors props
  const internalAttributesData = ref(props.attributesData)

  // Event handlers
  const handlePanelOpened = (eventData: any) => {
    emit('form:panel-opened', eventData)
  }

  const handleInfoClicked = (eventData: any) => {
    emit('form:info-clicked', eventData)
  }

  const handlePanelClosed = (eventData: any) => {
    emit('form:panel-closed', eventData)
  }

  // Provide event handlers to child components
  provide('panelOpenedHandler', handlePanelOpened)
  provide('infoClickedHandler', handleInfoClicked)
  provide('panelClosedHandler', handlePanelClosed)

  // Methods
  const updateAttributesData = (data: object) => {
    // Deep compare to check if data actually changed
    const hasChanged = JSON.stringify(internalAttributesData.value) !== JSON.stringify(data)
    
    internalAttributesData.value = data
    
    // Only emit attributes:changed if data actually changed
    if (hasChanged) {
      emit('attributes:changed', data)
    }
    
    emit('form:updated')
  }

  // Watch for changes in attributesData prop and update internal state
  watch(
    () => props.attributesData,
    (newData) => {
      if (newData && Object.keys(newData).length > 0) {
        internalAttributesData.value = newData
      }
    },
    { deep: true, immediate: true }
  )
</script>

<template>
  <v-card flat>
    <v-container class="pt-0 h-100">
      <v-row class="h-100" no-gutters>
        <v-col class="pa-0" cols="12">
          <v-sheet class="h-100 position-relative" color="transparent">
            <v-progress-linear
              v-if="props.isLoading"
              class="mb-4"
              color="primary"
              indeterminate
            />
            <json-forms
              v-if="!props.isLoading && props.schema && props.uischema && props.itemId && props.itemClass"
              class="h-100 json-forms"
              :data="internalAttributesData"
              :renderers="renderers"
              :schema="props.schema"
              :uischema="props.uischema"
              @change="(event: any) => updateAttributesData(event.data)"
            />
            <v-alert v-else-if="!props.itemId" dismissible type="info">
              No item selected.
            </v-alert>
            <v-alert v-else-if="!props.itemClass" dismissible type="info">
              No class information available for this item.
            </v-alert>
            <v-alert v-if="props.templateWarning" dismissible type="warning">
              Form could not be rendered due to missing or invalid schema.
            </v-alert>
          </v-sheet>
        </v-col>
      </v-row>
    </v-container>
  </v-card>
</template>

<style>
  @import '@jsonforms/vue-vuetify/lib/jsonforms-vue-vuetify.css';
</style>

<style scoped>
  .json-forms :deep(.v-col) {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }

  .json-forms :deep(.v-window) {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    width: 100% !important;
  }

  .json-forms :deep(.v-toolbar__content) {
    height: 55px !important;
  }
</style>
