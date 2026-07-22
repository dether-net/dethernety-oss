<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { useFlowStore } from '@/stores/flowStore'
  import { useTechniqueSuggestionsStore } from '@/stores/techniqueSuggestionsStore'
  import { Exposure } from '@dethernety/dt-core'
  import TechniquePicker from '@/components/Mitre/TechniquePicker/TechniquePicker.vue'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'

  /**
   * Technique selection uses the TechniquePicker family.
   *
   * Dirty tracking mirrors ControlDialog: snapshot initialState on load,
   * compare against current state for isDirty, gate close on confirm.
   *
   * mitreId ↔ internalId conversion: picker stores mitreIds (what the user sees).
   * Backend's `connect.where.node.id` expects the internal graph UUID.
   * - On load, we map exposure.exploitedBy (has both .id and .attack_id) → mitreIds.
   * - On save, we map picker mitreIds → internalIds via the
   *   techniqueSuggestionsStore catalog (hydrated by the picker on mount).
   */

  interface Props {
    elementId: string | undefined
    exposureId: string | undefined
    showDialog: boolean
    action: 'create' | 'edit'
  }

  const props = defineProps<Props>()
  const elementId = ref(props.elementId)
  const exposureId = ref(props.exposureId)
  const showDialog = ref(props.showDialog)
  const snackBar = ref({
    show: false,
    color: 'success',
    message: '',
  })
  const emit = defineEmits(['update:showDialog', 'update:elementId', 'update:exposureCreated', 'update:exposureUpdated'])
  const flowStore = useFlowStore()
  const techniqueStore = useTechniqueSuggestionsStore()
  const tab = ref('information')
  const exposure = ref<Exposure>({
    id: '',
    name: '',
    description: '',
    type: '',
    category: '',
    score: 0,
  })

  const selectedTechniqueMitreIds = ref<string[]>([])

  // Picker ref for the "Suggest matches" link below.
  const techniquePickerRef = ref<{ seedSearch: (text: string) => Promise<void> } | null>(null)

  // Implicit query for the Suggest link: description only, whitespace-
  // normalised. We DON'T include name — nomic-embed-text weights both leading
  // and trailing tokens heavily, and an arbitrary user-typed name shifts the
  // embedding centroid below the similarity threshold. Junk like "asdasd" in
  // the name field broke recommendations entirely even when the description
  // was a clean MITRE description verbatim. Description is the required field
  // and carries the semantic content; real names duplicate description content
  // anyway. Threshold 20 chars (dialog-side UX gate, separate from the
  // picker's 4-char vector-eligibility gate).
  const suggestQuery = computed<string>(() =>
    (exposure.value.description ?? '').replace(/\s+/g, ' ').trim(),
  )
  const suggestEnabled = computed<boolean>(() => suggestQuery.value.length >= 20)
  // Loading state for the Suggest button so a slow vector round-trip doesn't
  // look like a dead click.
  const isSuggesting = ref(false)
  async function onSuggestMatches(): Promise<void> {
    if (!suggestEnabled.value) return
    isSuggesting.value = true
    try {
      await techniquePickerRef.value?.seedSearch(suggestQuery.value)
    } finally {
      isSuggesting.value = false
    }
  }

  // Dirty tracking — initialState snapshot captured on load + refreshed after save.
  const initialState = ref<{ name: string; description: string; score: number; techniqueMitreIds: string[] }>({
    name: '',
    description: '',
    score: 0,
    techniqueMitreIds: [],
  })

  const setEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every(x => b.includes(x))

  const isDirty = computed(() =>
    exposure.value.name !== initialState.value.name ||
    (exposure.value.description ?? '') !== initialState.value.description ||
    (exposure.value.score ?? 0) !== initialState.value.score ||
    !setEqual(selectedTechniqueMitreIds.value, initialState.value.techniqueMitreIds),
  )

  const showDiscardChangesDialog = ref(false)

  function mitreIdsToInternalIds(mitreIds: string[]): string[] | null {
    const catalog = techniqueStore.catalog.get('ATTACK_TECHNIQUE') ?? []
    const lookup = new Map(catalog.map(e => [e.mitreId, e.internalId]))
    const out: string[] = []
    for (const m of mitreIds) {
      const internal = lookup.get(m)
      if (!internal) return null
      out.push(internal)
    }
    return out
  }

  watch(showDialog, newVal => {
    emit('update:showDialog', newVal)
  })

  watch(elementId, newVal => {
    emit('update:elementId', newVal)
  })

  const closeDialog = () => {
    emit('update:showDialog', false)
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

  function snapshotInitialState(): void {
    initialState.value = {
      name: exposure.value.name ?? '',
      description: exposure.value.description ?? '',
      score: exposure.value.score ?? 0,
      techniqueMitreIds: [...selectedTechniqueMitreIds.value],
    }
  }

  const loadExposure = async () => {
    if (exposureId.value) {
      const response = await flowStore.getExposure({ exposureId: exposureId.value })
      exposure.value = response
      selectedTechniqueMitreIds.value = (response.exploitedBy || []).map(t => t.attack_id)
      snapshotInitialState()
    }
  }

  watch(exposureId, newVal => {
    if (newVal) {
      loadExposure()
    }
  })

  const saveExposure = async () => {
    if (elementId.value) {
      // Guarantee the ATTACK_TECHNIQUE catalog is hydrated before mapping mitreIds→internalIds.
      // hydrateCatalog is idempotent (early-returns once ready), so this is a cheap no-op after
      // the picker (or a prior save) has hydrated it — and the only thing that makes the map
      // reliable when the user edited an exposure with existing techniques without ever opening
      // the (lazily-mounted) techniques tab. The null-guard below now fires only on a genuine
      // hydration failure, not the "loading forever" case.
      await techniqueStore.hydrateCatalog('ATTACK_TECHNIQUE')
      const attackTechniqueIds = mitreIdsToInternalIds(selectedTechniqueMitreIds.value)
      if (attackTechniqueIds === null) {
        snackBar.value.show = true
        snackBar.value.color = 'warning'
        snackBar.value.message = 'Technique catalog is still loading — please try again in a moment.'
        return
      }
      if (props.action === 'create') {
        flowStore.createExposure({
          exposure: exposure.value,
          elementId: elementId.value,
          attackTechniqueIds,
        }).then(response => {
          if (response) {
            snackBar.value.show = true
            snackBar.value.color = 'success'
            snackBar.value.message = 'Exposure created successfully'
            snapshotInitialState()
            emit('update:exposureCreated', response)
            closeDialog()
          } else {
            snackBar.value.show = true
            snackBar.value.color = 'error'
            snackBar.value.message = 'Failed to create exposure'
          }
        })
      } else {
        if (exposureId.value) {
          flowStore.updateExposure({
            exposureId: exposureId.value,
            exposure: exposure.value,
            attackTechniqueIds,
          }).then(response => {
            if (response) {
              snackBar.value.show = true
              snackBar.value.color = 'success'
              snackBar.value.message = 'Exposure updated successfully'
              snapshotInitialState()
              emit('update:exposureUpdated', response)
              closeDialog()
            } else {
              snackBar.value.show = true
              snackBar.value.color = 'error'
              snackBar.value.message = 'Failed to update exposure'
            }
          })
        }
      }
    }
  }

  if (props.action === 'edit' && exposureId.value) {
    loadExposure()
  } else if (props.action === 'create') {
    // create flow starts with an empty exposure — snapshot the empty state so
    // typing anything flips the dirty bit.
    snapshotInitialState()
  }

  // Test seam — expose the save/dirty internals asserted by ExposureDialog.test.ts
  // (catalog-hydration-before-save, score dirty tracking).
  defineExpose({
    saveExposure, isDirty, exposure, selectedTechniqueMitreIds, snapshotInitialState, initialState,
  })
</script>

<template>
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <v-dialog
    v-model="showDialog"
    fluid
    width="60vw"
    :persistent="isDirty"
    @click:outside="onAttemptClose"
    @keydown.esc="onAttemptClose"
  >
    <v-form @submit.prevent="saveExposure">
      <v-card>
        <v-card-title class="pa-0">
          <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
            <div>
              <v-icon color="tertiary" size="small">mdi-bug-outline</v-icon>
              <span class="ml-2 text-body-1">{{ action === 'create' ? 'New exposure' : 'Edit exposure' }}</span>
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
              <v-col cols="12">
                <v-row>
                  <v-col cols="3">
                    <v-tabs v-model="tab" direction="vertical">
                      <v-tab prepend-icon="mdi-information-outline" text="Information" value="information" />
                      <v-tab prepend-icon="mdi-fencing" text="Techniques" value="attack-techniques" />
                    </v-tabs>
                  </v-col>
                  <v-col class="pa-1 px-6 elevation-1 rounded-lg" cols="9">
                    <v-tabs-window v-model="tab" class="settings-window">
                      <v-tabs-window-item value="information">
                        <v-container>
                          <v-row>
                            <v-col cols="6">
                              <v-text-field v-model="exposure.name" label="Name" />
                            </v-col>
                            <v-col cols="6">
                              <v-text-field v-model.number="exposure.score" label="Score" type="number" />
                            </v-col>
                          </v-row>
                          <v-row>
                            <v-col cols="12">
                              <v-textarea v-model="exposure.description" label="Description" />
                            </v-col>
                          </v-row>
                        </v-container>
                      </v-tabs-window-item>
                      <v-tabs-window-item value="attack-techniques">
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
                                    :loading="isSuggesting"
                                    prepend-icon="mdi-creation"
                                    size="small"
                                    variant="text"
                                    @click="onSuggestMatches"
                                  >Suggest matches</v-btn>
                                </span>
                              </template>
                            </v-tooltip>
                          </div>
                          <TechniquePicker
                            ref="techniquePickerRef"
                            v-model="selectedTechniqueMitreIds"
                            kind="ATTACK_TECHNIQUE"
                            :model-id="flowStore.modelId"
                          />
                        </v-container>
                      </v-tabs-window-item>
                    </v-tabs-window>
                  </v-col>
                </v-row>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>
        <v-card-actions class="py-6 mx-6 d-flex justify-end">
          <v-btn
            color="secondary"
            :disabled="action === 'edit' && !isDirty"
            icon="mdi-content-save"
            size="x-large"
            variant="outlined"
            @click="saveExposure"
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
  <v-snackbar
    v-model="snackBar.show"
    :color="snackBar.color"
    timeout="5000"
    top
  >
    {{ snackBar.message }}
  </v-snackbar>
</template>

<style scoped>
  .settings-window {
    height: 40vh;
    min-height: 400px;
  }

  .techniques-container {
    height: 30vh;
    min-height: 300px;
    overflow-y: auto;
  }
</style>
