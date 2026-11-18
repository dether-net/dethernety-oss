<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import {
    getReportDetails,
    setReportDetails,
    suggestReportDetails,
    type ReportDetails,
    type ReportDetailsChanges,
  } from '@/reporting/reportDetails'
  import {
    AUTHOR_MAX,
    CLIENT_MAX,
    CUSTOM_FIELDS_MAX,
    FIELD_LABEL_MAX,
    FIELD_VALUE_MAX,
    PROJECT_MAX,
    REPORT_DETAILS_MAX_BYTES,
    codePointLength,
    hasLetterOrDigit,
    labelKey,
    saveErrorMessage,
    storedSize,
  } from '@/utils/reportDetailsInput'

  /**
   * An analysis's report details: what its reports print about it that the analysis does not hold itself (the client,
   * the author, the project, and fields the user adds). One dialog for every analysis type, so no analysis view
   * implements its own.
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

  type NamedKey = 'client' | 'author' | 'project'
  interface Row {
    id: number
    label: string
    value: string
  }
  interface Saved {
    client: string
    author: string
    project: string
    customFields: { label: string; value: string }[]
  }

  const NAMED: { key: NamedKey; label: string; max: number; hint: string }[] = [
    {
      key: 'client',
      label: 'Client',
      max: CLIENT_MAX,
      hint: 'Printed on the cover of this analysis\'s reports as “Prepared for”, and in “About this report”. Leave empty for none.',
    },
    {
      key: 'author',
      label: 'Author',
      max: AUTHOR_MAX,
      hint: 'Printed on the cover and in “About this report”, in place of the account that exported it.',
    },
    { key: 'project', label: 'Project', max: PROJECT_MAX, hint: 'Printed on the cover and in “About this report”.' },
  ]

  const show = ref(true)
  const loading = ref(true)
  const saving = ref(false)
  const loadError = ref('')
  const saveError = ref('')
  const saved = ref<Saved>({ client: '', author: '', project: '', customFields: [] })
  const named = ref<Record<NamedKey, string>>({ client: '', author: '', project: '' })
  const rows = ref<Row[]>([])
  const suggestion = ref<ReportDetails | null>(null)
  // Rows the user has left, by id: a row's problem shows once the user leaves it, not while typing into it.
  const leftRows = ref(new Set<number>())
  let nextRowId = 0

  const toRows = (fields: { label: string; value: string }[] | undefined): Row[] =>
    (fields ?? []).map((field) => ({ id: nextRowId++, label: field.label, value: field.value }))

  // The form as a save would send it: trimmed, and with fully empty rows dropped.
  const trimmed = computed(() => ({
    client: named.value.client.trim(),
    author: named.value.author.trim(),
    project: named.value.project.trim(),
  }))
  const fields = computed(() =>
    rows.value
      .map((row) => ({ label: row.label.trim(), value: row.value.trim() }))
      .filter((field) => field.label !== '' || field.value !== ''),
  )

  /** Only what the user changed, so a save leaves what another editor set in other keys. */
  const changes = computed<ReportDetailsChanges>(() => {
    const out: ReportDetailsChanges = {}
    for (const { key } of NAMED) {
      if (trimmed.value[key] !== saved.value[key]) out[key] = trimmed.value[key] === '' ? null : trimmed.value[key]
    }
    if (JSON.stringify(fields.value) !== JSON.stringify(saved.value.customFields)) {
      out.customFields = fields.value.length > 0 ? fields.value : null
    }
    return out
  })
  const changed = computed(() => Object.keys(changes.value).length > 0)

  const lengthRule = (max: number) => (value: string) =>
    codePointLength(String(value ?? '').trim()) <= max || `At most ${max} characters.`

  /** The row's problem as the server would refuse it, shown under the label or the value. */
  const rowErrors = computed(() => {
    const seen = new Set<string>()
    return rows.value.map((row) => {
      const label = row.label.trim()
      const value = row.value.trim()
      if (label === '' && value === '') return { label: '', value: '' }
      if (label === '') return { label: 'Add a label, or remove the field.', value: '' }
      if (value === '') return { label: '', value: 'Add a value, or remove the field.' }
      if (!hasLetterOrDigit(label)) return { label: 'A label needs a letter or digit.', value: '' }
      const key = labelKey(label)
      if (seen.has(key)) return { label: 'Another field has this label.', value: '' }
      seen.add(key)
      return { label: '', value: '' }
    })
  })

  const tooLong = computed(
    () =>
      NAMED.some(({ key, max }) => codePointLength(trimmed.value[key]) > max) ||
      fields.value.some(
        (field) => codePointLength(field.label) > FIELD_LABEL_MAX || codePointLength(field.value) > FIELD_VALUE_MAX,
      ),
  )

  /** The details as the save would store them, over the server's cap. Keys the dialog cannot see are the server's. */
  const tooLarge = computed(() => {
    const stored: Record<string, unknown> = {}
    for (const { key } of NAMED) if (trimmed.value[key] !== '') stored[key] = trimmed.value[key]
    if (fields.value.length > 0) stored.customFields = fields.value
    return storedSize(stored) > REPORT_DETAILS_MAX_BYTES
  })

  const invalid = computed(
    () =>
      tooLong.value ||
      tooLarge.value ||
      fields.value.length > CUSTOM_FIELDS_MAX ||
      rowErrors.value.some((error) => error.label !== '' || error.value !== ''),
  )
  const canSave = computed(() => !loading.value && !saving.value && !loadError.value && changed.value && !invalid.value)

  // The suggestion is offered only on an empty form, and fills everything; nothing is saved until Save.
  const empty = computed(() => NAMED.every(({ key }) => trimmed.value[key] === '') && fields.value.length === 0)
  const offerSuggestion = computed(() => !loading.value && !loadError.value && empty.value && !!suggestion.value)
  const suggestionSummary = computed(() => {
    const s = suggestion.value
    if (!s) return ''
    const count = s.customFields?.length ?? 0
    return [
      s.client,
      s.author ? 'author' : '',
      s.project ? 'project' : '',
      count ? `${count} custom field${count === 1 ? '' : 's'}` : '',
    ]
      .filter(Boolean)
      .join(' · ')
  })

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
      saved.value = {
        client: details?.client ?? '',
        author: details?.author ?? '',
        project: details?.project ?? '',
        customFields: (details?.customFields ?? []).map(({ label, value }) => ({ label, value })),
      }
      named.value = { client: saved.value.client, author: saved.value.author, project: saved.value.project }
      rows.value = toRows(saved.value.customFields)
      const hasAny = suggested && (suggested.client || suggested.author || suggested.project || suggested.customFields)
      suggestion.value = hasAny ? suggested : null
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
      await setReportDetails(analysisId, changes.value)
      saving.value = false
      emit('saved')
      close()
    } catch (error) {
      saving.value = false
      saveError.value = saveErrorMessage(error)
    }
  }

  const addRow = () => {
    if (rows.value.length < CUSTOM_FIELDS_MAX) rows.value.push({ id: nextRowId++, label: '', value: '' })
  }
  const leaveRow = (id: number, focused: boolean) => {
    if (!focused) leftRows.value = new Set(leftRows.value).add(id)
  }
  const shownError = (row: Row, index: number, part: 'label' | 'value') =>
    (leftRows.value.has(row.id) && rowErrors.value[index]?.[part]) || undefined
  const removeRow = (index: number) => {
    rows.value.splice(index, 1)
  }

  const useSuggestion = () => {
    const s = suggestion.value
    if (!s) return
    named.value = { client: s.client ?? '', author: s.author ?? '', project: s.project ?? '' }
    rows.value = toRows(s.customFields?.slice(0, CUSTOM_FIELDS_MAX))
  }

  const counterValue = (value: string) => codePointLength(String(value ?? '').trim())

  load()
