<script setup lang="ts">
  import { ref, watch } from 'vue'

  const emits = defineEmits(['commit-and-change', 'discard-and-change', 'cancel'])

  interface Props {
    show: boolean;
    hasDirtyEdits?: boolean;
  }

  const props = defineProps<Props>()

  watch(
    () => props.show,
    newVal => {
      showDialog.value = newVal
    }
  )

  const showDialog = ref(props.show)

  const onCancel = () => {
    emits('cancel')
  }

  const onCommitAndChange = () => {
    emits('commit-and-change')
  }

  const onDiscardAndChange = () => {
    emits('discard-and-change')
  }

</script>

<template>
  <div class="text-center pa-4">
    <v-dialog
      v-model="showDialog"
      max-width="480"
      persistent
      @keydown.esc="onCancel"
    >
      <v-card class="pa-0 ma-0 rounded-lg">
        <v-card-title class="pa-0">
          <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
            <div>
              <v-icon color="tertiary" size="small">mdi-question</v-icon>
              <span class="ml-2 text-body-1">Change the class</span>
            </div>
            <v-btn
              color="foreground"
              icon="mdi-close"
              size="medium"
              variant="text"
              @click="onCancel"
            />
          </v-sheet>
        </v-card-title>
        <v-card-text>
          <v-container>
            <v-row>
              <v-col cols="12">
                <v-alert type="warning" variant="tonal">
                  Changing the class will clear this element&rsquo;s attributes.
                  Threats and exposures will be recomputed on the next analysis run.
                </v-alert>
              </v-col>
            </v-row>
            <v-row v-if="hasDirtyEdits">
              <v-col cols="12">
                <v-alert density="compact" type="info" variant="tonal">
                  You also have unsaved edits on this element. Commit them and change class, or discard them?
                </v-alert>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>
        <v-card-actions class="py-6 mx-6 d-flex justify-end">
          <v-btn
            color="grey"
            variant="text"
            @click="onCancel"
          >
            Cancel
          </v-btn>
          <v-btn
            v-if="hasDirtyEdits"
            color="warning"
            variant="outlined"
            @click="onDiscardAndChange"
          >
            Discard &amp; change
          </v-btn>
          <v-btn
            color="secondary"
            variant="outlined"
            @click="onCommitAndChange"
          >
            {{ hasDirtyEdits ? 'Commit &amp; change' : 'Confirm' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
