<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { useControlsStore } from '@/stores/controlsStore'
  import { useFlowStore } from '@/stores/flowStore'
  import { useTechniqueSuggestionsStore } from '@/stores/techniqueSuggestionsStore'
  import { Countermeasure, type MitreKind } from '@dethernety/dt-core'
  import TechniquePicker from '@/components/Mitre/TechniquePicker/TechniquePicker.vue'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'

  /**
   * Both tactic-tab blocks (D3FEND techniques + ATT&CK mitigations) are
   * replaced with TechniquePicker instances.
   *
   * The picker hides the tactic-facet chips when `kind === 'ATTACK_MITIGATION'`
   * and renders an invisible spacer in the results' tactic column to preserve
   * column rhythm across the two tabs.
   *
   * mitreId ↔ internalId conversion: same pattern as ExposureDialog.
   * picker emits mitreId; backend connect expects internal UUID. Catalog lookup
   * via techniqueSuggestionsStore.
   *
   * Dead code removed:
   *   - mitigations data table + searchMitigation filter
   *   - D3FEND nested tactic/technique/subtechnique tabs + checkboxes
   *   - updateSelectedTechniques, sortedTechniques, getSortedSubTechniques,
   *     filteredMitigations, loadMitreDefendTechniques, subTechniqueTab,
   *     defendTacticTab refs
   */

  interface Props {
    showDialog: boolean
    controlId: string
    action: 'create' | 'update'
    countermeasureId: string | null
  }

  const props = defineProps<Props>()
  const showDialog = ref(props.showDialog)
  const countermeasureId = ref(props.countermeasureId)
  const action = ref(props.action)

  const tab = ref('information')
  const controlId = ref(props.controlId)
  const controlsStore = useControlsStore()
  const flowStore = useFlowStore()
  const techniqueStore = useTechniqueSuggestionsStore()
  const form = ref<HTMLFormElement | null>(null)

  const nameRules = [
    (v: string) => !!v || 'Name is required',
    (v: string) => v.length <= 100 || 'Name must be less than 100 characters',
    (v: string) => v.length >= 3 || 'Name must be at least 3 characters',
  ]

  const scoreRules = [
    (v: string | number) =>
      v === '' || v === null || Number.isFinite(Number(v)) || 'Score must be a number',
  ]

  // Picker-bound mitreIds. Source of truth converted on save.
  const selectedMitigationMitreIds = ref<string[]>([])
  const selectedDefendTechniqueMitreIds = ref<string[]>([])

  // Picker refs for the "Suggest matches" links below.
  const mitigationPickerRef = ref<{ seedSearch: (text: string) => Promise<void> } | null>(null)
  const defendPickerRef = ref<{ seedSearch: (text: string) => Promise<void> } | null>(null)

  const countermeasure = ref<Countermeasure>({
    name: '',
    description: '',
    type: '',
    category: '',
    score: 0,
    id: '',
    references: '',
    addressedExposures: [],
    tags: [],
    mitigations: [],
    defendedTechniques: [],
    control: {
      id: '',
      name: '',
      description: '',
    },
  })

  const emit = defineEmits(['close', 'countermeasure:updated', 'countermeasure:created', 'countermeasure:failed'])

  // Dirty tracking — initialState snapshot captured on load + refreshed after save.
  // Mirrors ControlDialog's pattern. We snapshot the full picker arrays + the
  // information-tab scalar fields so unsaved-changes warnings cover both tabs.
  const initialState = ref<{
    name: string
    description: string
    type: string
    score: number
    mitigationMitreIds: string[]
    defendTechniqueMitreIds: string[]
  }>({
    name: '',
    description: '',
    type: '',
    score: 0,
    mitigationMitreIds: [],
    defendTechniqueMitreIds: [],
  })

  const setEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every(x => b.includes(x))

  const isDirty = computed(() =>
    (countermeasure.value.name ?? '') !== initialState.value.name
    || (countermeasure.value.description ?? '') !== initialState.value.description
    || (countermeasure.value.type ?? '') !== initialState.value.type
    || Number(countermeasure.value.score ?? 0) !== initialState.value.score
    || !setEqual(selectedMitigationMitreIds.value, initialState.value.mitigationMitreIds)
    || !setEqual(selectedDefendTechniqueMitreIds.value, initialState.value.defendTechniqueMitreIds),
  )

  const showDiscardChangesDialog = ref(false)

  function snapshotInitialState(): void {
    initialState.value = {
      name: countermeasure.value.name ?? '',
      description: countermeasure.value.description ?? '',
      type: countermeasure.value.type ?? '',
      score: Number(countermeasure.value.score ?? 0),
      mitigationMitreIds: [...selectedMitigationMitreIds.value],
      defendTechniqueMitreIds: [...selectedDefendTechniqueMitreIds.value],
    }
  }

  // Implicit query for the two Suggest links: description only, whitespace-
  // normalised. We DON'T include name — nomic-embed-text weights both leading
  // and trailing tokens heavily, and an arbitrary user-typed name shifts the
  // embedding centroid below the similarity threshold. Description is the
  // required field and carries the semantic content; real names duplicate
  // description content anyway. Both pickers seed from the SAME query — the
  // user picks the right tab for their intent. 20-char threshold is a dialog-
  // side UX gate, separate from the picker's 4-char vector-eligibility gate.
  const suggestQuery = computed<string>(() =>
    (countermeasure.value.description ?? '').replace(/\s+/g, ' ').trim(),
  )
  const suggestEnabled = computed<boolean>(() => suggestQuery.value.length >= 20)
  // Per-button loading state so a slow vector round-trip doesn't look like a
  // dead click.
  const isSuggestingMitigations = ref(false)
  const isSuggestingDefend = ref(false)
  async function onSuggestMitigations(): Promise<void> {
    if (!suggestEnabled.value) return
    isSuggestingMitigations.value = true
    try {
      await mitigationPickerRef.value?.seedSearch(suggestQuery.value)
    } finally {
      isSuggestingMitigations.value = false
    }
  }
  async function onSuggestDefend(): Promise<void> {
    if (!suggestEnabled.value) return
    isSuggestingDefend.value = true
    try {
      await defendPickerRef.value?.seedSearch(suggestQuery.value)
    } finally {
      isSuggestingDefend.value = false
    }
  }

  watch(showDialog, newVal => {
    emit('close', newVal)
  })

  const closeDialog = () => {
    showDialog.value = false
    emit('close')
  }

  const onAttemptClose = () => {
    if (isDirty.value) {
      showDiscardChangesDialog.value = true
    } else {
      closeDialog()
    }
  }

  const onDiscardConfirmed = () => {
    showDiscardChangesDialog.value = false
    closeDialog()
  }

  const onDiscardCanceled = () => {
    showDiscardChangesDialog.value = false
  }

  const loadCountermeasure = async () => {
    if (countermeasureId.value) {
      const response = await controlsStore.getCountermeasure({ countermeasureId: countermeasureId.value })
      if (response) {
        countermeasure.value = JSON.parse(JSON.stringify(response))
        // Convert internal id → mitreId for picker v-model.
        selectedMitigationMitreIds.value = (response.mitigations ?? []).map(m => m.attack_id)
        selectedDefendTechniqueMitreIds.value = (response.defendedTechniques ?? []).map(t => t.d3fendId)
        snapshotInitialState()
      }
    } else {
      // Create flow — snapshot the empty defaults so typing flips isDirty.
      snapshotInitialState()
    }
  }

  watch(countermeasureId, newVal => {
    if (newVal) {
      loadCountermeasure()
    }
  })

  // Convert picker mitreIds → backend connect-shape (Mitigation / Technique
  // objects with internal id only). Catalog lookup may miss if not yet hydrated
  // — the save handler surfaces that to the user.
  function mitreIdsToInternalLookup(kind: MitreKind, mitreIds: string[]): Array<{ id: string }> | null {
    const catalog = techniqueStore.catalog.get(kind) ?? []
    const map = new Map(catalog.map(e => [e.mitreId, e.internalId]))
    const out: Array<{ id: string }> = []
    for (const m of mitreIds) {
      const internal = map.get(m)
      if (!internal) return null
      out.push({ id: internal })
    }
    return out
  }

  // Inline snackbar for catalog-not-ready warning.
  const snackBar = ref({ show: false, color: 'warning', message: '' })

  // Re-entrancy guard. The save v-btn used to declare both `type="submit"`
  // and `@click="onSubmit"`, so a single click fired onSubmit twice — the
  // button handler ran, the form's submit event then re-entered. With the
  // dialog's `:persistent` flag the duplicate invocation became more visible
  // because both calls awaited the same mutex and the second one's terminal
  // `.then` ran against state the first had already mutated. We now drop the
  // redundant click handler in the template AND guard re-entry here.
  const isSubmitting = ref(false)

  const onSubmit = async () => {
    if (isSubmitting.value) return
    if (!form.value) return
    const { valid } = await form.value.validate()
    if (!valid) {
      snackBar.value = {
        show: true, color: 'warning',
        message: 'Please fix the highlighted fields before saving.',
      }
      return
    }

    const mitigationConnects = mitreIdsToInternalLookup('ATTACK_MITIGATION', selectedMitigationMitreIds.value)
    const defendConnects = mitreIdsToInternalLookup('DEFEND_TECHNIQUE', selectedDefendTechniqueMitreIds.value)
    if (mitigationConnects === null || defendConnects === null) {
      snackBar.value = {
        show: true, color: 'warning',
        message: 'Technique catalog is still loading — please try again in a moment.',
      }
      return
    }

    // Backend expects `mitigations: MitreAttackMitigation[]` and
    // `defendedTechniques: MitreDefendTechnique[]` — but only `.id` is read by
    // the connect builder. Synthesize minimal stubs.
    countermeasure.value.mitigations = mitigationConnects as any
    countermeasure.value.defendedTechniques = defendConnects as any

    isSubmitting.value = true
    try {
      if (action.value === 'create') {
        const response = await controlsStore.createCountermeasure({
          controlId: controlId.value,
          countermeasure: countermeasure.value,
        })
        if (response) {
          snapshotInitialState()
          emit('countermeasure:created')
          showDialog.value = false
        } else {
          snackBar.value = { show: true, color: 'error', message: 'Failed to create countermeasure.' }
          emit('countermeasure:failed')
        }
      } else if (action.value === 'update') {
        const response = await controlsStore.updateCountermeasure({
          countermeasureId: countermeasure.value.id,
          countermeasure: countermeasure.value,
        })
        if (response) {
          snapshotInitialState()
          emit('countermeasure:updated')
          showDialog.value = false
        } else {
          snackBar.value = { show: true, color: 'error', message: 'Failed to update countermeasure.' }
          emit('countermeasure:failed')
        }
      }
    } catch (err) {
      // Surface previously-silent mutation errors. The dt-core layer rethrows
      // GraphQL / network errors after retry exhaustion; without this catch
      // the .then never fires and the save appears to do nothing.
      console.error('[CounterMeasureDialog] save failed', err)
      snackBar.value = {
        show: true, color: 'error',
        message: err instanceof Error ? err.message : 'Save failed — see console for details.',
      }
      emit('countermeasure:failed')
    } finally {
      isSubmitting.value = false
    }
  }

  loadCountermeasure()
