<script setup lang="ts">
  import { computed, ref, shallowRef } from 'vue'
  import { useApolloClient } from '@/plugins/apolloComposable'
  import { DtImportSplit, DtModel } from '@dethernety/dt-core'
  import type { ImportProgress, ImportSplitResult, Model, SplitModel } from '@dethernety/dt-core'
  import { useFolderStore } from '@/stores/folderStore'
  import { useModelsStore } from '@/stores/modelsStore'
  import { zipToSplitModel } from '@/utils/modelZipUtils'
  import { suggestModelName } from '@/utils/modelNameUtils'

  interface Props {
    show: boolean
  }

  const props = defineProps<Props>()
  const emits = defineEmits(['update:show', 'import:success'])

  const dialog = ref(props.show)
  const fileInput = ref<HTMLInputElement | null>(null)
  // Held as is, never wrapped, so a read can tell whether its file is still the chosen one.
  const importedFile = shallowRef<File | null>(null)
  const isImporting = ref(false)
  const importedModel = ref<Model | null>(null)
  // The archive read once a file is chosen, and the name the model will be imported under: the archive's, or the
  // next free "<name> (n)" when the folder it lands in already holds a model of that name. The user may change it.
  const splitModel = ref<SplitModel | null>(null)
  const modelName = ref('')
  const archiveName = ref('')
  const archiveNameTaken = ref(false)
  // Set when the folder's models could not be listed, so the name could not be told apart from one already there.
  const folderCheckFailed = ref(false)
  // While the chosen file is still being read there is no name to import it under yet, so Import waits.
  const readingArchive = ref(false)
  const errorMessages = ref<string[]>([])
  const warningMessages = ref<string[]>([])
  const successMessage = ref('')
  const importProgress = ref<ImportProgress>({
    currentStep: 0,
    totalSteps: 8,
    stepName: 'Ready to import',
    percentage: 0
  })

  const { client } = useApolloClient()
  const folderStore = useFolderStore()
  const modelsStore = useModelsStore()
  const dtImportSplit = new DtImportSplit(client!)
  const dtModel = new DtModel(client!)

  const onProgressUpdate = (progress: ImportProgress) => {
    importProgress.value = progress
  }

  const handleClose = () => {
    dialog.value = false
    emits('update:show', false)
  }

  const triggerFileInput = () => {
    fileInput.value?.click()
  }

  const handleFileSelected = async (event: Event) => {
    const input = event.target as HTMLInputElement
    if (input.files && input.files.length > 0) {
      const file = input.files[0]
      importedFile.value = file
      errorMessages.value = []
      warningMessages.value = []
      successMessage.value = ''
      splitModel.value = null
      modelName.value = ''
      archiveName.value = ''
      archiveNameTaken.value = false
      folderCheckFailed.value = false
      readingArchive.value = true
      try {
        // A file chosen after this one, while this one was still being read, wins: each await checks it still is.
        const archive = zipToSplitModel(new Uint8Array(await readFileAsArrayBuffer(file)))
        if (importedFile.value !== file) return
        splitModel.value = archive
        archiveName.value = archive.manifest.model?.name ?? ''
        // Only the folder the model lands in counts: the same name elsewhere tells the two apart already.
        const inFolder = await dtModel.getModels({ folderId: folderStore.selectedFolder?.id })
        if (importedFile.value !== file) return
        modelName.value = suggestModelName(archiveName.value, inFolder.map(m => m.name ?? ''))
        archiveNameTaken.value = modelName.value !== archiveName.value.trim()
      } catch (error) {
        if (importedFile.value !== file) return
        console.error('Error reading model archive:', error)
        modelName.value = archiveName.value
        if (!splitModel.value) {
          errorMessages.value = [error instanceof Error ? error.message : 'The file could not be read as a model archive']
        } else {
          // The archive was read; only the folder lookup failed, so the name is the archive's, unchecked.
          folderCheckFailed.value = true
        }
      } finally {
        if (importedFile.value === file) readingArchive.value = false
      }
    }
  }

  const nameHint = computed(() => {
    if (folderCheckFailed.value) return "Couldn't check this folder for a model of the same name, so this name may already be in use. You can change it."
    if (archiveNameTaken.value) return `This folder already has a model named “${archiveName.value.trim()}”, so the import is named apart. You can change the name.`
    return ''
  })

  const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result)
        } else {
          reject(new Error('File could not be read as binary'))
        }
      }
      reader.onerror = () => {
        reject(reader.error)
      }
      reader.readAsArrayBuffer(file)
    })
  }

  const importModel = async () => {
    if (!importedFile.value) {
      errorMessages.value = ['Please select a file to import']
      return
    }

    try {
      isImporting.value = true
      errorMessages.value = []
      warningMessages.value = []
      successMessage.value = ''

      const archive = splitModel.value ?? zipToSplitModel(new Uint8Array(await readFileAsArrayBuffer(importedFile.value)))
      const name = modelName.value.trim()
      if (!name) {
        errorMessages.value = ['Please give the model a name']
        return
      }
      // The model is imported under the chosen name; the archive itself is left as it was.
      const named: SplitModel = { ...archive, manifest: { ...archive.manifest, model: { ...archive.manifest.model, name } } }

      const result: ImportSplitResult = await dtImportSplit.importSplitModel(named, {
        folderId: folderStore.selectedFolder?.id,
        onProgress: onProgressUpdate
      })

      if (result.success) {
        successMessage.value = 'Model imported successfully!'
        importedModel.value = result.model || null
        if (result.warnings.length > 0) {
          warningMessages.value = result.warnings
        }
        await modelsStore.fetchModels({
          folderId: folderStore.selectedFolder?.id
        })
        emits('import:success', result.model?.id)
      } else {
        errorMessages.value = result.errors.map(err => `${err.step}: ${err.error}`)
        if (result.warnings.length > 0) {
          warningMessages.value = result.warnings
        }
      }

    } catch (error) {
      console.error('Error importing model:', error)
      errorMessages.value = [error instanceof Error ? error.message : 'An error occurred during import']
    } finally {
      isImporting.value = false
    }
  }
