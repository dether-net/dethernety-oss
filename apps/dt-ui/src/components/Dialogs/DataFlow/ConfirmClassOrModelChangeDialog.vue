<script setup lang="ts">
  import { ref, watch } from 'vue'

  const emits = defineEmits(['confirm'])

  interface Props {
    show: boolean;
  }

  const props = defineProps<Props>()

  watch(
    () => props.show,
    newVal => {
      showDialog.value = newVal
    }
  )

  const showDialog = ref(props.show)
  const reject = () => {
    emits('confirm', false)
  }

  const confirm = () => {
    emits('confirm', true)
  }

</script>

<template>
  <div class="text-center pa-4">
    <v-dialog
      v-model="showDialog"
      max-width="400"
      persistent
      @keydown.esc="reject"
    >
      <v-card class="pa-0 ma-0 rounded-lg">
        <v-card-title class="pa-0">
          <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
            <div>
              <v-icon color="tertiary" size="small">mdi-question</v-icon>
              <span class="ml-2 text-body-1">Change the inheritance</span>
            </div>
            <v-btn
              color="foreground"
              icon="mdi-close"
              size="medium"
              variant="text"
              @click="reject"
            />
          </v-sheet>
        </v-card-title>
        <v-card-text>
          <v-container>
            <v-row>
              <v-col cols="12">
                <v-alert type="warning">
                  All the settings will be cleared and the inheritance will be changed. This action cannot be undone.
                </v-alert>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>
        <v-card-actions class="py-6 mx-6 d-flex justify-end">
          <v-btn
            color="secondary"
            icon="mdi-check"
            size="x-large"
            variant="outlined"
            @click="confirm"
          />
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
