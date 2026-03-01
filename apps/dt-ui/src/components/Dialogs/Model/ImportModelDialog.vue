<script setup lang="ts">
  import { ref } from 'vue'
  import { useApolloClient } from '@vue/apollo-composable'
  import { DtImport, ImportProgress, ImportResult } from '@dethernety/dt-core'
  import { useFolderStore } from '@/stores/folderStore'

  interface Props {
    show: boolean
  }



  const props = defineProps<Props>()
  const emits = defineEmits(['update:show'])

  const dialog = ref(props.show)
  const fileInput = ref<HTMLInputElement | null>(null)
  const importedFile = ref<File | null>(null)
  const isImporting = ref(false)
  const errorMessages = ref<string[]>([])
  const warningMessages = ref<string[]>([])
  const successMessage = ref('')
  const importProgress = ref<ImportProgress>({
    currentStep: 0,
    totalSteps: 7,
    stepName: 'Ready to import',
    percentage: 0
  })

  const { client } = useApolloClient()
  const folderStore = useFolderStore()
  const dtImport = new DtImport(client!)

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

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result)
        } else {
          reject(new Error('File could not be read as text'))
        }
      }
      reader.onerror = () => {
        reject(reader.error)
      }
      reader.readAsText(file)
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

      // Read and parse the file
      const content = await readFileAsText(importedFile.value)
      const importData = JSON.parse(content)

      // Use the new DtImport class
      const result: ImportResult = await dtImport.importModel(importData, {
        folderId: folderStore.selectedFolder?.id,
        onProgress: onProgressUpdate
      })

      if (result.success) {
        successMessage.value = 'Model imported successfully!'
        if (result.warnings.length > 0) {
          warningMessages.value = result.warnings
        }
        setTimeout(() => {
          handleClose()
        }, 10000)
      } else {
        errorMessages.value = result.errors.map(err => `${err.step}: ${err.error}`)
        if (result.warnings.length > 0) {
          warningMessages.value = result.warnings
        }
      }

    } catch (error) {
      console.error('Error importing model:', error)
      if (error instanceof SyntaxError) {
        errorMessages.value = ['Invalid JSON format in import file']
      } else {
        errorMessages.value = [error instanceof Error ? error.message : 'An error occurred during import']
      }
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
        <p class="mb-4">Select a JSON file to import a previously exported model.</p>

        <div class="d-flex align-center mb-4">
          <v-btn
            class="mr-2"
            color="primary"
            :disabled="isImporting"
            @click="triggerFileInput"
          >
            Select File
          </v-btn>

          <input
            ref="fileInput"
            accept=".json"
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
          color="secondary"
          :disabled="!importedFile || isImporting"
          icon="mdi-import"
          :loading="isImporting"
          size="x-large"
          variant="outlined"
          @click="importModel"
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
