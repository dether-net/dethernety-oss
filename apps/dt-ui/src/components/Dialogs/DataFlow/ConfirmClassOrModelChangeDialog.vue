<script setup lang="ts">
  import { computed, ref, watch } from 'vue'

  const emits = defineEmits(['commit-and-change', 'discard-and-change', 'cancel'])

  interface Props {
    show: boolean;
    hasDirtyEdits?: boolean;
    /** 'change' = rebind to another class (default); 'remove' = unassign the class. */
    mode?: 'change' | 'remove';
  }

  const props = withDefaults(defineProps<Props>(), { mode: 'change' })

  watch(
    () => props.show,
    newVal => {
      showDialog.value = newVal
    }
  )

  const showDialog = ref(props.show)

  const isRemove = computed(() => props.mode === 'remove')
  const title = computed(() => isRemove.value ? 'Remove the class' : 'Change the class')
  const warningCopy = computed(() =>
    isRemove.value
      ? 'Removing the class will delete its auto-generated exposures and clear this element’s attributes. Exposures you created yourself are kept.'
      : 'Changing the class will clear this element’s attributes. Threats and exposures will be recomputed on the next analysis run.'
  )
  const dirtyCopy = computed(() =>
    isRemove.value
      ? 'You also have unsaved edits on this element. Commit them and remove the class, or discard them?'
      : 'You also have unsaved edits on this element. Commit them and change class, or discard them?'
  )
  const discardLabel = computed(() => isRemove.value ? 'Discard & remove' : 'Discard & change')
  const confirmLabel = computed(() => {
    if (isRemove.value) return props.hasDirtyEdits ? 'Commit & remove' : 'Remove'
    return props.hasDirtyEdits ? 'Commit & change' : 'Confirm'
  })

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
              <span class="ml-2 text-body-1">{{ title }}</span>
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
                  {{ warningCopy }}
                </v-alert>
              </v-col>
            </v-row>
            <v-row v-if="hasDirtyEdits">
              <v-col cols="12">
                <v-alert density="compact" type="info" variant="tonal">
                  {{ dirtyCopy }}
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
            {{ discardLabel }}
          </v-btn>
          <v-btn
            color="secondary"
            variant="outlined"
            @click="onCommitAndChange"
          >
            {{ confirmLabel }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
