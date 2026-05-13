<script setup lang="ts">
  import { computed, ref, watch } from 'vue'

  const emits = defineEmits(['confirm', 'cancel'])

  interface Props {
    show: boolean
    edgeLabel?: string
    oldSourceName: string
    oldTargetName: string
    newSourceName: string
    newTargetName: string
  }
  const props = defineProps<Props>()

  const showDialog = ref(props.show)
  watch(() => props.show, (v) => { showDialog.value = v })

  const sourceChanged = computed(() => props.oldSourceName !== props.newSourceName)
  const targetChanged = computed(() => props.oldTargetName !== props.newTargetName)

  const onCancel = () => emits('cancel')
  const onConfirm = () => emits('confirm')
</script>

<template>
  <div class="text-center pa-4">
    <v-dialog
      v-model="showDialog"
      max-width="520"
      persistent
      @keydown.esc="onCancel"
    >
      <v-card class="pa-0 ma-0 rounded-lg">
        <v-card-title class="pa-0">
          <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
            <div>
              <v-icon color="tertiary" size="small">mdi-vector-polyline-edit</v-icon>
              <span class="ml-2 text-body-1">
                Reroute &ldquo;{{ oldSourceName }} &rarr; {{ oldTargetName }}&rdquo;
                to &ldquo;{{ newSourceName }} &rarr; {{ newTargetName }}&rdquo;?
              </span>
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
            <v-row dense>
              <v-col class="text-medium-emphasis" cols="2">Source:</v-col>
              <v-col cols="10">
                <template v-if="sourceChanged">
                  {{ oldSourceName }} <v-icon size="x-small">mdi-arrow-right</v-icon> <strong>{{ newSourceName }}</strong>
                </template>
                <template v-else>
                  {{ oldSourceName }} <span class="text-medium-emphasis ml-2">(unchanged)</span>
                </template>
              </v-col>
            </v-row>
            <v-row dense>
              <v-col class="text-medium-emphasis" cols="2">Target:</v-col>
              <v-col cols="10">
                <template v-if="targetChanged">
                  {{ oldTargetName }} <v-icon size="x-small">mdi-arrow-right</v-icon> <strong>{{ newTargetName }}</strong>
                </template>
                <template v-else>
                  {{ oldTargetName }} <span class="text-medium-emphasis ml-2">(unchanged)</span>
                </template>
              </v-col>
            </v-row>
            <v-row class="mt-3">
              <v-col cols="12">
                <v-alert density="compact" type="info" variant="tonal">
                  The flow&rsquo;s class, data items, and controls will be preserved.
                  Threats and exposures will be recomputed on the next analysis run.
                </v-alert>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>
        <v-card-actions class="py-4 mx-6 d-flex justify-end">
          <v-btn color="grey" variant="text" @click="onCancel">Cancel</v-btn>
          <v-btn color="secondary" variant="outlined" @click="onConfirm">Reroute</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
