<!--
  Custom Categorization Renderer for JSON Forms with Vuetify
  
  This component replaces the default tabbed categorization layout with Vuetify expansion panels.
  
  Usage:
  1. Import the component and tester:
     import CustomCategorizationRenderer, { customCategorizationTester } from '@/components/DataFlow/CustomCategorizationRenderer.vue'
  
  2. Add to your renderers array with higher priority:
     const renderers = markRaw([
       { tester: customCategorizationTester, renderer: CustomCategorizationRenderer },
       ...extendedVuetifyRenderers,
     ])
  
  3. Use with JsonForms as usual - it will automatically apply to categorization schemas
  
  Features:
  - Expansion panels instead of tabs
  - Multiple panels can be open simultaneously
  - Support for category labels and optional icons
  - Proper event handling and data flow
  - Custom 'panel-opened' event with variable keys
  - Responsive design with Vuetify styling
  
  Events:
  - change: Standard JSON Forms change event
  - panel-opened: Custom event when expansion panel is opened
    Event data: {
      panelIndex: number,
      categoryLabel: string,
      variableKeys: string[],
      category: Category
    }
  
  Props (same as standard JSON Forms renderer):
  - schema: JSON Schema object
  - uischema: UI Schema with categorization
  - data: Form data object
  - renderers: Array of renderers
  - cells: Array of cell renderers (optional)
  - path: Current form path
  - enabled: Whether form is enabled (optional)
  - config: Additional configuration (optional)
-->

<script lang="ts">
import { defineComponent, computed, ref, inject, nextTick } from 'vue'
import { JsonForms } from '@jsonforms/vue'
import { rankWith, isCategorization, type Category, type Categorization, type JsonFormsRendererRegistryEntry, type JsonFormsCellRendererRegistryEntry } from '@jsonforms/core'

// Tester function to determine when this renderer should be used
// Higher rank means higher priority
export const customCategorizationTester = rankWith(10, isCategorization)

