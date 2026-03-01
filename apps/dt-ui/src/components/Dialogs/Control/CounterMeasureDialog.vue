<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useControlsStore } from '@/stores/controlsStore'
  import { Countermeasure, MitreDefendTechnique } from '@dethernety/dt-core'

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
  const techniques = ref<MitreDefendTechnique[]>([])
  const subTechniqueTab = ref('')
  const searchMitigation = ref('')
  const selectedMitigationIds = ref<string[]>([])
  const defendTacticTab = ref('')
  // const selectedTechniqueIds = ref<string[]>([])
  const filteredMitigations = computed(() => {
    return mitreAttackMitigations.value.filter(mitigation => {
      const nameMatches = mitigation.name.toLowerCase().includes(searchMitigation.value.toLowerCase())
      const attackIdMatches = mitigation.attack_id.toLowerCase().includes(searchMitigation.value.toLowerCase())
      return nameMatches || attackIdMatches
    })
  })

  const sortedTechniques = computed(() => {
    return [...techniques.value].sort((a, b) => a.name.localeCompare(b.name))
  })

  const getSortedSubTechniques = (technique: MitreDefendTechnique) => {
    return technique.subTechniques ? [...technique.subTechniques].sort((a, b) => a.name.localeCompare(b.name)) : []
  }

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

  const updateSelectedTechniques = (technique: MitreDefendTechnique, value: boolean | null) => {
    if (value) {
      countermeasure.value.defendedTechniques?.push(technique)
    } else {
      countermeasure.value.defendedTechniques = countermeasure.value.defendedTechniques?.filter(t => t.id !== technique.id)
    }
  }

  watch(showDialog, newVal => {
    emit('close', newVal)
  })

  const closeDialog = () => {
    showDialog.value = false
    emit('close')
  }

  const loadCountermeasure = async () => {
    if (countermeasureId.value) {
      const response = await controlsStore.getCountermeasure({ countermeasureId: countermeasureId.value })
      if (response) {
        countermeasure.value = JSON.parse(JSON.stringify(response))
        selectedMitigationIds.value = response.mitigations?.map(mitigation => mitigation.id) || []
      }
    }
  }

  watch(countermeasureId, newVal => {
    if (newVal) {
      loadCountermeasure()
    }
  })

  const onSubmit = () => {
    if (action.value === 'create') {
      countermeasure.value.mitigations = selectedMitigationIds.value.map(
        id => mitreAttackMitigations.value.find(mitigation => mitigation.id === id)
      ).filter((mitigation): mitigation is NonNullable<typeof mitigation> => mitigation !== undefined)
      controlsStore.createCountermeasure({
        controlId: controlId.value,
        countermeasure: countermeasure.value,
      }).then(response => {
        if (response) {
          emit('countermeasure:created')
          showDialog.value = false
        } else {
          emit('countermeasure:failed')
        }
      })
    } else if (action.value === 'update') {
      countermeasure.value.mitigations = selectedMitigationIds.value.map(
        id => mitreAttackMitigations.value.find(mitigation => mitigation.id === id)
      ).filter((mitigation): mitigation is NonNullable<typeof mitigation> => mitigation !== undefined)
      controlsStore.updateCountermeasure({
        countermeasureId: countermeasure.value.id,
        countermeasure: countermeasure.value,
      }).then(response => {
        if (response) {
          emit('countermeasure:updated')
          showDialog.value = false
        } else {
          emit('countermeasure:failed')
        }
      })
    }
  }

  const mitreAttackMitigations = computed(() => {
    return controlsStore.mitreAttackMitigations
  })

  const mitigationHeaders = [
    { title: 'Name', key: 'name' },
    { title: 'Attack ID', key: 'attack_id' },
    { title: '', key: 'description' },
  ]

  const loadMitreDefendTechniques = async () => {
    techniques.value = await controlsStore.getMitreDefendTechniquesByTactic({ tacticId: defendTacticTab.value })
  }

  loadCountermeasure()

</script>

