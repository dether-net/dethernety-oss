<script setup lang="ts">
  import { useFlowStore } from '@/stores/flowStore'
  import {
    Exposure,
    MitreAttackTechnique,
  } from '@dethernety/dt-core'

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
  const tab = ref('information')
  const mitreAttackTacticTab = ref('')
  const exposure = ref<Exposure>({
    id: '',
    name: '',
    description: '',
    type: '',
    category: '',
    score: 0,
  })

  const selectedTechniqueIds = ref<string[]>([])

  const mitreAttackTechniques = ref<MitreAttackTechnique[]>([])

  watch(showDialog, newVal => {
    emit('update:showDialog', newVal)
  })

  watch(elementId, newVal => {
    emit('update:elementId', newVal)
  })

  const closeDialog = () => {
    emit('update:showDialog', false)
  }

  const loadExposure = async () => {
    if (exposureId.value) {
      const response = await flowStore.getExposure({ exposureId: exposureId.value })
      exposure.value = response

      selectedTechniqueIds.value = (response.exploitedBy || []).map(t => t.id)

      if (response.exploitedBy?.length && flowStore.mitreAttackTactics.length) {
        const firstTechnique = response.exploitedBy[0]
        if (firstTechnique.tactics?.length) {
          mitreAttackTacticTab.value = firstTechnique.tactics[0].id
          await loadMitreAttackTechniques()
        } else {
          mitreAttackTacticTab.value = flowStore.mitreAttackTactics[0].id
          await loadMitreAttackTechniques()
        }
      }
    }
  }

  watch(exposureId, newVal => {
    if (newVal) {
      loadExposure()
    }
  })

  const saveExposure = () => {
    if (elementId.value) {
      if (props.action === 'create') {
        flowStore.createExposure({
          exposure: exposure.value,
          elementId: elementId.value,
          attackTechniqueIds: selectedTechniqueIds.value,
        }).then(response => {
          if (response) {
            snackBar.value.show = true
            snackBar.value.color = 'success'
            snackBar.value.message = 'Exposure created successfully'
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
            attackTechniqueIds: selectedTechniqueIds.value,
          }).then(response => {
            if (response) {
              snackBar.value.show = true
              snackBar.value.color = 'success'
              snackBar.value.message = 'Exposure updated successfully'
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

  const loadMitreAttackTechniques = async () => {
    const techniques = await flowStore.getMitreAttackTechniquesByTactic({ tacticId: mitreAttackTacticTab.value })
    mitreAttackTechniques.value = techniques
  }

  const updateSelectedTechniques = (technique: MitreAttackTechnique, isSelected: boolean | null) => {
    if (isSelected === true) {
      if (!selectedTechniqueIds.value.includes(technique.id)) {
        selectedTechniqueIds.value.push(technique.id)
      }
    } else {
      const index = selectedTechniqueIds.value.indexOf(technique.id)
      if (index !== -1) {
        selectedTechniqueIds.value.splice(index, 1)
      }
    }
  }

  const isTechniqueSelected = (technique: MitreAttackTechnique) => selectedTechniqueIds.value.includes(technique.id)

  if (props.action === 'edit' && exposureId.value) {
    loadExposure()
  }
</script>

<template>
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <!-- eslint-disable vue/no-template-shadow -->
  <!-- eslint-disable vue/no-lone-template -->
  <v-dialog
    v-model="showDialog"
    fluid
    width="60vw"
    @keydown.esc="closeDialog"
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
              @click="closeDialog"
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
                      <v-tab prepend-icon="mdi-fencing" text="Attack Techniques" value="attack-techniques" />
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
                              <v-text-field label="Score" />
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
                        <v-container>
                          <v-row>
                            <v-col cols="12">
                              <v-row>
                                <v-col cols="12">
                                  <v-tabs v-model="mitreAttackTacticTab" direction="horizontal" @update:modelValue="loadMitreAttackTechniques">
                                    <v-tab v-for="tactic in flowStore.mitreAttackTactics" :key="tactic.id" :text="tactic.name" :value="tactic.id" />
                                  </v-tabs>
                                </v-col>
                              </v-row>
                              <v-row>
                                <v-col cols="12">
                                  <v-tabs-window v-model="mitreAttackTacticTab" class="settings-window">
                                    <v-tabs-window-item v-for="tactic in flowStore.mitreAttackTactics" :key="tactic.id" :value="tactic.id">
                                      <v-container class="techniques-container">
                                        <v-row>
                                          <v-col cols="12">
                                            <v-list>
                                              <v-list-group
                                                v-for="technique in mitreAttackTechniques.sort((a: MitreAttackTechnique, b: MitreAttackTechnique) => a.attack_id.localeCompare(b.attack_id))"
                                                :key="technique.id"
                                                class="mb-1"
                                                :collapse-icon="technique.subTechniques?.length ? 'mdi-chevron-up' : 'mdi-circle-small'"
                                                :expand-icon="technique.subTechniques?.length ? 'mdi-chevron-down' : 'mdi-circle-small'"
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
                                                  >
                                                    <v-list-item-title>
                                                      <div class="d-flex align-center justify-space-between">
                                                        <v-checkbox
                                                          class="ma-0 pa-0"
                                                          :label="technique.name + ' (' + technique.attack_id + ')'"
                                                          :model-value="isTechniqueSelected(technique)"
                                                          @update:model-value="updateSelectedTechniques(technique, $event)"
                                                        />
                                                        <v-tooltip location="top" :text="technique.description" width="60vw">
                                                          <template #activator="{ props }">
                                                            <v-icon v-bind="props" class="ma-0 pa-0" icon="mdi-information-outline" />
                                                          </template>
                                                        </v-tooltip>
                                                      </div>
                                                    </v-list-item-title>
                                                  </v-list-item>
                                                </template>
                                                <v-list-item
                                                  v-for="subTechnique in technique.subTechniques?.sort((a: MitreAttackTechnique, b: MitreAttackTechnique) => a.attack_id.localeCompare(b.attack_id))"
                                                  :key="subTechnique.id"
                                                  class="ml-5 mb-1"
                                                  density="compact"
                                                  variant="text"
                                                >
                                                  <v-list-item-title>
                                                    <div class="d-flex align-center justify-space-between">
                                                      <v-checkbox
                                                        :label="subTechnique.name + ' (' + subTechnique.attack_id + ')'"
                                                        :model-value="isTechniqueSelected(subTechnique)"
                                                        @update:model-value="updateSelectedTechniques(subTechnique, $event)"
                                                      />
                                                      <v-tooltip location="top" :text="subTechnique.description" width="60vw">
                                                        <template #activator="{ props }">
                                                          <v-icon v-bind="props" class="ma-0 pa-0" icon="mdi-information-outline" />
                                                        </template>
                                                      </v-tooltip>
                                                    </div>
                                                  </v-list-item-title>
                                                </v-list-item>
                                              </v-list-group>
                                            </v-list>
                                          </v-col>
                                        </v-row>
                                      </v-container>
                                    </v-tabs-window-item>
                                  </v-tabs-window>
                                </v-col>
                              </v-row>
                            </v-col>
                          </v-row>
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
            icon="mdi-content-save"
            size="x-large"
            variant="outlined"
            @click="saveExposure"
          />
        </v-card-actions>
      </v-card>
    </v-form>
  </v-dialog>
  <template>
    <v-snackbar
      v-model="snackBar.show"
      :color="snackBar.color"
      timeout="5000"
      top
    >
      {{ snackBar.message }}
    </v-snackbar>
  </template>
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
