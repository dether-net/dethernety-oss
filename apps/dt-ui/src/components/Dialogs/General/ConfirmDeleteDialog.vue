<script setup lang="ts">
  import { ref, watch } from 'vue'

  interface Props {
    show: boolean
    message: string
  }

  const props = defineProps<Props>()

  const showDialog = ref(props.show)
  const message = ref(props.message)
  const emits = defineEmits(['delete:canceled', 'delete:confirmed'])

  watch(
    () => props.show,
    newVal => {
      showDialog.value = newVal
    }
  )

  watch(showDialog, newVal => {
    if (newVal !== props.show) emits('delete:canceled', newVal)
  })

  const cancelDelete = () => {
    showDialog.value = false
    emits('delete:canceled', false)
  }

  const confirmDelete = () => {
    showDialog.value = false
    emits('delete:confirmed')
  }
</script>

<template>
  <div class="text-center pa-4">
    <v-dialog
      v-model="showDialog"
      max-width="400"
      persistent
      @keydown.esc="cancelDelete"
      @update:model-value="cancelDelete"
    >
      <v-card class="pa-0 ma-0 rounded-lg">
        <v-card-title class="pa-0">
          <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
            <div>
              <v-icon color="foreground" size="small">mdi-trash-can-outline</v-icon>
              <span class="ml-2 text-body-1">Confirm Delete</span>
            </div>
            <v-btn
              color="foreground"
              icon="mdi-close"
              size="medium"
              variant="text"
              @click="cancelDelete"
            />
          </v-sheet>
        </v-card-title>
        <v-card-text class="pa-0 px-5 pt-5 ma-2">
          <span class="text-body-1">{{ message }}</span>
        </v-card-text>
        <v-card-actions class="py-6 mx-6">
          <v-btn
            color="error"
            icon="mdi-trash-can-outline"
            size="x-large"
            variant="outlined"
            @click="confirmDelete"
          />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