</script>

<template>
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <v-dialog
    v-model="showDialog"
    fluid
    width="80vw"
    :persistent="isDirty"
    @click:outside="onAttemptClose"
    @keydown.esc="onAttemptClose"
  >
    <v-form ref="form" @submit.prevent="onSubmit">
      <v-card>
        <v-card-title class="pa-0">
          <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
            <div>
              <v-icon color="tertiary" size="small">mdi-shield-star-outline</v-icon>
              <span class="ml-2 text-body-1">{{ action === 'create' ? 'Add Countermeasure' : 'Update Countermeasure' }}</span>
            </div>
            <v-btn
              color="foreground"
              icon="mdi-close"
              size="medium"
              variant="text"
              @click="onAttemptClose"
            />
          </v-sheet>
        </v-card-title>
        <v-card-text>
          <v-container fluid>
            <v-row>
              <v-col cols="3">
                <v-tabs v-model="tab" direction="vertical">
                  <v-tab prepend-icon="mdi-information-outline" text="Information" value="information" />
                  <v-tab prepend-icon="mdi-shield-star-outline" text="ATT&CK Mitigations" value="mitigations" />
                  <v-tab prepend-icon="mdi-shield-sun-outline" text="D3FEND Techniques" value="defend-techniques" />
                </v-tabs>
              </v-col>
              <v-col class="pa-1 px-6 elevation-11 border-thin rounded-lg" cols="9">
                <v-container class="content-container">
                  <v-tabs-window v-model="tab" class="settings-window">
                    <v-tabs-window-item value="information">
                      <v-container>
                        <v-row>
                          <v-col cols="5">
                            <v-text-field v-model="countermeasure.name" label="Name" required :rules="nameRules" />
                          </v-col>
                          <v-col cols="3">
                            <v-text-field
                              :model-value="countermeasure.score"
                              label="Score"
                              required
                              :rules="scoreRules"
                              type="number"
                              @update:model-value="v => countermeasure.score = v === '' || v === null ? 0 : Number(v)"
                            />
                          </v-col>
                          <v-col cols="4">
                            <v-text-field v-model="countermeasure.type" label="Type" required />
                          </v-col>
                        </v-row>
                        <v-row>
                          <v-col cols="12">
                            <v-textarea v-model="countermeasure.description" label="Description" required />
                          </v-col>
                        </v-row>
                      </v-container>
                    </v-tabs-window-item>
                    <v-tabs-window-item value="mitigations">
                      <v-container class="techniques-container">
                        <div class="d-flex justify-end mb-1">
                          <v-tooltip
                            :disabled="suggestEnabled"
                            location="top"
                            text="Add a description (20+ characters) to suggest matches"
                          >
                            <template #activator="{ props: tipProps }">
                              <span v-bind="tipProps">
                                <v-btn
                                  :disabled="!suggestEnabled"
                                  :loading="isSuggestingMitigations"
                                  prepend-icon="mdi-creation"
                                  size="small"
                                  variant="text"
                                  @click="onSuggestMitigations"
                                >Suggest matches</v-btn>
                              </span>
                            </template>
                          </v-tooltip>
                        </div>
                        <TechniquePicker
                          ref="mitigationPickerRef"
                          v-model="selectedMitigationMitreIds"
                          kind="ATTACK_MITIGATION"
                          :model-id="flowStore.modelId"
                        />
                      </v-container>
                    </v-tabs-window-item>
                    <v-tabs-window-item value="defend-techniques">
                      <v-container class="techniques-container">
                        <div class="d-flex justify-end mb-1">
                          <v-tooltip
                            :disabled="suggestEnabled"
                            location="top"
                            text="Add a description (20+ characters) to suggest matches"
                          >
                            <template #activator="{ props: tipProps }">
                              <span v-bind="tipProps">
                                <v-btn
                                  :disabled="!suggestEnabled"
                                  :loading="isSuggestingDefend"
                                  prepend-icon="mdi-creation"
                                  size="small"
                                  variant="text"
                                  @click="onSuggestDefend"
                                >Suggest matches</v-btn>
                              </span>
                            </template>
                          </v-tooltip>
                        </div>
                        <TechniquePicker
                          ref="defendPickerRef"
                          v-model="selectedDefendTechniqueMitreIds"
                          kind="DEFEND_TECHNIQUE"
                          :model-id="flowStore.modelId"
                        />
                      </v-container>
                    </v-tabs-window-item>
                  </v-tabs-window>
                </v-container>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>
        <v-card-actions class="pr-6 py-3 pb-5 ma-0">
          <v-btn
            class="mx-1"
            color="secondary"
            :disabled="(action === 'update' && !isDirty) || isSubmitting"
            :loading="isSubmitting"
            icon="mdi-content-save-all-outline"
            size="x-large"
            type="submit"
            variant="outlined"
          />
        </v-card-actions>
      </v-card>
    </v-form>
    <ConfirmDeleteDialog
      v-if="showDiscardChangesDialog"
      confirmColor="warning"
      confirmIcon="mdi-close-circle-outline"
      icon="mdi-pencil-off-outline"
      message="You have unsaved changes. Are you sure you want to discard them?"
      :show="showDiscardChangesDialog"
      title="Discard unsaved changes?"
      @delete:canceled="onDiscardCanceled"
      @delete:confirmed="onDiscardConfirmed"
    />
  </v-dialog>
  <v-snackbar v-model="snackBar.show" :color="snackBar.color" timeout="5000" top>
    {{ snackBar.message }}
  </v-snackbar>
</template>

<style scoped>
  .content-container {
    height: 60vh;
  }
  .techniques-container {
    height: 50vh;
    min-height: 300px;
    overflow-y: auto;
  }
</style>
