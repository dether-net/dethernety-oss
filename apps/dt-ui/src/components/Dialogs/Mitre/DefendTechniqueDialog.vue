<script setup lang="ts">
  import { ref } from 'vue'
  import { useAnalysisStore } from '@/stores/analysisStore'
  import { MitreDefendTechnique } from '@dethernety/dt-core'

  interface Props {
    show: boolean
    d3fendId: string
  }

  const props = defineProps<Props>()
  const show = ref(props.show)
  const d3fendId = ref(props.d3fendId)
  const emits = defineEmits(['close'])

  const analysisStore = useAnalysisStore()
  const technique = ref<MitreDefendTechnique | null>(null)

  analysisStore.getMitreDefendTechnique({ d3fendId: d3fendId.value }).then(mit => {
    technique.value = mit
  })

  watch(() => props.show, newVal => {
    show.value = newVal
  })

  const close = () => {
    show.value = false
    emits('close')
  }

</script>

<template>
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <v-dialog
    v-model="show"
    max-width="800"
    @afterLeave="close"
    @keydown.esc="close"
  >
    <v-card class="pa-0 ma-0 rounded-lg">
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="tertiary" size="small">mdi-shield-star-outline</v-icon>
            <span class="ml-2 text-body-1">{{ technique?.name }}</span>
          </div>
          <v-btn
            color="foreground"
            icon="mdi-close"
            size="medium"
            variant="text"
            @click="close"
          />
        </v-sheet>
      </v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12">
            <v-card-title>
              <span class="headline">Description</span>
            </v-card-title>
            <v-card-text>
              {{ technique?.description }}
            </v-card-text>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
