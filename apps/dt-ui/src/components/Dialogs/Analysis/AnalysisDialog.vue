<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { useAnalysisStore } from '@/stores/analysisStore'
  import { Analysis } from '@dethernety/dt-core'
  import {
    phaseOf,
    PHASE_LABELS,
    PHASE_COLOR,
    PHASE_PRIMARY,
    phaseShowsBadge,
    phaseShowsDelete,
    phaseShowsRerun,
    errorReason,
  } from '@/utils/analysisPhase'

  import { useRouter } from 'vue-router'
  import { useDate } from 'vuetify'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'
  import AnalysisFlowDialog from '@/components/Dialogs/Analysis/AnalysisFlowDialog.vue'

  interface Props {
    modelId: string
  }
  const props = defineProps<Props>()
  // Announced when the user leaves for an analysis's results. A host that floats
  // this list over the results page (ModelAnalysisDialog) has to dismiss itself —
  // the route watcher there cannot stand in, because re-selecting the analysis
  // already on screen pushes an identical query and never fires.
  const emit = defineEmits(['results:opened'])
  const showDeleteAnalysisDialog = ref<boolean>(false)
  const showAnalysisFlowDialog = ref<boolean>(false)
  const analysisIdToDelete = ref<string | undefined>(undefined)
  const analysisIdToShow = ref<string | undefined>(undefined)
  const analysisStore = useAnalysisStore()
  const router = useRouter()
  const fetchTimer = ref<ReturnType<typeof setInterval> | null>(null)
  const date = useDate()

  analysisStore.fetchAnalyses({ elementId: props.modelId })

  onMounted(() => {
    fetchTimer.value = setInterval(() => {
      analysisStore.fetchAnalyses({ elementId: props.modelId })
    }, 5000)
  })

  onBeforeUnmount(() => {
    if (fetchTimer.value) {
      clearInterval(fetchTimer.value)
    }
  })

  const headers = [
    { title: 'Name', key: 'name' },
    { title: 'Created At', key: 'createdAt' },
    { title: 'Updated At', key: 'updatedAt' },
    { title: 'Status', key: 'status' },
    { title: '', key: 'actions' },
  ]

  const analysisClasses = computed(() => analysisStore.analysisClasses)

  // Show a spinner only on the first load (empty table); subsequent 5s polls
  // refresh in place without flashing the indicator.
  const isInitialLoading = computed(
    () => analysisStore.loadingStates.fetchingAnalyses && analysisStore.analyses.length === 0,
  )

  // Track which item is being edited
  const editingNameItem = ref<string | null>(null)
  const editingDescriptionItem = ref<string | null>(null)
  const editedName = ref<string>('')
  const editedDescription = ref<string>('')
  // Controlled row expansion (item-value = id), so the overflow "Edit description"
  // can expand the row and focus the description editor in one step.
  const expanded = ref<string[]>([])

  const startEditingName = (item: Analysis) => {
    editingNameItem.value = item.id || null
    editingDescriptionItem.value = null
    editedName.value = item.name || ''
    editedDescription.value = item.description || ''
  }

  const startEditingDescription = (item: Analysis) => {
    editingDescriptionItem.value = item.id || null
    editingNameItem.value = null
    editedName.value = item.name || ''
    editedDescription.value = item.description || ''
  }

  // Overflow "Edit description": ensure the row is expanded, then open its editor.
  const openDescriptionEditor = (item: Analysis) => {
    if (item.id && !expanded.value.includes(item.id)) {
      expanded.value = [...expanded.value, item.id]
    }
    startEditingDescription(item)
  }

  const finishEditingName = (item: Analysis) => {
    if (!editingNameItem.value) return
    // Create a copy to avoid mutating props
    const updatedAnalysis = { ...item, name: editedName.value, description: item.description }
    updateAnalysis(updatedAnalysis)
    editingNameItem.value = null
  }

  const finishEditingDescription = (item: Analysis) => {
    if (!editingDescriptionItem.value) return
    // Create a copy to avoid mutating props
    const updatedAnalysis = { ...item, name: item.name, description: editedDescription.value }
    updateAnalysis(updatedAnalysis)
    editingDescriptionItem.value = null
  }

  const createAnalysis = (analysisClassId: string) => {
    const analysisClass = analysisClasses.value.find(c => c.id === analysisClassId)
    analysisStore.createAnalysis({
      name: analysisClass?.name || 'New Analysis',
      description: analysisClass?.name || 'New Analysis',
      type: analysisClass?.type || '',
      category: analysisClass?.category || '',
      elementId: props.modelId,
      analysisClassId,
    })
  }

  const deleteAnalysis = (analysisId: string | undefined) => {
    if (!analysisId) return
    analysisStore.deleteAnalysis({ analysisId })
    showDeleteAnalysisDialog.value = false
    analysisIdToDelete.value = undefined
  }

  // Optimistic on-click feedback for the mutating primaries (Run/Retry):
  // the button disables immediately on click instead of waiting for the 5s poll,
  // so a user cannot double-click into a double-run. Local + bounded — pruned by
  // the watcher below once the poll shows the run started, and on submit failure.
  const pendingRun = ref<Set<string>>(new Set())
  const isPending = (id: string | undefined): boolean => !!id && pendingRun.value.has(id)
  const removePending = (id: string) => {
    if (!pendingRun.value.has(id)) return
    const next = new Set(pendingRun.value)
    next.delete(id)
    pendingRun.value = next
  }

  // Run/Retry (and the overflow Re-run). Decoupled from opening the flow dialog:
  // the row transitions to Working on the next poll; the user opens the flow
  // themselves via "View progress" if they want to watch.
  const triggerRun = (analysisId: string | undefined) => {
    if (!analysisId) return
    pendingRun.value = new Set(pendingRun.value).add(analysisId)
    analysisStore.runAnalysis({ analysisId }).catch(() => removePending(analysisId))
    // Safety net: self-heal the optimistic flag if the backend never reports a
    // phase change (e.g. a Retry that re-fails without ever passing through
    // Working), so the button can't spin forever. The watcher below clears it
    // sooner on the normal path; removePending is idempotent.
    setTimeout(() => removePending(analysisId), 15000)
  }

  // Clear the optimistic flag once the backend reports the run is no longer
  // Ready/Failed (i.e. it actually started or finished). Also prevents stale
  // membership from disabling a future Retry on a row that ran earlier.
  watch(() => analysisStore.analyses, list => {
    if (pendingRun.value.size === 0) return
    const next = new Set(pendingRun.value)
    let changed = false
    for (const id of pendingRun.value) {
      const found = list.find(a => a.id === id)
      const phase = found ? phaseOf(found.status) : undefined
      if (!found || (phase !== 'ready' && phase !== 'failed')) {
        next.delete(id)
        changed = true
      }
    }
    if (changed) pendingRun.value = next
  })

  // The phase's primary button dispatches to the right handler.
  const onPrimary = (item: Analysis) => {
    const action = PHASE_PRIMARY[phaseOf(item.status)].action
    switch (action) {
      case 'run':
      case 'retry':
        triggerRun(item.id)
        break
      case 'viewProgress':
      case 'answer':
        openAnalysisFlow(item.id)
        break
      case 'viewResults':
        openResults(item.id)
        break
    }
  }

  const updateAnalysis = (analysis: Analysis) => {
    analysisStore.updateAnalysis({
      analysisId: analysis.id || '',
      name: analysis.name || '',
      description: analysis.description || '',
      type: analysis.type || '',
      category: analysis.category || '',
    })
  }

  const openResults = (id: string | undefined) => {
    if (!id) return
    router.push({ path: '/analysisresults', query: { id } })
    emit('results:opened')
  }

  const openAnalysisFlow = (id: string | undefined) => {
    if (!id) return
    analysisIdToShow.value = id
    showAnalysisFlowDialog.value = true
  }

  const closeAnalysisFlow = () => {
    showAnalysisFlowDialog.value = false
    analysisIdToShow.value = undefined
  }

