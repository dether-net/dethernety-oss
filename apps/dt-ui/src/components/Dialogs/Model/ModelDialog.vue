<script setup lang="ts">
  import { computed, ref } from 'vue'
  import { useModelsStore } from '@/stores/modelsStore'
  import { useRouter } from 'vue-router'
  import { Class, Control, Model, Module } from '@dethernety/dt-core'
  import { useIssueStore } from '@/stores/issueStore'
  import { getPageDisplayName } from '@/utils/dataFlowUtils'

  interface Props {
    show: boolean
    id: string
    showFileActions: boolean
  }

  interface SnackBar {
    show: boolean
    message: string
    color: string
  }

  const props = defineProps<Props>()
  const showModelDialog = ref(props.show)
  const modelId = ref(props.id)

  const tab = ref<string | unknown>('general')
  const router = useRouter()
  const modelsStore = useModelsStore()
  const issueStore = useIssueStore()
  const modules = computed(() => modelsStore.modules)
  const model = ref<Model | null>(null)
  const emits = defineEmits(['model:saved', 'model:open', 'model:moved', 'model:deleted', 'model:closed', 'redirect:issue'])
  const showFolderSelectDialog = ref(false)
  const deleteModelDialog = ref(false)
  const exportModelDialog = ref(false)
  const showControlDialog = ref<boolean>(false)
  const selectedControlId = ref<string | null>(null)
  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })
  const showContentSelectDialog = ref(false)
  const newName = ref(model.value?.name || '')
  const newDescription = ref(model.value?.description || '')
  const newModules = ref<Module[]>(model.value?.modules || [])
  const controls = ref<Control[]>([])
  const modelName = ref<string>('')

  const showIssueDialog = ref(false)
  const issueClass = ref<Class | null>(null)

  modelsStore.fetchModules()

  const headers = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
    { title: 'Classes', key: 'controlClasses' },
    { title: '', key: 'actions' },
  ]
  const itemsPerPage = [
    { value: 5, title: '5' },
    { value: 10, title: '10' },
    { value: 25, title: '25' },
    { value: 50, title: '50' },
    { value: -1, title: '$vuetify.dataFooter.itemsPerPageAll' },
  ]

  const selectedControlIds = ref<string[]>([])

  const addControl = () => {
    showContentSelectDialog.value = true
  }

  const saveModel = async (): Promise<boolean> => {
    const ret = await modelsStore
      .updateModel({
        id: model.value?.id || '',
        name: newName.value,
        description: newDescription.value,
        modules: newModules.value.map(module => module.id),
        controls: selectedControlIds.value,
        folderId: model.value?.folder?.id || undefined,
      })
    if (ret) {
      controls.value = controls.value.filter(control => selectedControlIds.value.includes(control.id || ''))
      modelName.value = newName.value
    }
    return ret
  }

  const moveToFolder = (folderId: string) => {
    modelsStore.updateModel({
      id: model.value?.id || '',
      name: newName.value,
      description: newDescription.value,
      modules: newModules.value.map(module => module.id),
      controls: selectedControlIds.value,
      folderId,
    }).then(ret => {
      if (ret) {
        emits('model:moved', folderId)
      } else {
        emits('model:moved', null)
      }
    }).catch(() => {
      emits('model:moved', null)
    })
  }

  onMounted(() => {
    modelsStore.getModel({ modelId: modelId.value }).then(modelData => {
      model.value = modelData
      modelName.value = model.value?.name || ''
      newName.value = model.value?.name || ''
      newDescription.value = model.value?.description || ''
      newModules.value = model.value?.modules || []
      selectedControlIds.value = model.value?.controls?.map(control => control.id || '') || []
      controls.value = model.value?.controls || []
    })
  })

  const onSubmit = async () => {
    const success = await saveModel()
    if (success) {
      emits('model:saved', true, undefined)
    } else {
      console.log('modelsStore.error', modelsStore.error)
      emits('model:saved', false, modelsStore.error)
    }
  }

  const onDeleteModel = () => {
    modelsStore.deleteModel({ modelId: modelId.value }).then(ret => {
      if (ret) {
        emits('model:deleted', true)
      } else {
        emits('model:deleted', false)
      }
    })
    deleteModelDialog.value = false
  }

  const exportModel = async () => {
    const success = await saveModel()
    if (success) {
      exportModelDialog.value = true
    }
  }

  const openModel = async (id: string) => {
    const success = await saveModel()
    if (success) {
      router.push({ path: '/dataflow', query: { id } })
    }
  }

  const onSaveControl = (success: boolean) => {
    snackBar.value = {
      show: true,
      message: success ? 'Control saved' : 'Failed to save control',
      color: success ? 'success' : 'error',
    }
    showControlDialog.value = false
    selectedControlId.value = null
  }

  const onSelectControl = (selectedModels: Model[], selectedControls: Control[]) => {
    const newControls = selectedControls.filter(control => !controls.value.some(c => c.id === control.id))
    controls.value = [...controls.value, ...newControls]
    selectedControlIds.value = controls.value.map(control => control.id || '')
    saveModel().then(success => {
      emits('model:saved', success)
    })
  }

  const onAddIssue = (data: {issueClass: Class, id: string, name: string, description: string}) => {
    issueClass.value = data.issueClass
    showIssueDialog.value = true
  }

  const onCopyToIssue = (data: {id: string, name: string, description: string}) => {
    // Get current route information dynamically
    const currentRoute = router.currentRoute.value
    const returnTo = {
      name: getPageDisplayName(currentRoute.path),
      path: currentRoute.path,
      query: { ...currentRoute.query },
    }

    issueStore.setIssueDataClipboard({
      name: data.name || '',
      description: data.description || '',
      elementIds: [data.id || ''],
      returnTo,
    })
    emits('redirect:issue')
  }

  watch(
    () => props.show,
    newVal => {
      showModelDialog.value = newVal
    }
  )
