<script setup lang="ts">
  import { useFolderStore } from '@/stores/folderStore'
  import { useModelsStore } from '@/stores/modelsStore'
  import { useControlsStore } from '@/stores/controlsStore'
  import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
  import type { Folder } from '@dethernety/dt-core'
  import { Control, Model } from '@dethernety/dt-core'
  import { getNewName } from '@/utils/dataFlowUtils'

  interface SnackBar {
    show: boolean
    message: string
    color: string
  }

  const showFolderDialog = ref(false)
  const folderDialogType = ref<'create' | 'edit'>('create')
  const folderStore = useFolderStore()
  const route = useRoute()
  const router = useRouter()
  const breadcrumbs = ref<{ title: string, to: string }[]>([])
  const showDeleteFolderDialog = ref(false)
  const showFolderSelectDialog = ref(false)
  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })
  const showModelDialog = ref(false)
  const showControlDialog = ref(false)
  const selectedControlId = ref<string | null>(null)

  const modelsStore = useModelsStore()
  const models = computed(() => modelsStore.models)
  const selectedModelId = ref<string | null>(null)

  const showImportModelDialog = ref(false)

  const controlsStore = useControlsStore()

  const controls = computed(() => controlsStore.controls)

  const buildBreadcrumbs = (folder: Folder | undefined): { title: string, to: string }[] => {
    if (!folder) {
      return [{
        title: '🏠 Home',
        to: '/browser?dir=root',
      }]
    }

    const trail: { title: string, to: string }[] = []
    let currentFolder: Folder | undefined = folder

    while (currentFolder) {
      trail.unshift({
        title: currentFolder.name || '',
        to: `/browser?dir=${currentFolder.id}`,
      })

      if (currentFolder.parentFolder?.id) {
        currentFolder = folderStore.folders.find(f => f.id === currentFolder?.parentFolder?.id) || undefined
      } else {
        currentFolder = undefined
      }
    }

    if (trail.length === 0 || !trail[0]?.title?.includes('🏠')) {
      trail.unshift({
        title: '🏠 Home',
        to: '/browser?dir=root',
      })
    }
    return trail
  }

  const updateSelectedFolder = () => {
    const dirId = route.query.dir as string || folderStore.selectedFolder?.id || undefined
    if (dirId === 'root') {
      folderStore.selectedFolder = undefined
    } else {
      const foundFolder = folderStore.folders.find(folder => folder.id === dirId)
      if (foundFolder) {
        folderStore.selectedFolder = foundFolder
      } else {
        folderStore.selectedFolder = undefined
      }
    }
    modelsStore.fetchModels({ folderId: folderStore.selectedFolder?.id || undefined })
    controlsStore.fetchControls({ folderId: folderStore.selectedFolder?.id || undefined })
  }

  onMounted(async () => {
    await folderStore.fetchFolders()

    modelsStore.fetchModules()
    controlsStore.fetchMitreAttackMitigations()
    controlsStore.fetchMitreDefendTactics()

    updateSelectedFolder()
    breadcrumbs.value = buildBreadcrumbs(folderStore.selectedFolder)
  })

  watch(() => route.query.dir, () => {
    updateSelectedFolder()
  })

  watch(() => folderStore.selectedFolder, newVal => {
    breadcrumbs.value = buildBreadcrumbs(newVal)
    modelsStore.fetchModels({ folderId: newVal?.id || undefined })
    controlsStore.fetchControls({ folderId: newVal?.id || undefined })
  })

  watch(() => folderStore.folders, () => {
    updateSelectedFolder()
    breadcrumbs.value = buildBreadcrumbs(folderStore.selectedFolder)
  })

  const folders = computed(() => folderStore.folders.filter(folder => folder.parentFolder?.id === folderStore.selectedFolder?.id))

  const deleteFolder = (folder: string) => {
    showDeleteFolderDialog.value = true
  }

  const moveToFolder = (destinationFolderId: string) => {
    if (!destinationFolderId) return
    let parentFolder: Folder | null = null
    if (destinationFolderId === 'root') {
      parentFolder = null
    } else {
      parentFolder = folderStore.folders.find(folder => folder.id === destinationFolderId) || null
    }
    const selectedFolder = folderStore.selectedFolder
    if (selectedFolder) {
      const updatedFolder: Folder = {
        ...selectedFolder,
        parentFolder: parentFolder || undefined,
      }
      folderStore.updateFolder(updatedFolder).then(() => {
        updateSelectedFolder()
        breadcrumbs.value = buildBreadcrumbs(folderStore.selectedFolder)
      })
    }
    showFolderSelectDialog.value = false
  }

  const onMoveItem = (folderId: string) => {
    showControlDialog.value = false
    selectedControlId.value = null
    showModelDialog.value = false
    selectedModelId.value = null

    modelsStore.fetchModels({ folderId })
    controlsStore.fetchControls({ folderId })

    folderStore.selectedFolder = folderStore.folders.find(folder => folder.id === folderId) || undefined
    router.push({ path: '/browser', query: { dir: folderId } })
  }

  const onFolderDelete = () => {
    const parentFolder = folderStore.selectedFolder?.parentFolder
    folderStore.deleteFolder(folderStore.selectedFolder?.id || '')
    if (parentFolder) {
      folderStore.selectedFolder = parentFolder
      router.push({ path: '/browser', query: { dir: parentFolder.id } })
    } else {
      folderStore.selectedFolder = undefined
      router.push({ path: '/browser', query: { dir: 'root' } })
    }
    showDeleteFolderDialog.value = false
  }

  const addModel = () => {
    modelsStore.createModel({
      name: getNewName({
        baseName: 'New Model',
        existingNames: models.value.map(model => model.name),
      }),
      description: 'A new model',
      modules: [],
      folderId: folderStore.selectedFolder?.id || undefined,
    }).then((result: Model | null) => {
      if (result) {
        selectedModelId.value = result.id
        showModelDialog.value = true
      } else {
        snackBar.value = {
          show: true,
          message: `Failed to create model: ${modelsStore.error}`,
          color: 'error',
        }
      }
    })
  }

  const onSaveModel = (success: boolean) => {
    snackBar.value = {
      show: true,
      message: success ? 'Model saved' : 'Failed to save model',
      color: success ? 'success' : 'error',
    }
  }

  const onModelDeleted = (result: boolean) => {
    snackBar.value = {
      show: true,
      message: result ? 'Model deleted successfully' : 'Failed to delete model',
      color: result ? 'success' : 'error',
    }
    showModelDialog.value = false
    selectedModelId.value = null
    modelsStore.fetchModels({ folderId: route.query.dir === 'root' ? undefined : (folderStore.selectedFolder?.id || undefined) })
  }

  function addControl () {
    controlsStore.createControl({
      newControl: {
        id: Math.random().toString(36).substring(2, 15),
        name: getNewName({
          baseName: 'New Control',
          existingNames: controls.value.map(control => control.name || ''),
        }),
        description: 'A new control',
      },
      classIds: [],
      folderId: folderStore.selectedFolder?.id || undefined,
    }).then((result: Control | null) => {
      if (result) {
        selectedControlId.value = result.id || null
        showControlDialog.value = true
      } else {
        snackBar.value = {
          show: true,
          message: 'Failed to create control',
          color: 'error',
        }
      }
    })
  }

  const onControlClosed = () => {
    showControlDialog.value = false
    selectedControlId.value = null
    controlsStore.fetchControls({ 
      folderId: folderStore.selectedFolder?.id || 
      ( route.query.dir === 'root' ? undefined : (route.query.dir as string | undefined)) })
  }

  const onSaveControl = (success: boolean) => {
    snackBar.value = {
      show: true,
      message: success ? 'Control saved' : `Failed to save control ${controlsStore.errors}`,
      color: success ? 'success' : 'error',
    }
    // showControlDialog.value = false
    // selectedControlId.value = null
    // controlsStore.fetchControls({ 
    //   folderId: folderStore.selectedFolder?.id || 
    //   ( route.query.dir === 'root' ? undefined : (route.query.dir as string | undefined)) })
  }

  const onControlDeleted = (result: boolean) => {
    showControlDialog.value = false
    selectedControlId.value = null
    snackBar.value = {
      show: true,
      message: result ? 'Control deleted successfully' : 'Failed to delete control',
      color: result ? 'success' : 'error',
    }
    controlsStore.fetchControls({
      folderId: folderStore.selectedFolder?.id ||
      (route.query.dir === 'root' ? undefined : (route.query.dir as string | undefined)) })
  }

  const redirectToIssue = () => {
    router.push({ path: '/issues' })
  }

  onBeforeRouteLeave(() => {
    modelsStore.resetStore()
  })