</script>

<template>
  <!-- eslint-disable vue/no-template-shadow -->
  <!-- eslint-disable vue/no-lone-template -->
  <v-card>
    <v-container fluid>
      <v-row>
        <v-col cols="12">
          <v-sheet class="pa-2 opacity-90 border-thin rounded-lg elevation-11 mb-4">
            <v-data-table
              v-model:expanded="expanded"
              :headers="headers"
              item-value="id"
              :items="analysisStore.analyses"
              :loading="isInitialLoading"
              show-expand
            >
              <template #loading>
                <div class="d-flex flex-column align-center justify-center pa-8">
                  <v-progress-circular color="primary" indeterminate :size="48" :width="4" />
                  <span class="mt-3 text-medium-emphasis">Loading analyses…</span>
                </div>
              </template>
              <template #top>
                <v-menu>
                  <template #activator="{ props }">
                    <v-btn class="ma-3" prepend-icon="mdi-plus" width="200" v-bind="props">
                      New Analysis
                    </v-btn>
                  </template>
                  <v-list>
                    <v-list-item v-for="analysisClass in analysisClasses" :key="analysisClass.id">
                      <v-list-item-title>
                        <div>
                          <v-btn
                            color="secondary"
                            size="large"
                            variant="text"
                            @click="createAnalysis(analysisClass.id)"
                          >
                            {{ analysisClass.name }}
                          </v-btn>
                        </div>
                      </v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-menu>
              </template>
              <template #item.name="{ item }">
                <div @click.stop="startEditingName(item)">
                  <v-text-field
                    v-if="editingNameItem === item.id"
                    v-model="editedName"
                    autofocus
                    density="compact"
                    hide-details
                    min-width="500"
                    variant="outlined"
                    @blur="finishEditingName(item)"
                    @keyup.enter="finishEditingName(item)"
                  />
                  <span v-else>{{ item.name }}</span>
                </div>
              </template>
              <template #item.createdAt="{ item }">
                {{ date.format(item.status?.createdAt, 'fullDateTime24h') }}
              </template>
              <template #item.updatedAt="{ item }">
                {{ date.format(item.status?.updatedAt, 'fullDateTime24h') }}
              </template>
              <template #item.status="{ item }">
                <v-tooltip
                  v-if="phaseOf(item.status) === 'failed'"
                  location="top"
                  :text="errorReason(item.status)"
                >
                  <template #activator="{ props: tProps }">
                    <v-chip
                      v-bind="tProps"
                      color="error"
                      size="small"
                      variant="tonal"
                    >
                      {{ PHASE_LABELS.failed }}
                    </v-chip>
                  </template>
                </v-tooltip>
                <v-chip
                  v-else
                  :color="PHASE_COLOR[phaseOf(item.status)]"
                  size="small"
                  variant="tonal"
                >
                  {{ PHASE_LABELS[phaseOf(item.status)] }}
                </v-chip>
              </template>
              <template #item.actions="{ item }">
                <div class="d-flex justify-end align-center ga-2">
                  <!-- Primary: the phase's forward action. Mutating primaries
                       (Run/Retry) get optimistic on-click feedback; Paused
                       gets a dot badge. -->
                  <v-badge
                    color="warning"
                    dot
                    :model-value="phaseShowsBadge(phaseOf(item.status))"
                  >
                    <v-btn
                      :color="PHASE_PRIMARY[phaseOf(item.status)].mutate ? 'amber' : 'secondary'"
                      :disabled="PHASE_PRIMARY[phaseOf(item.status)].mutate && isPending(item.id)"
                      :loading="PHASE_PRIMARY[phaseOf(item.status)].mutate && isPending(item.id)"
                      :prepend-icon="PHASE_PRIMARY[phaseOf(item.status)].icon"
                      size="small"
                      :variant="PHASE_PRIMARY[phaseOf(item.status)].mutate ? 'flat' : 'text'"
                      @click="onPrimary(item)"
                    >
                      {{ PHASE_PRIMARY[phaseOf(item.status)].label }}
                    </v-btn>
                  </v-badge>

                  <!-- Secondary: Delete, only when nothing is in flight. -->
                  <v-tooltip
                    v-if="phaseShowsDelete(phaseOf(item.status))"
                    location="top"
                    text="Delete"
                  >
                    <template #activator="{ props: tProps }">
                      <v-btn
                        v-bind="tProps"
                        color="error"
                        icon="mdi-trash-can-outline"
                        size="small"
                        variant="text"
                        @click="analysisIdToDelete = item.id; showDeleteAnalysisDialog = true"
                      />
                    </template>
                  </v-tooltip>

                  <!-- Overflow: low-frequency actions. -->
                  <v-menu>
                    <template #activator="{ props: menuProps }">
                      <v-btn
                        v-bind="menuProps"
                        icon="mdi-dots-vertical"
                        size="small"
                        variant="text"
                      />
                    </template>
                    <v-list density="compact">
                      <v-list-item
                        v-if="phaseShowsRerun(phaseOf(item.status))"
                        prepend-icon="mdi-refresh"
                        title="Re-run"
                        @click="triggerRun(item.id)"
                      />
                      <v-list-item
                        prepend-icon="mdi-pencil-outline"
                        title="Rename"
                        @click="startEditingName(item)"
                      />
                      <v-list-item
                        prepend-icon="mdi-text-box-edit-outline"
                        title="Edit description"
                        @click="openDescriptionEditor(item)"
                      />
                    </v-list>
                  </v-menu>
                </div>
              </template>
              <template #item.data-table-expand="{ internalItem, isExpanded, toggleExpand }">
                <v-btn
                  :append-icon="isExpanded(internalItem) ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                  border
                  class="text-none"
                  color="medium-emphasis"
                  size="small"
                  slim
                  :text="isExpanded(internalItem) ? 'Collapse' : 'Description'"
                  variant="text"
                  @click="toggleExpand(internalItem)"
                />
              </template>
              <template #expanded-row="{ columns, item }">
                <td :colspan="columns.length">
                  <v-card class="description-card pa-2 border-thin">
                    <v-card-text>
                      <v-container fluid>
                        <v-row>
                          <v-col cols="12">
                            <div @click.stop="startEditingDescription(item)">
                              <v-textarea
                                v-if="editingDescriptionItem === item.id"
                                v-model="editedDescription"
                                class="ma-2"
                                label="Description"
                                variant="outlined"
                                @blur="finishEditingDescription(item)"
                              />
                              <span v-else>{{ item.description }}</span>
                            </div>
                          </v-col>
                        </v-row>
                      </v-container>
                    </v-card-text>
                  </v-card>
                </td>
              </template>
            </v-data-table>
          </v-sheet>
        </v-col>
      </v-row>
    </v-container>
  </v-card>
  <ConfirmDeleteDialog
    v-if="showDeleteAnalysisDialog"
    :message="`Are you sure you want to delete this Analysis: ${analysisStore.analyses.find(analysis => analysis.id === analysisIdToDelete)?.name ?? ''}?`"
    :show="showDeleteAnalysisDialog"
    @delete:canceled="showDeleteAnalysisDialog = false"
    @delete:confirmed="deleteAnalysis(analysisIdToDelete)"
  />
  <AnalysisFlowDialog
    :analysis-id="analysisIdToShow"
    :show="showAnalysisFlowDialog"
    @close="closeAnalysisFlow"
  />
</template>
