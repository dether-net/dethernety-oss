<script setup lang="ts">
  import { ref } from 'vue'
  import { useApolloClient } from '@/plugins/apolloComposable'
  import { DtImportSplit } from '@dethernety/dt-core'
  import type { ImportProgress, ImportSplitResult, Model } from '@dethernety/dt-core'
  import { useFolderStore } from '@/stores/folderStore'
  import { useModelsStore } from '@/stores/modelsStore'
  import { zipToSplitModel } from '@/utils/modelZipUtils'

  interface Props {
    show: boolean
  }

  const props = defineProps<Props>()
  const emits = defineEmits(['update:show', 'import:success'])

  const dialog = ref(props.show)
  const fileInput = ref<HTMLInputElement | null>(null)
  const importedFile = ref<File | null>(null)
  const isImporting = ref(false)
  const importedModel = ref<Model | null>(null)
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

  const handleFileSelected = (event: Event) => {
    const input = event.target as HTMLInputElement
    if (input.files && input.files.length > 0) {
      importedFile.value = input.files[0]
      errorMessages.value = []
      warningMessages.value = []
      successMessage.value = ''
    }
  }

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

      const arrayBuffer = await readFileAsArrayBuffer(importedFile.value)
      const splitModel = zipToSplitModel(new Uint8Array(arrayBuffer))

      const result: ImportSplitResult = await dtImportSplit.importSplitModel(splitModel, {
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
          color="secondary"
          :disabled="!importedFile || isImporting"
          icon="mdi-import"
          :loading="isImporting"
          size="x-large"
          variant="outlined"
          @click="importModel"
        />
        <v-btn
          v-else
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