</script>

<template>
  <!-- eslint-disable vue/attribute-hyphenation -->
  <v-dialog
    v-model="show"
    attach="body"
    max-width="720px"
    :persistent="saving"
    scrollable
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
        <div v-if="offerSuggestion" class="report-details-suggestion mb-4 d-flex align-center flex-wrap ga-2">
          <span class="text-medium-emphasis">From another analysis of the same element:</span>
          <span class="report-details-suggestion-summary">{{ suggestionSummary }}</span>
          <v-btn size="small" variant="tonal" @click="useSuggestion">Use these details</v-btn>
        </div>
        <v-text-field
          v-for="field in NAMED"
          :key="field.key"
          v-model="named[field.key]"
          :class="['mb-2', `report-details-${field.key}`]"
          :counter="field.max"
          :counter-value="counterValue"
          :disabled="loading || !!loadError"
          :hint="field.hint"
          :label="field.label"
          :loading="loading"
          persistent-hint
          :rules="[lengthRule(field.max)]"
          variant="outlined"
          @keydown.enter="save"
        />
        <div class="text-subtitle-2 mt-4 mb-1">Custom fields</div>
        <div v-for="(row, index) in rows" :key="row.id" class="report-details-row d-flex align-start ga-2">
          <v-text-field
            v-model="row.label"
            class="report-details-label flex-grow-0"
            :counter="FIELD_LABEL_MAX"
            :counter-value="counterValue"
            density="compact"
            :disabled="loading || !!loadError"
            :aria-label="`Label of field ${index + 1}`"
            :error-messages="shownError(row, index, 'label')"
            label="Label"
            :rules="[lengthRule(FIELD_LABEL_MAX)]"
            style="width: 34%"
            variant="outlined"
            @update:focused="leaveRow(row.id, $event)"
          />
          <v-text-field
            v-model="row.value"
            class="report-details-value"
            :counter="FIELD_VALUE_MAX"
            :counter-value="counterValue"
            density="compact"
            :disabled="loading || !!loadError"
            :aria-label="`Value of field ${index + 1}`"
            :error-messages="shownError(row, index, 'value')"
            label="Value"
            :rules="[lengthRule(FIELD_VALUE_MAX)]"
            variant="outlined"
            @update:focused="leaveRow(row.id, $event)"
          />
          <v-btn
            :aria-label="`Remove field ${index + 1}`"
            class="report-details-remove mt-1"
            :disabled="loading || !!loadError"
            icon="mdi-close"
            size="small"
            variant="text"
            @click="removeRow(index)"
          />
        </div>
        <v-btn
          class="report-details-add"
          :disabled="loading || !!loadError || rows.length >= CUSTOM_FIELDS_MAX"
          prepend-icon="mdi-plus"
          size="small"
          variant="text"
          @click="addRow"
        >Add field</v-btn>
        <div class="text-caption text-medium-emphasis mt-1">Printed on the report's cover in a Report details block.</div>
        <v-alert
          v-if="tooLarge"
          class="mt-4 report-details-total"
          type="warning"
          variant="tonal"
          text="The report details are too long in total; shorten some fields."
        />
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
