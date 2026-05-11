<script setup lang="ts">
  import { useModulesStore } from '@/stores/modulesStore'
  import { useClassIdentityStore } from '@/stores/classIdentityStore'
  import { useAuthStore } from '@/stores/authStore'
  import type { Module, TypeCount } from '@dethernety/dt-core'

  interface SnackBar {
    show: boolean
    message: string
    color: string
  }

  // Props for CascadeDeleteDialog — emitted from OrphanedClassesPanel.
  interface DeleteTarget {
    id: string
    name: string
    kind: string
    incomingInstanceCount: number
    incomingInstancesByType: TypeCount[]
  }

  const modulesStore = useModulesStore()
  const classIdentityStore = useClassIdentityStore()
  const authStore = useAuthStore()

  const expanded = ref<string[]>([])
  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })
  const tab = ref<'config' | 'ops'>('config')
  const opsLoaded = ref(false)
  const eventsPollingEnabled = ref(false)
  let eventsPollTimer: ReturnType<typeof setInterval> | null = null

  const isAdmin = computed(() => authStore.hasRole('admin'))

  onMounted(() => {
    modulesStore.fetchModules()
  })

  watch(() => modulesStore.error, (newError) => {
    if (newError) {
      snackBar.value = { show: true, message: newError, color: 'error' }
      modulesStore.clearError()
    }
  })

  watch(() => modulesStore.successMessage, (newSuccess) => {
    if (newSuccess) {
      snackBar.value = { show: true, message: newSuccess, color: 'success' }
      modulesStore.clearSuccess()
    }
  })

  watch(() => classIdentityStore.error, (newError) => {
    if (newError) {
      snackBar.value = { show: true, message: newError, color: 'error' }
      classIdentityStore.clearError()
    }
  })

  // First-time Operations tab open: fetch admin-augmented modules + events.
  watch(tab, async (current) => {
    if (current === 'ops' && isAdmin.value && !opsLoaded.value) {
      opsLoaded.value = true
      await Promise.all([
        modulesStore.fetchModulesWithIdentity({ force: true }),
        classIdentityStore.fetchEvents()
      ])
    }
  })

  const refreshOps = async () => {
    await Promise.all([
      modulesStore.fetchModulesWithIdentity({ force: true }),
      classIdentityStore.fetchEvents()
    ])
  }

  // Polling lifecycle for events: 10s when enabled, paused on hidden tab.
  const startEventsPolling = () => {
    stopEventsPolling()
    eventsPollTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && tab.value === 'ops') {
        classIdentityStore.fetchEvents()
      }
    }, 10000)
  }

  const stopEventsPolling = () => {
    if (eventsPollTimer) {
      clearInterval(eventsPollTimer)
      eventsPollTimer = null
    }
  }

  watch(eventsPollingEnabled, (enabled) => {
    if (enabled) startEventsPolling()
    else stopEventsPolling()
  })

  const handleVisibilityChange = () => {
    // Visibility-change handler is a no-op beyond polling — the interval's
    // own visibilityState check skips the fetch when hidden.
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onUnmounted(() => {
    stopEventsPolling()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  const onModuleFilterSelected = (moduleName: string) => {
    classIdentityStore.setModuleFilter(moduleName)
    classIdentityStore.fetchEvents()
  }

  // ---- Destructive-action wiring ----------------------------------------
  // Three dialog hosts; each opened from a child component's emitted event.
  // The child re-fetch happens inside each store action, so on close we
  // just clear the open flag.

  const conflictDialogOpen = ref(false)
  const conflictDialogModule = ref<Module | null>(null)

  const cascadeDeleteOpen = ref(false)
  const cascadeDeleteTarget = ref<DeleteTarget | null>(null)

  // Module names whose conflicts were just resolved this session — drives the
  // "Restart dt-ws to retry" hint in ModuleHealthTable. Transient by design;
  // resets on page reload.
  const recentlyResolvedModules = ref<string[]>([])

  const openConflictDialog = (module: Module) => {
    conflictDialogModule.value = module
    conflictDialogOpen.value = true
  }

  const closeConflictDialog = () => {
    conflictDialogOpen.value = false
    conflictDialogModule.value = null
  }

  const onConflictResolved = () => {
    if (
      conflictDialogModule.value &&
      !recentlyResolvedModules.value.includes(conflictDialogModule.value.name)
    ) {
      recentlyResolvedModules.value.push(conflictDialogModule.value.name)
    }
  }

  const openCascadeDelete = (target: DeleteTarget) => {
    cascadeDeleteTarget.value = target
    cascadeDeleteOpen.value = true
  }

  const closeCascadeDelete = () => {
    cascadeDeleteOpen.value = false
    cascadeDeleteTarget.value = null
  }

  const onReviveOrphan = async (args: { classId: string; classKind: string }) => {
    try {
      await modulesStore.reviveOrphanedClass(args)
    } catch {
      // Snackbar surfaces via the store's error → watcher above.
    }
  }

  const saveModule = async (moduleId: string, attributes: string) => {
    const module = await modulesStore.saveModule({ moduleId, attributes })
    if (module) {
      await modulesStore.resetModule({ moduleId: module.id })
    }
  }

  const resetModule = async (moduleId: string) => {
    await modulesStore.resetModule({ moduleId })
  }
</script>

<template>
  <v-container class="pa-0 ma-0 px-5" fluid>
    <v-row>
      <v-col cols="12">

        <!-- Loading State -->
        <v-card v-if="modulesStore.isLoading.fetchModules" class="mx-5 mb-2 pa-10 text-center">
          <v-progress-circular indeterminate color="primary" size="64" />
          <p class="mt-4">Loading modules...</p>
        </v-card>

        <!-- Modules Content -->
        <v-sheet
          v-else
          border="opacity-50 secondary thin"
          class="mx-5 mt-5 mb-2 pa-0 rounded-lg modules-sheet overflow-y-auto"
          color="transparent"
        >
          <v-tabs v-model="tab" color="secondary" align-tabs="start" class="px-5 pt-3">
            <v-tab value="config" prepend-icon="mdi-tune-vertical">Configuration</v-tab>
            <v-tab value="ops" prepend-icon="mdi-shield-key-outline">
              Operations
              <v-chip size="x-small" color="secondary" variant="tonal" class="ml-2">Admin</v-chip>
            </v-tab>
          </v-tabs>

          <v-tabs-window v-model="tab">

            <!-- Tab 1: Configuration (existing module-attribute editing) -->
            <v-tabs-window-item value="config" class="pa-10 pt-5">
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
                      <v-expansion-panel-title class="elevation-12 rounded-lg pa-2 ma-0 modules-panel-title">
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
            </v-tabs-window-item>

            <!-- Tab 2: Operations (admin diagnostic surface) -->
            <v-tabs-window-item value="ops" class="pa-10 pt-5">
              <v-row v-if="!isAdmin">
                <v-col cols="12">
                  <v-alert type="info" variant="tonal" border="start">
                    <p class="mb-1 font-weight-medium">Operations requires admin role</p>
                    <p class="text-body-2 mb-0">
                      Module install diagnostics, orphaned class cleanup, and identity events.
                      Ask your administrator for access if you need this surface.
                    </p>
                  </v-alert>
                </v-col>
              </v-row>

              <template v-else>
                <v-row class="mb-2">
                  <v-col cols="12" class="d-flex align-center">
                    <v-btn
                      size="small"
                      color="secondary"
                      variant="tonal"
                      prepend-icon="mdi-refresh"
                      :loading="modulesStore.isLoading.fetchModulesWithIdentity || classIdentityStore.isLoading"
                      @click="refreshOps"
                    >
                      Refresh
                    </v-btn>
                    <v-spacer />
                  </v-col>
                </v-row>

                <BlockedInstallsBanner
                  :modules="modulesStore.modules"
                  class="mb-4"
                  @review-conflicts="openConflictDialog"
                />

                <v-row>
                  <v-col cols="12">
                    <h3 class="text-subtitle-1 font-weight-medium mb-2">Module health</h3>
                    <ModuleHealthTable
                      :modules="modulesStore.modules"
                      :recently-resolved-modules="recentlyResolvedModules"
                      @module-filter-selected="onModuleFilterSelected"
                    />
                  </v-col>
                </v-row>

                <v-row>
                  <v-col cols="12">
                    <OrphanedClassesPanel
                      :modules="modulesStore.modules"
                      @revive-orphan="onReviveOrphan"
                      @delete-orphan="openCascadeDelete"
                    />
                  </v-col>
                </v-row>

                <v-row>
                  <v-col cols="12">
                    <IdentityEventTimeline
                      v-model:polling-enabled="eventsPollingEnabled"
                      @request-refresh="classIdentityStore.fetchEvents()"
                    />
                  </v-col>
                </v-row>

                <v-row>
                  <v-col cols="12">
                    <v-expansion-panels variant="accordion">
                      <IdentityMigrationPanel />
                    </v-expansion-panels>
                  </v-col>
                </v-row>
              </template>
            </v-tabs-window-item>
          </v-tabs-window>
        </v-sheet>
      </v-col>
    </v-row>
  </v-container>

  <!-- Admin destructive-action dialogs -->
  <ConflictResolutionDialog
    :show="conflictDialogOpen"
    :module="conflictDialogModule"
    @close="closeConflictDialog"
    @resolved="onConflictResolved"
  />
  <CascadeDeleteDialog
    :show="cascadeDeleteOpen"
    :target-class="cascadeDeleteTarget"
    @close="closeCascadeDelete"
    @deleted="closeCascadeDelete"
  />

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
