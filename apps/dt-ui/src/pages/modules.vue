<script setup lang="ts">
  import { useModulesStore } from '@/stores/modulesStore'

  interface SnackBar {
    show: boolean
    message: string
    color: string
  }

  const modulesStore = useModulesStore()
  const expanded = ref<string[]>([])
  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })

  onMounted(() => {
    modulesStore.fetchModules()
  })

  // Watch for error changes and show snackbar
  watch(() => modulesStore.error, (newError) => {
    if (newError) {
      snackBar.value = {
        show: true,
        message: newError,
        color: 'error'
      }
      modulesStore.clearError()
    }
  })

  // Watch for success message changes and show snackbar
  watch(() => modulesStore.successMessage, (newSuccess) => {
    if (newSuccess) {
      snackBar.value = {
        show: true,
        message: newSuccess,
        color: 'success'
      }
      modulesStore.clearSuccess()
    }
  })

  const saveModule = async (moduleId: string, attributes: string) => {
    const module = await modulesStore.saveModule({ moduleId, attributes })
    if (module) {
      // Optionally reset module after successful save
      await modulesStore.resetModule({ moduleId: module.id })
    }
  }
  
  const resetModule = async (moduleId: string) => {
    await modulesStore.resetModule({ moduleId })
  }

</script>

<template>
  <v-container class="pa-0 ma-0 px-5 " fluid>
    <v-row>
      <v-col cols="12">


        <!-- Loading State -->
        <v-card v-if="modulesStore.isLoading.fetchModules" class="mx-5 mb-2 pa-10 text-center">
          <v-progress-circular indeterminate color="primary" size="64"></v-progress-circular>
          <p class="mt-4">Loading modules...</p>
        </v-card>

        <!-- Modules Content -->
        <v-sheet
          v-else
          border="opacity-50 secondary thin"
          class="mx-5 mt-5 mb-2 pa-10 rounded-lg modules-sheet overflow-y-auto" 
          color="transparent"
        >
          <v-row v-if="modulesStore.modules.length === 0">
            <v-col cols="12" class="text-center">
              <v-icon size="64" color="grey">mdi-package-variant</v-icon>
              <p class="mt-4 text-grey">
                {{ modulesStore.searchQuery ? 'No modules found matching your search.' : 'No modules available.' }}
              </p>
            </v-col>
          </v-row>
          
          <v-row v-else>
            <v-col cols="12">
              <v-expansion-panels v-model="expanded" class="mx-0 px-10 pt-0 elevation-0">
                <v-expansion-panel
                  v-for="module in modulesStore.modules" :key="module.id"
                  class="mb-2 elevation-0 opacity-80 modules-panel"
                  color="background"
                  static
                  :value="module.id"
                >
                  <v-expansion-panel-title
                    class="elevation-12 rounded-lg pa-2 ma-0 modules-panel-title"
                  >
                    <div class="d-flex align-center">
                      {{ module.name }}
                      <v-chip
                        v-if="(module as any).pending"
                        size="small"
                        color="warning"
                        class="ml-2"
                      >
                        Saving...
                      </v-chip>
                    </div>
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <v-row>
                      <v-col cols="12">
                        <ModuleCard
                          class="elevation-0 mt-5"
                          :module="module"
                          @save:module="saveModule"
                          @reset:module="resetModule"
                          :is-saving="modulesStore.isLoading.saveModule || modulesStore.isLoading.resetModule"
                        />
                      </v-col>
                    </v-row>
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>
            </v-col>
          </v-row>
        </v-sheet>
      </v-col>
    </v-row>
  </v-container>

  <!-- Status Snackbar -->
  <v-snackbar v-model="snackBar.show" :color="snackBar.color" timeout="5000" top>
    {{ snackBar.message }}
  </v-snackbar>
</template>

<style scoped>
.modules-panel {
  background-color: rgba(var(--v-theme-background), 0);
  border-width: 0;
}

.modules-panel * {
  box-shadow: none;
}

.modules-panel-title {
  border-width: 1px;
  border-style: solid;
  border-color: rgba(var(--v-theme-quinary), 1);
  background-color: rgba(var(--v-theme-background), 0);
  border-radius: 0;
}

.modules-sheet {
  height: calc(100vh - 100px);
}

</style>