<template>
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <!-- eslint-disable vue/no-template-shadow -->
  <!-- eslint-disable vue/no-lone-template -->
  <v-dialog
    v-model="showDialog"
    fluid
    width="80vw"
    @keydown.esc="closeDialog"
  >
    <v-form @submit.prevent="onSubmit">
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
              @click="closeDialog"
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
                  <v-tab prepend-icon="mdi-shield-sun-outline" text="D3fend tactics" value="defend-tactics" />
                </v-tabs>
              </v-col>
              <v-col class="pa-1 px-6 elevation-11 border-thin rounded-lg" cols="9">
                <v-container class="content-container">
                  <v-tabs-window v-model="tab" class="settings-window">
                    <v-tabs-window-item value="information">
                      <v-container>
                        <v-row>
                          <v-col cols="5">
                            <v-text-field v-model="countermeasure.name" label="Name" required />
                          </v-col>
                          <v-col cols="3">
                            <v-text-field v-model="countermeasure.score" label="Score" required />
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
                      <v-container>
                        <v-data-table
                          v-model="selectedMitigationIds"
                          :headers="mitigationHeaders"
                          item-key="id"
                          :items="filteredMitigations"
                          show-select
                        >
                          <template #top>
                            <div class="search-container">
                              <v-text-field v-model="searchMitigation" label="Search" />
                            </div>
                          </template>
                          <template #item.description="{ item }">
                            <v-tooltip location="top" :text="item.description" width="60vw">
                              <template #activator="{ props }">
                                <v-icon
                                  v-bind="props"
                                  icon="mdi-information-outline"
                                />
                              </template>
                            </v-tooltip>
                          </template>
                        </v-data-table>
                      </v-container>
                    </v-tabs-window-item>
                    <v-tabs-window-item value="defend-tactics">
                      <v-container>
                        <v-row>
                          <v-col cols="12">
                            <v-tabs v-model="defendTacticTab" direction="horizontal" @update:modelValue="loadMitreDefendTechniques">
                              <v-tab v-for="tactic in controlsStore.mitreDefendTactics" :key="tactic.id" :text="tactic.name" :value="tactic.id" />
                            </v-tabs>
                          </v-col>
                        </v-row>
                        <v-row>
                          <v-col cols="12">
                            <v-tabs-window v-model="defendTacticTab" class="settings-window">
                              <v-tabs-window-item v-for="tactic in controlsStore.mitreDefendTactics" :key="tactic.id" :value="tactic.id">
                                <v-container class="pa-0 ma-0 border-thin rounded-lg" fluid height="50vh">
                                  <v-row>
                                    <v-col cols="12">
                                      <v-container class="pa-0 ma-0" fluid>
                                        <v-row>
                                          <v-col cols="12">
                                            <v-tabs v-model="subTechniqueTab" direction="horizontal">
                                              <v-tab v-for="technique in sortedTechniques" :key="technique.id" :text="technique.name" :value="technique.id" />
                                            </v-tabs>
                                          </v-col>
                                        </v-row>
                                        <v-row>
                                          <v-col cols="12">
                                            <v-tabs-window v-model="subTechniqueTab" class="sub-techniques-window px-2 ma-1">
                                              <v-tabs-window-item v-for="technique in sortedTechniques" :key="technique.id" :value="technique.id">
                                                <v-container class="sub-techniques-container pa-0 ma-0" fluid>
                                                  <v-row>
                                                    <v-list class="w-100 pa-3 ma-0">
                                                      <v-list-group
                                                        v-for="subTechnique in getSortedSubTechniques(technique)"
                                                        :key="subTechnique.id"
                                                        :collapse-icon="subTechnique.subTechniques?.length ? 'mdi-chevron-up' : 'mdi-circle-small'"
                                                        :expand-icon="subTechnique.subTechniques?.length ? 'mdi-chevron-down' : 'mdi-circle-small'"
                                                        variant="outlined"
                                                      >
                                                        <template #activator="{ props }">
                                                          <v-list-item
                                                            v-bind="props"
                                                            base-color="secondary"
                                                            class="mb-1"
                                                            color="primary"
                                                            density="compact"
                                                            elevation="11"
                                                            variant="tonal"
                                                            width="100%"
                                                          >
                                                            <v-list-item-title>
                                                              <div class="d-flex flex-row align-center justify-space-between">
                                                                <v-checkbox
                                                                  v-bind="props"
                                                                  class="flex-1-0 ma-0 pa-0"
                                                                  :label="subTechnique.name"
                                                                  :model-value="countermeasure.defendedTechniques?.some((t: MitreDefendTechnique) => t.id === subTechnique.id)"
                                                                  @update:model-value="updateSelectedTechniques(subTechnique, $event)"
                                                                />
                                                                <v-tooltip location="top" :text="subTechnique.description" width="60vw">
                                                                  <template #activator="{ props }">
                                                                    <v-icon v-bind="props" icon="mdi-information-outline" />
                                                                  </template>
                                                                </v-tooltip>
                                                              </div>
                                                            </v-list-item-title>
                                                          </v-list-item>
                                                        </template>
                                                        <v-list-item
                                                          v-for="subSubTechnique in subTechnique.subTechniques"
                                                          :key="subSubTechnique.id"
                                                          class="mx-5 px-10 mb-2 w-100"
                                                          density="compact"
                                                          variant="text"
                                                        >
                                                          <v-list-item-title>
                                                            <div class="d-flex align-center justify-space-between">
                                                              <v-checkbox
                                                                v-bind="props"
                                                                :label="subSubTechnique.name"
                                                                :model-value="countermeasure.defendedTechniques?.some((t: MitreDefendTechnique) => t.id === subSubTechnique.id)"
                                                                @update:model-value="updateSelectedTechniques(subSubTechnique, $event)"
                                                              />
                                                              <v-tooltip location="top" :text="subSubTechnique.description" width="60vw">
                                                                <template #activator="{ props }">
                                                                  <v-icon v-bind="props" icon="mdi-information-outline" />
                                                                </template>
                                                              </v-tooltip>
                                                            </div>
                                                          </v-list-item-title>
                                                        </v-list-item>
                                                      </v-list-group>
                                                    </v-list>
                                                  </v-row>
                                                </v-container>
                                              </v-tabs-window-item>
                                            </v-tabs-window>
                                          </v-col>
                                        </v-row>
                                      </v-container>
                                    </v-col>
                                  </v-row>
                                </v-container>
                              </v-tabs-window-item>
                            </v-tabs-window>
                          </v-col>
                        </v-row>
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
            icon="mdi-content-save-all-outline"
            size="x-large"
            type="submit"
            variant="outlined"
            @click="onSubmit"
          />
        </v-card-actions>
      </v-card>
    </v-form>
  </v-dialog>
</template>

<style scoped>
  .content-container {
    height: 60vh;
  }
  .sub-techniques-container {
    height: 40vh;
    min-height: 300px;
    overflow-y: auto;
  }
  .sub-techniques-window {
    height: 40vh;
    min-height: 300px;
    overflow-y: auto;
  }
</style>
