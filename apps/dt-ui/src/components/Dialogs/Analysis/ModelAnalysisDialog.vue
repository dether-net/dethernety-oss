<script setup lang="ts">
  import { ref, watch } from 'vue'
  import AnalysisDialog from '@/components/Dialogs/Analysis/AnalysisDialog.vue'

  /**
   * The model's analyses, on their own.
   *
   * ModelDialog's "Analysis" tab body is a single `<AnalysisDialog :model-id>`,
   * so there is nothing to extract or share here beyond the chrome — this
   * deliberately mirrors ModelDialog's decoration (same v-dialog geometry, same
   * primary title sheet, same inner card and scroll height) rather than teaching
   * ModelDialog a tabs-subset mode. ModelDialog fetches the whole model on mount
   * and owns save / export / delete; none of that is wanted just to list
   * analyses.
   *
   * Keep the decoration in step with ModelDialog if that dialog's chrome changes.
   */
  interface Props {
    show: boolean
    modelId: string
    modelName: string
  }

  const props = defineProps<Props>()
  const emits = defineEmits(['analysis:closed'])
  const showDialog = ref(props.show)

  watch(
    () => props.show,
    newVal => {
      showDialog.value = newVal
    }
  )
</script>

<template>
  <!-- eslint-disable vue/no-lone-template -->
  <!-- eslint-disable vue/attribute-hyphenation -->
  <v-dialog
    v-model="showDialog"
    attach="body"
    class="pa-0 ma-0"
    max-width="75vw"
    @click:outside="emits('analysis:closed')"
    @keydown.esc="emits('analysis:closed')"
  >
    <v-card
      class="pa-0 ma-0 rounded-lg"
    >
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="tertiary" size="small">mdi-creation</v-icon>
            <span class="ml-2 text-body-1">Analysis: {{ modelName }}</span>
          </div>
          <v-btn
            color="foreground"
            icon="mdi-close"
            size="medium"
            variant="text"
            @click="emits('analysis:closed')"
          />
        </v-sheet>
      </v-card-title>
      <v-card-text>
        <v-card class="elevation-8 mb-4 border-thin rounded-lg">
          <v-container class="w-100">
            <v-row>
              <!-- Matches the height/scroll of ModelDialog's tab window, so the
                   dialog keeps the same geometry as the tabbed original. -->
              <div class="analysis-pane w-100">
                <AnalysisDialog
                  v-if="modelId"
                  :model-id="modelId"
                  @results:opened="emits('analysis:closed')"
                />
              </div>
            </v-row>
          </v-container>
        </v-card>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.analysis-pane {
  height: 400px;
  overflow-y: auto;
}
</style>
