<script setup lang="ts">
  import { ref, watch } from 'vue'

  interface Props {
    show: boolean
  }

  const props = defineProps<Props>()

  const showDialog = ref(props.show)
  const emits = defineEmits(['dialog:closed', 'create:confirmed'])

  const closeDialog = () => {
    showDialog.value = false
    emits('dialog:closed')
  }

  watch(
    () => props.show,
    newVal => {
      showDialog.value = newVal
    }
  )

  watch(showDialog, newVal => {
    if (newVal !== props.show) emits('dialog:closed', newVal)
  })

</script>

<template>
  <div class="text-center pa-4">
    <v-dialog
      v-model="showDialog"
      max-width="400"
      persistent
      @keydown.esc="closeDialog"
    >
      <v-card class="pa-0 ma-0 rounded-lg">
        <v-card-title class="pa-0">
          <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
            <div>
              <v-icon color="tertiary" size="small">mdi-help-circle-outline</v-icon>
              <span class="ml-2 text-body-1">Create new class</span>
            </div>
            <v-btn
              color="foreground"
              icon="mdi-close"
              size="medium"
              variant="text"
              @click="closeDialog"
            />
          </v-sheet>
        </v-card-title>
        <v-card-text>
          <v-container>
            <v-row>
              <v-col cols="12">
                <v-alert
                  icon="mdi-help-circle-outline"
                  type="info"
                >
                  Are you ok with creating a new class?
                </v-alert>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>
        <v-card-actions class="py-6 mx-6 d-flex justify-end">
          <v-btn
            color="primary"
            icon="mdi-close"
            size="x-large"
            variant="outlined"
            @click="closeDialog"
          />
          <v-btn
            color="success"
            icon="mdi-check"
            size="x-large"
            variant="outlined"
            @click="emits('create:confirmed')"
          />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
