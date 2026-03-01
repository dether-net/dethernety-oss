<script setup lang="ts">
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
  import { useAnalysisStore } from '@/stores/analysisStore'
  import { Analysis } from '@dethernety/dt-core'

  import { useRouter } from 'vue-router'
  import { useDate } from 'vuetify'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'
  import AnalysisFlowDialog from '@/components/Dialogs/Analysis/AnalysisFlowDialog.vue'

  interface Props {
    modelId: string
  }
  const props = defineProps<Props>()
  const showDeleteAnalysisDialog = ref<boolean>(false)
  const showAnalysisFlowDialog = ref<boolean>(false)
  const analysisIdToDelete = ref<string | undefined>(undefined)
  const analysisIdToShow = ref<string | undefined>(undefined)
  const analysisStore = useAnalysisStore()
  const router = useRouter()
  const fetchTimer = ref(null)
  const date = useDate()

  analysisStore.fetchAnalyses({ elementId: props.modelId })

  onMounted(() => {
    fetchTimer.value = setInterval(() => {
      analysisStore.fetchAnalyses({ elementId: props.modelId })
    }, 5000) as unknown as null
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
  const groupBy = [{ key: 'analysisClass.name', order: 'asc' as const }]

  const analysisClasses = computed(() => analysisStore.analysisClasses)

  // Track which item is being edited
  const editingNameItem = ref<string | null>(null)
  const editingDescriptionItem = ref<string | null>(null)
  const editedName = ref<string>('')
  const editedDescription = ref<string>('')

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
    analysisStore.createAnalysis({
      name: analysisClasses.value.find(analysisClass => analysisClass.id === analysisClassId)?.name || 'New Analysis',
      description: analysisClasses.value.find(analysisClass => analysisClass.id === analysisClassId)?.name || 'New Analysis',
      type: analysisClasses.value.find(analysisClass => analysisClass.id === analysisClassId)?.type || '',
      category: analysisClasses.value.find(analysisClass => analysisClass.id === analysisClassId)?.category || '',
      elementId: props.modelId,
      analysisClassId,
    }).then(response => {
      if (response) {
        startEditingName(response)
      }
    })
  }

  const deleteAnalysis = (analysisId: string | undefined) => {
    if (!analysisId) return
    analysisStore.deleteAnalysis({ analysisId })
    showDeleteAnalysisDialog.value = false
    analysisIdToDelete.value = undefined
  }

  const runAnalysis = (analysisId: string | undefined) => {
    if (!analysisId) return
    analysisStore.runAnalysis({ analysisId }).then(() => {
      openAnalysisFlow(analysisId)
    })
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
              :group-by="groupBy"
              :headers="headers"
              :items="analysisStore.analyses"
              show-expand
            >
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
              <template #group-header="{ item, columns, toggleGroup, isGroupOpen }">
                <tr>
                  <td :colspan="columns.length">
                    <div class="d-flex align-center">
                      <v-btn
                        color="medium-emphasis"
                        density="comfortable"
                        :icon="isGroupOpen(item) ? '$expand' : '$next'"
                        size="small"
                        variant="outlined"
                        @click="toggleGroup(item)"
                        @vue:mounted="toggleGroup(item)"
                      />
                      <span class="ms-4">Analyzed by '{{ item.value }}'</span>
                    </div>
                  </td>
                </tr>
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
                {{ item.status?.status }}
              </template>
              <template #item.actions="{ item }">
                <div class="d-flex justify-end">
                  <v-progress-circular
                    v-if="['busy', 'interrupted', 'running'].includes(item.status?.status ?? '')"
                    class="ma-1 run-analysis-button-progress"
                    color="amber"
                    indeterminate
                    :size="20"
                  />
                  <v-btn
                    v-if="['error'].includes(item.status?.status ?? '')"
                    class="mx-0"
                    color="error"
                    icon="mdi-alert-circle-outline"
                    variant="plain"
                    @click="runAnalysis(item.id)"
                  />
                  <v-btn
                    v-else
                    class="mx-0"
                    :color="['busy', 'interrupted', 'running'].includes(item.status?.status ?? '') ? 'grey' : 'amber'"
                    :disabled="['busy', 'interrupted', 'running'].includes(item.status?.status ?? '')"
                    icon="mdi-creation-outline"
                    variant="plain"
                    @click="runAnalysis(item.id)"
                  />
                  <v-btn
                    class="mx-0"
                    :color="['busy', 'interrupted', 'running'].includes(item.status?.status ?? '') ? 'grey' : 'error'"
                    :disabled="['busy', 'interrupted', 'running'].includes(item.status?.status ?? '')"
                    icon="mdi-trash-can-outline"
                    variant="plain"
                    @click="analysisIdToDelete = item.id; showDeleteAnalysisDialog = true"
                  />
                  <v-btn
                    v-if="!['interrupted', 'busy', 'running'].includes(item.status?.status ?? '')"
                    class="mx-6"
                    :color="item.status?.status === 'idle' ? 'secondary' : 'grey'"
                    :disabled="item.status?.status !== 'idle'"
                    icon="mdi-arrow-right-bold"
                    variant="outlined"
                    @click="openResults(item.id)"
                  />
                  <v-btn
                    v-if="item.status?.status === 'interrupted'"
                    class="mx-6"
                    color="warning"
                    icon="mdi-forum-outline"
                    variant="plain"
                    @click="openAnalysisFlow(item.id)"
                  />
                  <v-btn
                    v-if="['busy', 'running'].includes(item.status?.status ?? '')"
                    class="mx-6"
                    color="warning"
                    icon="mdi-eye-outline"
                    variant="outlined"
                    @click="openAnalysisFlow(item.id)"
                  />
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