</script>

<template>
  <!-- eslint-disable vue/no-lone-template -->
  <!-- eslint-disable vue/attribute-hyphenation -->
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <v-container class="pa-0 ma-0 container" fluid>
    <v-row class="ma-0 folders-row mt-5 mx-10 mb-3">
      <v-col class="pa-0 ma-0" cols="12">
        <v-card
          class="opacity-80 border-thin rounded-lg elevation-11 pa-1 folders"
          color="background"
        >
          <v-card-title>
            <div class="d-flex flex-row justify-space-between">
              <v-breadcrumbs :items="breadcrumbs" />
              <div class="px-2 pb-2">
                <v-btn
                  class="mx-1"
                  color="secondary"
                  elevation="12"
                  icon="mdi-folder-plus-outline"
                  size="x-large"
                  variant="outlined"
                  @click="folderDialogType = 'create'; showFolderDialog = true"
                />
                <v-btn
                  class="mx-1"
                  color="secondary"
                  :disabled="folderStore.selectedFolder === null"
                  elevation="12"
                  icon="mdi-folder-edit-outline"
                  size="x-large"
                  variant="outlined"
                  @click="folderDialogType = 'edit'; showFolderDialog = true"
                />
                <v-btn
                  class="mx-1"
                  color="secondary"
                  :disabled="folderStore.selectedFolder === null"
                  elevation="12"
                  icon="mdi-folder-arrow-right-outline"
                  size="x-large"
                  variant="outlined"
                  @click="showFolderSelectDialog = true"
                />
                <v-btn
                  class="mx-1"
                  color="error"
                  :disabled="folderStore.selectedFolder === null || (folderStore.selectedFolder?.childrenFolders?.length ?? 0) > 0"
                  elevation="12"
                  icon="mdi-trash-can-outline"
                  size="x-large"
                  variant="outlined"
                  @click="deleteFolder(folderStore.selectedFolder?.id || '')"
                />
              </div>
            </div>
            <v-divider />
          </v-card-title>
          <v-card-text>
            <div class="d-flex flex-wrap gap-2 folders-container overflow-y-auto">
              <template
                v-for="folder in folders.slice().sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))"
                :key="folder.id"
              >
                <v-card
                  class="ma-2 pt-1 pb-0 elevation-11 folder-card"
                  color="background"
                  height="80px"
                  rounded="lg"
                  width="150px"
                  @click="router.push({ path: '/browser', query: { dir: folder.id } })"
                >
                  <v-card-title class="ma-0 pa-0">
                    <div class="folder-tab" />
                  </v-card-title>
                  <v-card-text
                    class="pa-0 ma-0"
                  >
                    <v-sheet class="pa-0 pl-0 ma-0 rounded-e-lg d-flex justify-center align-center" color="tertiary" height="80px" variant="plain">
                      <span class="pa-2 ma-0 folder-text">{{ folder.name }}</span>
                    </v-sheet>
                  </v-card-text>
                </v-card>
              </template>
              <v-card
                class="ma-2 pt-1 pb-0 elevation-11 folder-card opacity-50"
                color="background"
                height="80px"
                rounded="lg"
                width="150px"
                @click="folderDialogType = 'create'; showFolderDialog = true"
              >
                <v-card-title class="ma-0 pa-0">
                  <div class="folder-tab" />
                </v-card-title>
                <v-card-text
                  class="pa-0 ma-0"
                >
                  <v-sheet class="pa-0 pt-0 ma-0 rounded-e-lg d-flex justify-center align-center" color="tertiary" height="80px" variant="plain">
                    <v-icon color="primary" size="x-large" variant="outlined">mdi-plus</v-icon>
                  </v-sheet>
                </v-card-text>
              </v-card>
            </div>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
    <v-row class="ma-0 content-row">
      <v-col class="pa-0 ma-0 position-relative" cols="12">
        <div class="position-absolute top-0 right-0 ">
          <v-speed-dial
            location="bottom center"
            transition="fade-transition"
          >
            <template #activator="{ props: activatorProps }">
              <v-fab
                v-bind="activatorProps"
                class="ma-2"
                color="secondary"
                elevation="12"
                icon="mdi-plus"
                size="x-large"
                variant="outlined"
              />
            </template>
            <v-btn
              key="1"
              color="quinary"
              elevation="12"
              icon="mdi-vector-polyline"
              size="x-large"
              variant="outlined"
              @click="addModel"
            />
            <v-btn
              key="2"
              color="quinary"
              elevation="12"
              icon="mdi-shield-sword-outline"
              size="x-large"
              variant="outlined"
              @click="addControl"
            />
            <v-btn
              key="3"
              color="quinary"
              elevation="12"
              icon="mdi-import"
              size="x-large"
              variant="outlined"
              @click="showImportModelDialog = true"
            />
          </v-speed-dial>
        </div>
        <v-sheet
          border="opacity-50 tertiary thin"
          class="d-flex flex-column pa-5 rounded-lg content-container "
          style="background-color: rgba(var(--v-theme-foreground), 0)"
        >
          <!-- Models -->
          <div v-if="models.length > 0" class="d-flex flex-row flex-wrap gap-2">
            <template
              v-for="model in [...models].sort((a, b) => (a.name || '').localeCompare(b.name || ''))"
              :key="model.id"
            >
              <v-card
                border="opacity-100 primary md"
                class="ma-2 opacity-90 rounded-lg elevation-11 pa-0 context-card opacity-90"
                color="surface"
                height="100px"
                rounded="lg"
                width="220px"
                @click="router.push({ path: '/dataflow', query: { id: model.id } })"
                @contextmenu.prevent="selectedModelId = model.id; showModelDialog = true"
              >
                <v-card-title class="ma-0 pa-0">
                  <v-sheet class="pa-1 ma-0 text-body-1" color="primary" density="compact" variant="plain">
                    <v-icon color="tertiary" size="small">mdi-vector-polyline</v-icon>
                    <span class="ml-2 text-body-1">Model</span>
                  </v-sheet>
                </v-card-title>
                <v-card-text class="pa-2 ma-0">
                  <span class="text-body-1">{{ model.name }}</span>
                </v-card-text>
              </v-card>
            </template>
          </div>
          <!-- End Models -->
          <v-divider class="my-2" />

          <!-- Controls -->
          <div v-if="controls.length > 0" class="d-flex flex-row flex-wrap gap-2">
            <template
              v-for="control in [...controls].sort((a, b) => (a.name || '').localeCompare(b.name || ''))"
              :key="control.id"
            >
              <v-card
                border="opacity-100 secondary md"
                class="ma-2 opacity-90 rounded-lg elevation-11 pa-0 context-card opacity-90"
                color="surface"
                height="100px"
                rounded="lg"
                width="220px"
                @click="selectedControlId = control.id || null; showControlDialog = true"
              >
                <v-card-title class="ma-0 pa-0">
                  <v-sheet class="pa-1 ma-0" color="secondary" density="compact" variant="plain">
                    <v-icon color="primary" size="small">mdi-shield-sword-outline</v-icon>
                    <span class="ml-2 text-body-1">Control</span>
                  </v-sheet>
                </v-card-title>
                <v-card-text class="pa-2 ma-0">
                  <span class="text-body-1">{{ control.name }}</span>
                </v-card-text>
              </v-card>
            </template>
          </div>

        </v-sheet>
      </v-col>
    </v-row>
  </v-container>

  <!-- Dialogs -->
  <template>
    <FolderDialog
      v-if="showFolderDialog"
      :folder="folderStore.selectedFolder || undefined"
      :show="showFolderDialog"
      :type="folderDialogType"
      @close="showFolderDialog = false"
      @move="moveToFolder"
    />
  </template>
  <template>
    <ConfirmDeleteDialog
      v-if="showDeleteFolderDialog"
      :message="`Are you sure you want to delete this Folder: ${folderStore.selectedFolder?.name}?`"
      :show="showDeleteFolderDialog"
      @delete:canceled="showDeleteFolderDialog = false"
      @delete:confirmed="onFolderDelete"
    />
  </template>
  <template>
    <FolderSelectDialog
      v-if="showFolderSelectDialog"
      :current-folder-id="folderStore.selectedFolder?.id"
      :show="showFolderSelectDialog"
      @close="showFolderSelectDialog = false"
      @move="moveToFolder"
    />
  </template>

  <!-- Model Dialog -->
  <ModelDialog
    v-if="showModelDialog && selectedModelId !== null"
    :id="selectedModelId ?? ''"
    :show="showModelDialog && selectedModelId !== null"
    :show-file-actions="true"
    @model:closed="showModelDialog = false; selectedModelId = null"
    @model:deleted="onModelDeleted"
    @model:moved="onMoveItem"
    @model:saved="onSaveModel"
    @redirect:issue="redirectToIssue"
  />
  <!-- End Model Dialog -->

  <ImportModelDialog
    v-if="showImportModelDialog"
    :show="showImportModelDialog"
    @update:show="showImportModelDialog = false"
  />

  <!-- Control Dialog -->
  <ControlDialog
    v-if="showControlDialog && selectedControlId !== null"
    :id="selectedControlId ?? ''"
    :show="showControlDialog && selectedControlId !== null"
    :show-file-actions="true"
    @control:closed="onControlClosed"
    @control:deleted="onControlDeleted"
    @control:moved="onMoveItem"
    @control:saved="onSaveControl"
  />

  <!-- End Control Dialog -->
  <v-snackbar v-model="snackBar.show" :color="snackBar.color" timeout="5000" top>
    {{ snackBar.message }}
  </v-snackbar>
</template>

<style scoped>
.folder-text {
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  max-width: 100%;
}

.folders-container {
  height: 200px;
  overflow-y: auto;
}

.content-container {
  height: calc(100vh - 420px);
  overflow-y: auto;
}

.content-row {
  padding: 15px 75px 0px 75px !important;
}
.folder-tab {
  position: absolute;
  top: 0;
  left: 0px;
  width: 60px;
  height: 8px;
  background: rgb(var(--v-theme-tertiary));
  border-radius: 8px 8px 0px 0;
  display: flex;
}
</style>