// Export the component as default
export default defineComponent({
  name: 'CustomCategorizationRenderer',
  components: {
    JsonForms,
  },
  props: {
    schema: {
      type: Object,
      required: true
    },
    uischema: {
      type: Object,
      required: true
    },
    data: {
      type: Object,
      default: () => ({})
    },
    renderers: {
      type: Array as () => JsonFormsRendererRegistryEntry[],
      required: true
    },
    cells: {
      type: Array as () => JsonFormsCellRendererRegistryEntry[],
      default: () => []
    },
    path: {
      type: String,
      default: ''
    },
    enabled: {
      type: Boolean,
      default: true
    },
    config: {
      type: Object,
      default: () => ({})
    }
  },
  emits: ['change', 'panel-opened', 'info-clicked', 'panel-closed'],
  setup(props, { emit }) {
    // State for managing which panels are open (default: no panel is open)
    const openPanels = ref<number[]>([])
    // Track the previous state separately to detect changes properly
    const previousOpenPanels = ref<number[]>([])
    // Track the last opened panel to only emit close event for it
    const lastOpenedPanel = ref<number | null>(null)

    // Try to get data from JSON Forms context
    const jsonforms = inject('jsonforms', null) as any
    
    // Inject event handlers from parent component
    const panelOpenedHandler = inject('panelOpenedHandler', null) as any
    const infoClickedHandler = inject('infoClickedHandler', null) as any
    const panelClosedHandler = inject('panelClosedHandler', null) as any
    
    
    
    // Computed to get the actual data (either from props or context)
    const actualData = computed(() => {
      // First try props data
      if (props.data && Object.keys(props.data).length > 0) {
        return props.data
      }
      
      // Then try JSON Forms context
      if (jsonforms && jsonforms.core && jsonforms.core.data) {
        return jsonforms.core.data
      }
      return {}
    })

    // Optional: Watch for data changes (disabled for production)
    // watch(
    //   () => [props.data, actualData.value],
    //   ([propsData, computedData]) => {
    //     console.log('CustomCategorizationRenderer - data changed:', {
    //       propsDataKeys: Object.keys(propsData || {}),
    //       computedDataKeys: Object.keys(computedData || {}),
    //       hasPropsData: Object.keys(propsData || {}).length > 0,
    //       hasComputedData: Object.keys(computedData || {}).length > 0
    //     })
    //   },
    //   { immediate: true, deep: true }
    // )

    // Computed property to get visible categories
    const visibleCategories = computed(() => {
      if (!props.uischema?.elements) {
        return []
      }
      
      return props.uischema.elements.filter((element: Categorization | Category) => {
        // Check if the category has elements and is visible
        return element.type === 'Category' && 
               'elements' in element &&
               element.elements && 
               element.elements.length > 0 &&
               ('rule' in element && element.rule ? evaluateRule(element.rule) : true)
      }) as Category[]
    })

    // Handle form changes and emit to parent
    const handleChange = (event: any) => {
      // Update JSON Forms context directly for consistency
      if (jsonforms && jsonforms.core) {
        jsonforms.core.data = event.data
        jsonforms.core.errors = event.errors || []
      }
      
      // Emit event to trigger parent component reactivity
      emit('change', event)
      
      // Ensure Vue reactivity processes the updates
      nextTick()
    }

    // Extract variable keys from a category's UI schema
    const extractVariableKeys = (category: Category): string[] => {
      const keys: string[] = []
      
      const extractFromElement = (element: any): void => {
        if (element.scope) {
          // Extract property name from JSON Pointer scope (e.g., "#/properties/fieldName" -> "fieldName")
          const match = element.scope.match(/#\/properties\/(.+)$/)
          if (match) {
            keys.push(match[1])
          }
        }
        
        // Recursively process nested elements
        if (element.elements && Array.isArray(element.elements)) {
          element.elements.forEach(extractFromElement)
        }
      }
      
      if (category.elements) {
        category.elements.forEach(extractFromElement)
      }
      
      return keys
    }

    // Handle expansion panel open/close events
    const handlePanelToggle = (newOpenPanels: number[]) => {
      // Convert to regular arrays to avoid proxy issues
      const previousPanels = Array.from(previousOpenPanels.value || [])
      const currentPanels = Array.from(newOpenPanels || [])
      
      // Find newly opened panels (panels that are in current but not in previous)
      const newlyOpenedPanels = currentPanels.filter(panel => !previousPanels.includes(panel))
      
      // Find newly closed panels (panels that were in previous but not in current)
      const newlyClosedPanels = previousPanels.filter(panel => !currentPanels.includes(panel))
      
      // If no newly opened panels, try a different approach - emit for all open panels when there's a change
      if (newlyOpenedPanels.length === 0 && currentPanels.length > 0) {
        // Debug: Uncomment for debugging
        // console.log('CustomCategorizationRenderer - no newly opened panels detected, but panels are open. Emitting for all open panels.')
        currentPanels.forEach(panelIndex => {
          const category = visibleCategories.value[panelIndex]
          if (category) {
            const variableKeys = extractVariableKeys(category)
            const eventData = {
              panelIndex,
              categoryLabel: category.label || `Category ${panelIndex + 1}`,
              variableKeys,
              category,
              action: 'state_check'
            }
            
            // Debug: Uncomment for debugging
            // console.log('CustomCategorizationRenderer - emitting state check event:', eventData)
            
            if (panelOpenedHandler) {
              // Debug: Uncomment for debugging
              // console.log('CustomCategorizationRenderer - calling injected handler for state check')
              panelOpenedHandler(eventData)
            }
          }
        })
      } else {
        // Emit event for each newly opened panel and track the last one
        newlyOpenedPanels.forEach(panelIndex => {
          // Update the last opened panel tracker
          lastOpenedPanel.value = panelIndex
          
          const category = visibleCategories.value[panelIndex]
          if (category) {
            const variableKeys = extractVariableKeys(category)
            const eventData = {
              panelIndex,
              categoryLabel: category.label || `Category ${panelIndex + 1}`,
              variableKeys,
              category,
              action: 'newly_opened'
            }
            
            // Debug: Uncomment for debugging
            // console.log('CustomCategorizationRenderer - emitting newly opened event:', eventData)
            
            // Emit the event using Vue's emit system
            emit('panel-opened', eventData)
            
            // Also call the injected handler directly if available
            if (panelOpenedHandler) {
              // Debug: Uncomment for debugging
              // console.log('CustomCategorizationRenderer - calling injected handler for newly opened panel')
              panelOpenedHandler(eventData)
            }
          }
        })
      }
      
      // Handle newly closed panels - only emit for the last opened panel
      if (newlyClosedPanels.length > 0) {
        // Only emit close event if the last opened panel was closed
        if (lastOpenedPanel.value !== null && newlyClosedPanels.includes(lastOpenedPanel.value)) {
          const eventData = {
            panelIndex: lastOpenedPanel.value,
            action: 'last_opened_panel_closed'
          }
          
          // Emit the event using Vue's emit system
          emit('panel-closed', eventData)
          
          // Also call the injected handler directly if available
          if (panelClosedHandler) {
            panelClosedHandler(eventData)
          }
          
          // Reset the last opened panel tracker
          lastOpenedPanel.value = null
        }
      }
      
      // Update both refs - openPanels for v-model and previousOpenPanels for next comparison
      previousOpenPanels.value = [...currentPanels]
      openPanels.value = currentPanels
    }

    const handleInfoClick = (event: Event, category: Category, categoryIndex: number) => {
      // Prevent the click from bubbling up to the expansion panel title
      event.stopPropagation()
      
      // Extract variable keys from the category (same as panel-opened event)
      const variableKeys = extractVariableKeys(category)
      
      // Create event data similar to panel-opened
      const eventData = {
        panelIndex: categoryIndex,
        categoryLabel: category.label || `Category ${categoryIndex + 1}`,
        variableKeys,
        category,
        action: 'info_clicked'
      }
      
      // Emit the event using Vue's emit system
      emit('info-clicked', eventData)
      
      // Also call the injected handler directly if available
      if (infoClickedHandler) {
        infoClickedHandler(eventData)
      }
    }

    // Simple rule evaluation (can be extended based on your needs)
    const evaluateRule = (rule: any): boolean => {
      // For now, return true - extend this based on your rule evaluation logic
      // This would typically check conditions against the current data
      return true
    }

    return {
      openPanels,
      visibleCategories,
      actualData,
      handleChange,
      handlePanelToggle,
      handleInfoClick
    }
  }
})
</script>

<template>
  <v-expansion-panels
    v-if="visibleCategories.length > 0"
    v-model="openPanels"
    class="elevation-0 mx-0 px-0"
    color="transparent"
    multiple
    variant="accordion"
    @update:model-value="(val: unknown) => handlePanelToggle(val as number[])"
  >
    <v-expansion-panel
      v-for="(category, index) in visibleCategories"
      class="mb-2 elevation-0 opacity-80 categories-panel"
      :key="`category-${index}`"
      static
      :value="index"
    >
      <v-expansion-panel-title
        class="elevation-12 rounded-lg pa-2 ma-0 categories-panel-title"
      >
        <v-icon v-if="'icon' in category && category.icon" :icon="String(category.icon)" class="me-2" />
        {{ category.label || `Category ${index + 1}` }}
        <v-spacer />
        <v-btn
          class="ma-0 pa-0 mr-1"
          color="tertiary"
          icon="mdi-information-variant-circle-outline"
          variant="text"
          size="small"
          @click="(event: Event) => handleInfoClick(event, category, index)"
        />
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <!-- Debug info -->
        <div v-if="false" class="mb-2 pa-2 bg-grey-darken-3 text-caption">
          <strong>Debug - Category {{ index }}:</strong><br>
          Elements: {{ category.elements?.length || 0 }}<br>
          Data keys: {{ Object.keys(actualData || {}).join(', ') }}<br>
          Path: "{{ path }}"
        </div>
        
        <json-forms
          :schema="schema"
          :uischema="category"
          :data="actualData"
          :renderers="renderers"
          :cells="cells"
          :path="path"
          :enabled="enabled"
          :config="config"
          @change="handleChange"
        />
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
  
  <!-- Fallback for when no categories are visible -->
  <v-alert
    v-else
    type="info"
    variant="tonal"
    class="ma-2"
  >
    No categories available to display.
  </v-alert>
</template>

<style scoped>
.v-expansion-panels :deep(.v-expansion-panel-text__wrapper) {
  padding: 16px;
}

.v-expansion-panel-title {
  font-weight: 500;
}

/* Ensure proper spacing for nested JSON Forms */
.v-expansion-panel-text :deep(.json-forms) {
  width: 100%;
}

/* Override any conflicting styles from parent JSON Forms */
.v-expansion-panel-text :deep(.v-col) {
  padding-top: 8px !important;
  padding-bottom: 8px !important;
}
.categories-panel {
  background-color: rgba(var(--v-theme-background), 0);
  border-width: 0;
}

.categories-panel * {
  box-shadow: none;
}

.categories-panel-title {
  border-width: 1px;
  border-style: solid;
  border-color: rgba(var(--v-theme-quinary), 1);
  background-color: rgba(var(--v-theme-background), 0);
  border-radius: 0;
}
</style>