</script>

<template>
  <v-dialog
    v-model="dialog"
    aria-label="Import model"
    max-width="500"
    @click:outside="handleClose"
    @keydown.esc="handleClose"
    @update:model-value="handleClose"
  >
    <v-card class="pa-0 ma-0 rounded-lg">
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="tertiary" size="small">mdi-import</v-icon>
            <span class="ml-2 text-body-1">Import Model</span>
          </div>
          <v-btn
            v-tooltip:bottom="'Close'"
            aria-label="Close"
            color="foreground"
            icon="mdi-close"
            size="medium"
            variant="text"
            @click="handleClose"
          />
        </v-sheet>
      </v-card-title>
      <v-card-text>
        <p class="mb-4">Select a ZIP archive to import a previously exported model.</p>

        <div class="d-flex align-center mb-4">
          <v-btn
            class="mr-2"
            color="primary"
            :disabled="isImporting || !!importedModel"
            @click="triggerFileInput"
          >
            Select File
          </v-btn>

          <input
            ref="fileInput"
            accept=".zip"
            style="display: none"
            type="file"
            @change="handleFileSelected"
          >

          <span v-if="importedFile" class="text-body-1">
            {{ importedFile.name }}
          </span>
          <span v-else class="text-body-2 text-medium-emphasis">
            No file selected
          </span>
        </div>

        <v-text-field
          v-if="splitModel"
          v-model="modelName"
          class="mb-2"
          density="compact"
          :disabled="isImporting || !!importedModel"
          :hint="nameHint"
          label="Model name"
          persistent-hint
          :rules="[(v: string) => !!v?.trim() || 'A name is required']"
          variant="outlined"
        />

        <v-alert
          v-if="errorMessages.length > 0"
          class="mb-4"
          dismissible
          type="error"
        >
          <div v-for="(error, index) in errorMessages" :key="index">
            {{ error }}
          </div>
        </v-alert>

        <v-alert
          v-if="warningMessages.length > 0"
          class="mb-4"
          dismissible
          type="warning"
        >
          <div v-for="(warning, index) in warningMessages" :key="index">
            {{ warning }}
          </div>
        </v-alert>

        <v-alert
          v-if="successMessage"
          class="mb-4"
          dismissible
          type="success"
        >
          {{ successMessage }}
        </v-alert>

        <v-progress-linear
          v-if="isImporting"
          class="mb-3"
          color="primary"
          :model-value="importProgress.percentage"
        />

        <div v-if="isImporting" class="text-center mb-4">
          {{ importProgress.stepName }} ({{ importProgress.currentStep }} of {{ importProgress.totalSteps }})
        </div>
      </v-card-text>

      <v-card-actions class="py-4 px-6">
        <v-btn
          v-if="!importedModel"
          v-tooltip:top="'Import'"
          aria-label="Import"
          color="secondary"
          :disabled="!importedFile || readingArchive || isImporting || (!!splitModel && !modelName.trim())"
          icon="mdi-import"
          :loading="isImporting"
          size="x-large"
          variant="outlined"
          @click="importModel"
        />
        <v-btn
          v-else
          v-tooltip:top="'Close'"
          aria-label="Close"
          color="secondary"
          icon="mdi-close"
          size="x-large"
          variant="outlined"
          @click="handleClose"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.v-card-title {
  font-size: 1.5rem;
}
</style>
