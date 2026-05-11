<script setup lang="ts">
  import type { Module } from '@dethernety/dt-core'
  import { formatRelative } from '@/utils/relativeTime'

  // `recentlyResolvedModules` carries module names that just had a successful
  // ConflictResolutionDialog flow — surfaces the "restart dt-ws" hint until
  // the next page load (transient state in the parent).
  const props = defineProps<{
    modules: Module[]
    recentlyResolvedModules?: string[]
  }>()
  const emit = defineEmits<{ 'module-filter-selected': [moduleName: string] }>()

  type PolicyTone = 'info' | 'warning' | 'default'
  type StatusTone = 'success' | 'warning' | 'error' | 'default'

  const policyTone = (policy?: string): PolicyTone => {
    if (policy === 'audit') return 'info'
    if (policy === 'strict') return 'warning'
    return 'default'
  }

  const statusTone = (status?: string): StatusTone => {
    if (status === 'authoritative') return 'success'
    if (status === 'partial' || status === 'unavailable') return 'warning'
    if (status === 'error') return 'error'
    return 'default'
  }

  const conflictsCount = (m: Module): number => m.rebindConflicts?.length ?? 0

  const onConflictsClick = (m: Module) => {
    if (conflictsCount(m) > 0) emit('module-filter-selected', m.name)
  }

  // Drives whether we render the "Never installed" placeholder vs a status chip.
  const hasInstallAttempt = (m: Module) => Boolean(m.lastAttemptedInstall)

  // Surface the restart hint when (a) the operator just resolved this module's
  // conflicts in this session AND (b) the conflict list is now empty (i.e.
  // resolution was effective). Hides itself across a page reload.
  const showRestartHint = (m: Module): boolean => {
    return (
      conflictsCount(m) === 0 &&
      Boolean(props.recentlyResolvedModules?.includes(m.name))
    )
  }
</script>

<template>
  <div class="health-table-div pa-0 rounded-lg elevation-12">
    <v-table density="compact" class="health-table opacity-80">
      <thead>
        <tr>
          <th class="text-left">Module</th>
          <th class="text-left">Policy</th>
          <th class="text-left">Last install</th>
          <th class="text-left">Constraints</th>
          <th class="text-left">Conflicts</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in props.modules" :key="m.id">
          <td>{{ m.name }}</td>
          <td>
            <v-chip
              v-if="m.idRebindPolicy"
              size="small"
              :color="policyTone(m.idRebindPolicy)"
              variant="tonal"
            >
              {{ m.idRebindPolicy }}
            </v-chip>
            <span v-else class="text-disabled">—</span>
          </td>
          <td>
            <template v-if="hasInstallAttempt(m)">
              <v-chip
                size="small"
                :color="statusTone(m.lastInstallStatus)"
                variant="tonal"
              >
                {{ m.lastInstallStatus ?? 'unknown' }}
              </v-chip>
              <span class="ml-2 text-caption text-medium-emphasis">
                {{ formatRelative(m.lastAttemptedInstall) }}
              </span>
            </template>
            <span v-else class="text-disabled">Never installed</span>
          </td>
          <td>
            <v-icon
              v-if="m.constraintsHealthy"
              color="success"
              size="small"
              title="All class-identity constraints in place"
            >mdi-check-circle</v-icon>
            <v-icon
              v-else
              color="warning"
              size="small"
              title="One or more constraints skipped at startup — see dt-ws logs"
            >mdi-alert</v-icon>
          </td>
          <td>
            <v-badge
              v-if="conflictsCount(m) > 0"
              :content="conflictsCount(m)"
              color="error"
              inline
            >
              <v-btn
                size="x-small"
                variant="tonal"
                color="error"
                @click="onConflictsClick(m)"
              >
                View
              </v-btn>
            </v-badge>
            <span v-else-if="showRestartHint(m)" class="text-caption text-warning">
              Restart <code>dt-ws</code> to retry
            </span>
            <span v-else class="text-disabled">—</span>
          </td>
        </tr>
        <tr v-if="props.modules.length === 0">
          <td colspan="5" class="text-center text-disabled py-4">
            No modules available.
          </td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>

<style scoped>
.health-table :deep(th) {
  font-weight: 500;
}

.health-table-div {
  border-width: 1px;
  border-style: solid;
  border-color: rgba(var(--v-theme-quinary), 1);
  background-color: rgba(var(--v-theme-background), 0);
  border-radius: 0;
}
</style>
