<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { getReportDetails, setReportDetails, suggestReportDetails } from '@/reporting/reportDetails'
  import { CLIENT_MAX, codePointLength, saveErrorMessage } from '@/utils/reportDetailsInput'

  /**
   * An analysis's report details: what its reports print about it that the analysis does not hold itself (today the
   * client a report is prepared for). One dialog for every analysis type, so no analysis view implements its own.
   *
   * The parent mounts it per opening; the analysis id given then is the one every load and save uses, even if the page
   * moves on, and the parent closes it on a route change.
   */
  interface Props {
    analysisId: string
  }

  const props = defineProps<Props>()
  const emit = defineEmits<{ (e: 'closed'): void; (e: 'saved'): void }>()

  // Captured at open.
  const analysisId = props.analysisId

  const show = ref(true)
  const loading = ref(true)
  const saving = ref(false)
  const loadError = ref('')
  const saveError = ref('')
  const stored = ref('')
  const client = ref('')
  const suggestion = ref<string | null>(null)

  const trimmed = computed(() => client.value.trim())
  const tooLong = computed(() => codePointLength(trimmed.value) > CLIENT_MAX)
  const changed = computed(() => trimmed.value !== stored.value)
  const canSave = computed(() => !loading.value && !saving.value && !loadError.value && changed.value && !tooLong.value)
  const offerSuggestion = computed(() => !loading.value && trimmed.value === '' && !!suggestion.value)

  const lengthRule = (value: string) =>
    codePointLength(String(value ?? '').trim()) <= CLIENT_MAX || `At most ${CLIENT_MAX} characters.`

  // Not while a save is in flight: its refusal would have nowhere to show.
  const close = () => {
    if (!saving.value) show.value = false
  }
  // However the dialog closes (a button, Esc, outside, or the browser's Back), the parent hears of it.
  watch(show, (open) => {
    if (!open) emit('closed')
  })

  const load = async () => {
    loading.value = true
    loadError.value = ''
    try {
      const [details, suggested] = await Promise.all([
        getReportDetails(analysisId),
        suggestReportDetails(analysisId).catch(() => null),
      ])
      stored.value = details?.client ?? ''
      client.value = stored.value
      suggestion.value = suggested?.client ?? null
    } catch {
      loadError.value = "The report details couldn't be loaded."
    } finally {
      loading.value = false
    }
  }

  const save = async () => {
    if (!canSave.value) return
    saving.value = true
    saveError.value = ''
    try {
      await setReportDetails(analysisId, trimmed.value === '' ? null : trimmed.value)
      saving.value = false
      emit('saved')
      close()
    } catch (error) {
      saving.value = false
      saveError.value = saveErrorMessage(error)
    }
  }

  const useSuggestion = () => {
    if (suggestion.value) client.value = suggestion.value
  }

  load()
</script>

<template>
  <!-- eslint-disable vue/attribute-hyphenation -->
  <v-dialog
    v-model="show"
    attach="body"
    max-width="560px"
    :persistent="saving"
    @click:outside="close"
    @keydown.esc="close"
  >
    <v-card class="pa-0 ma-0 rounded-lg">
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="tertiary" size="small">mdi-card-account-details-outline</v-icon>
            <span class="ml-2 text-body-1">Report details</span>
          </div>
          <v-btn aria-label="Close" color="foreground" icon="mdi-close" size="medium" variant="text" @click="close" />
        </v-sheet>
      </v-card-title>
      <v-card-text class="pt-4">
        <v-alert v-if="loadError" class="mb-4" type="error" variant="tonal" :text="loadError" />
        <v-text-field
          v-model="client"
          class="report-details-client"
          :counter="CLIENT_MAX"
          :counter-value="(value: string) => codePointLength(String(value ?? '').trim())"
          :disabled="loading || !!loadError"
          hint="Printed on the cover of this analysis's reports as “Prepared for”. Leave empty for none."
          label="Client"
          :loading="loading"
          persistent-hint
          :rules="[lengthRule]"
          variant="outlined"
          @keydown.enter="save"
        />
        <div v-if="offerSuggestion" class="report-details-suggestion mt-3 d-flex align-center flex-wrap ga-2">
          <span class="text-medium-emphasis">From another analysis of the same element:</span>
          <v-btn size="small" variant="tonal" @click="useSuggestion">{{ suggestion }}</v-btn>
        </div>
        <v-alert v-if="saveError" class="mt-4 report-details-error" type="error" variant="tonal" :text="saveError" />
      </v-card-text>
      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" @click="close">Cancel</v-btn>
        <v-btn
          class="report-details-save"
          color="primary"
          :disabled="!canSave"
          :loading="saving"
          variant="flat"
          @click="save"
        >Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