</script>

<template>
  <!-- eslint-disable vue/no-lone-template -->
  <!-- eslint-disable vue/attribute-hyphenation -->
  <v-dialog
    v-model="showModelDialog"
    attach="body"
    class="pa-0 ma-0"
    max-width="75vw"
    @click:outside="emits('model:closed')"
    @keydown.esc="emits('model:closed')"
  >
    <v-card
      class="pa-0 ma-0 rounded-lg"
    >
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="tertiary" size="small">mdi-vector-polyline</v-icon>
            <span class="ml-2 text-body-1">Model: {{ modelName }}</span>
          </div>
          <v-btn
            color="foreground"
            icon="mdi-close"
            size="medium"
            variant="text"
            @click="emits('model:closed')"
          />
        </v-sheet>
      </v-card-title>
      <v-card-text>
        <v-form @submit.prevent="onSubmit">
          <v-card class="model-card elevation-8 mb-4 border-thin rounded-lg">
            <v-container class="w-100">
              <!-- Tabs -->
              <v-row>
                <v-tabs v-model="tab" color="primary">
                  <v-tab prepend-icon="mdi-cog-outline" value="general">General</v-tab>
                  <v-tab prepend-icon="mdi-shield-sword-outline" value="controls">Controls</v-tab>
                  <v-tab prepend-icon="mdi-creation" value="analysis">Analysis</v-tab>
                </v-tabs>
              </v-row>

              <!-- Tab Contents -->
              <v-row>
                <v-tabs-window v-model="tab" class="model-tab w-100">
                  <!-- General Tab -->
                  <v-tabs-window-item value="general">
                    <v-container>
                      <v-row>
                        <v-col cols="7">
                          <v-text-field v-model="newName" label="Name" />
                        </v-col>
                        <v-col cols="5">
                          <v-combobox
                            v-model="newModules"
                            chips
                            item-title="name"
                            item-value="id"
                            :items="modules"
                            label="Selected Modules"
                            multiple
                          />
                        </v-col>
                      </v-row>
                      <v-row>
                        <v-col cols="12">
                          <v-textarea v-model="newDescription" label="Description" rows="6" />
                        </v-col>
                      </v-row>
                    </v-container>
                  </v-tabs-window-item>

                  <!-- Controls Tab -->
                  <v-tabs-window-item class="pt-1" value="controls">
                    <v-data-table
                      v-model="selectedControlIds"
                      :headers="headers"
                      item-key="id"
                      :items="controls"
                      items-per-page="5"
                      :items-per-page-options="itemsPerPage"
                      show-select
                    >
                      <!-- Search Bar -->
                      <template #top>
                        <div class="d-flex justify-end mb-6">
                          <v-btn
                            class="mx-3 my-0"
                            color="secondary"
                            icon="mdi-shield-plus-outline"
                            size="x-large"
                            variant="outlined"
                            @click="addControl"
                          />
                        </div>
                      </template>

                      <!-- Classes Column with Chips -->
                      <template #item.controlClasses="{ item }">
                        <div>
                          <v-chip
                            v-for="cls in item.controlClasses || []"
                            :key="cls.id"
                            class="ma-1"
                            small
                          >
                            {{ cls.name }}
                          </v-chip>
                        </div>
                      </template>
                      <template #item.actions="{ item }">
                        <v-btn
                          class="ma-1"
                          color="primary"
                          icon="mdi-pencil"
                          variant="plain"
                          @click="selectedControlId = item.id || null; showControlDialog = true"
                        />
                      </template>
                    </v-data-table>
                  </v-tabs-window-item>

                  <!-- Analysis Tab -->
                  <v-tabs-window-item value="analysis">
                    <AnalysisDialog v-if="modelId" :model-id="modelId" />
                  </v-tabs-window-item>
                </v-tabs-window>
              </v-row>
            </v-container>
            <v-card-actions class="ma-0 pa-0 d-flex flex-row justify-space-between">
              <div class="d-flex flex-row align-center justify-space-between">
                <v-card class="ma-0 pa-0 elevation-0 border-e-thin">
                  <v-card-title class="d-flex flex-row align-center justify-center">
                    <span class="ml-2 text-body-1">Add Issue</span>
                  </v-card-title>
                  <v-card-text class="d-flex flex-row align-center justify-center">
                    <IssueSelector
                      :id="modelId || ''"
                      :name="modelName || ''"
                      :description="newDescription || ''"
                      size="x-large"
                      variant="outlined"
                      @copy:issue="onCopyToIssue"
                      @add:issue="onAddIssue"
                    />
                  </v-card-text>
                </v-card>
                <v-card class="ma-0 pa-0 elevation-0 border-e-thin">
                  <v-card-title>
                    <span class="ml-2 text-body-1" />
                  </v-card-title>
                  <v-card-text>
                    <v-btn
                      class="ma-3"
                      color="success"
                      icon="mdi-content-save-outline"
                      size="x-large"
                      type="submit"
                      variant="outlined"
                    />
                    <template v-if="showFileActions">
                      <v-btn
                        class="ma-3"
                        color="secondary"
                        icon="mdi-download-outline"
                        size="x-large"
                        variant="outlined"
                        @click="exportModel()"
                      />
                      <v-btn
                        class="ma-3"
                        color="secondary"
                        icon="mdi-file-move-outline"
                        size="x-large"
                        variant="outlined"
                        @click="showFolderSelectDialog = true"
                      />
                      <v-btn
                        class="ma-3"
                        color="error"
                        icon="mdi-trash-can-outline"
                        size="x-large"
                        variant="outlined"
                        @click="deleteModelDialog = true"
                      />
                    </template>
                  </v-card-text>
                </v-card>
              </div>
              <v-card class="ma-0 pa-0 elevation-0">
                <v-card-title>
                  <span class="ml-2 text-body-1" />
                </v-card-title>
                <v-card-text>
                  <v-btn
                    v-if="showFileActions"
                    class="ma-3"
                    color="secondary"
                    icon="mdi-vector-polyline-edit"
                    size="x-large"
                    variant="outlined"
                    @click="modelId && openModel(modelId)"
                  />
                </v-card-text>
              </v-card>
            </v-card-actions>
          </v-card>
        </v-form>

        <ConfirmDeleteModelDialog
          v-if="deleteModelDialog"
          :model-name="model?.name || ''"
          :show="deleteModelDialog"
          @delete:canceled="deleteModelDialog = false"
          @delete:confirmed="onDeleteModel"
        />

        <ExportModelDialog
          v-if="exportModelDialog"
          :modelId="modelId || ''"
          :show="exportModelDialog"
          @update:show="exportModelDialog = false"
        />

        <template>
          <FolderSelectDialog
            v-if="showFolderSelectDialog"
            :show="showFolderSelectDialog"
            @close="showFolderSelectDialog = false"
            @move="moveToFolder"
          />
        </template>

        <ControlDialog
          v-if="showControlDialog && selectedControlId !== null"
          :id="selectedControlId ?? ''"
          :show="showControlDialog && selectedControlId !== null"
          :show-file-actions="false"
          @control:closed="showControlDialog = false; selectedControlId = null"
          @control:saved="onSaveControl"
        />

        <ContentSelectDialog
          v-if="showContentSelectDialog"
          content-type="Control"
          enable-create
          select-type="multiple"
          :show="showContentSelectDialog"
          @close="showContentSelectDialog = false"
          @select="onSelectControl"
        />
        <IssueDialog
          v-if="showIssueDialog"
          :element-ids="[modelId || '']"
          :issue-class="issueClass || undefined"
          :show="showIssueDialog"
          @cancel:issue="showIssueDialog = false"
          @issue:added="onAddIssue"
        />

        <v-snackbar v-model="snackBar.show" :color="snackBar.color" timeout="5000" top>
          {{ snackBar.message }}
        </v-snackbar>
      </v-card-text>
    </v-card>
  </v-dialog>

</template>

<style scoped>
.model-tab {
  height: 350px;
  overflow-y: auto;
}

.issue-class-btn {
  border-width: 1px;
  border-style: solid;
  border-color: rgba(var(--v-theme-secondary), 1);
  background-color: rgba(var(--v-theme-primary), 1);
  .text-color {
    color: rgba(var(--v-theme-tertiary), 1);
  }
}
</style>
