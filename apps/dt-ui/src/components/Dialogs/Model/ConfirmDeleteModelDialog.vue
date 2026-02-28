<script setup lang="ts">
  import { ref, watch } from 'vue'

  interface Props {
    show: boolean
    modelName: string
  }

  const props = defineProps<Props>()

  const showDialog = ref(props.show)
  const emits = defineEmits(['delete:canceled', 'delete:confirmed'])
  const modelName = ref(props.modelName)
  const confirmNameToDelete = ref('')

  const cancelDelete = () => {
    showDialog.value = false
    emits('delete:canceled', false)
  }

  watch(
    () => props.show,
    newVal => {
      showDialog.value = newVal
    }
  )

  watch(showDialog, newVal => {
    if (newVal !== props.show) emits('delete:canceled', newVal)
  })

  const deleteModel = async () => {
    if (confirmNameToDelete.value === modelName.value) {
      emits('delete:confirmed')
    }
  }
</script>

<template>
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <v-dialog
    v-model="showDialog"
    max-width="550"
    @afterLeave="cancelDelete"
    @keydown.esc="cancelDelete"
  >
    <v-card
      class="pa-0 ma-0 rounded-lg"
    >
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="tertiary" size="small">mdi-trash-can-outline</v-icon>
            <span class="ml-2 text-body-1">Delete Model</span>
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
      <v-card-text>
        <v-row>
          <v-col class="d-flex flex-column">
            <v-alert
              class="py-8"
              color="error"
              icon="mdi-alert-circle"
              text="This action cannot be undone."
              title="Are you sure you want to delete this model?"
            />
            <v-spacer />
            <span class="text-subtitle-2">Model Name: {{ modelName }}</span>
            <v-spacer />
            <v-text-field
              v-model="confirmNameToDelete"
              :color="confirmNameToDelete === modelName ? 'success' : 'error'"
              label="Type the model name to confirm"
            />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions class="py-6 mx-6">
        <v-btn
          color="error"
          icon="mdi-trash-can-outline"
          size="x-large"
          variant="outlined"
          @click="deleteModel"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
