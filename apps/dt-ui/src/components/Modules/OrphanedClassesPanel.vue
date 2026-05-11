<script setup lang="ts">
  import type { Module, OrphanedClass, TypeCount } from '@dethernety/dt-core'
  import { formatRelative } from '@/utils/relativeTime'

  const props = defineProps<{ modules: Module[] }>()

  // Each kind carries the GraphQL classKind label too — the admin mutations
  // need the label (e.g. "AnalysisClass") to dispatch.
  const KINDS: Array<{ key: keyof Module; label: string; classKind: string }> = [
    { key: 'orphanedComponentClasses', label: 'Component classes', classKind: 'ComponentClass' },
    { key: 'orphanedDataFlowClasses', label: 'Data-flow classes', classKind: 'DataFlowClass' },
    { key: 'orphanedSecurityBoundaryClasses', label: 'Security-boundary classes', classKind: 'SecurityBoundaryClass' },
    { key: 'orphanedControlClasses', label: 'Control classes', classKind: 'ControlClass' },
    { key: 'orphanedDataClasses', label: 'Data classes', classKind: 'DataClass' },
    { key: 'orphanedAnalysisClasses', label: 'Analysis classes', classKind: 'AnalysisClass' },
    { key: 'orphanedIssueClasses', label: 'Issue classes', classKind: 'IssueClass' }
  ]

  type GroupedRow = OrphanedClass & { moduleName: string; classKind: string }

  // Flatten all modules' orphans for a given kind, tagging with moduleName so
  // operators can see provenance without drilling into each module.
  const orphansByKind = computed<Record<string, GroupedRow[]>>(() => {
    const out: Record<string, GroupedRow[]> = {}
    for (const { key, classKind } of KINDS) {
      const rows: GroupedRow[] = []
      for (const m of props.modules) {
        const orphans = (m as any)[key] as OrphanedClass[] | undefined
        if (!orphans) continue
        for (const o of orphans) rows.push({ ...o, moduleName: m.name, classKind })
      }
      out[key as string] = rows
    }
    return out
  })

  const totalCount = computed(() =>
    Object.values(orphansByKind.value).reduce((sum, rows) => sum + rows.length, 0)
  )

  const countTone = (n: number): string => {
    if (n === 0) return 'default'
    if (n <= 800) return 'info'
    if (n <= 1000) return 'warning'
    return 'error'
  }

  const emit = defineEmits<{
    'revive-orphan': [{ classId: string; classKind: string }]
    'delete-orphan': [{
      id: string
      name: string
      kind: string
      incomingInstanceCount: number
      incomingInstancesByType: TypeCount[]
    }]
  }>()

  const onRevive = (row: GroupedRow) => {
    emit('revive-orphan', { classId: row.id, classKind: row.classKind })
  }

  const onDelete = (row: GroupedRow) => {
    emit('delete-orphan', {
      id: row.id,
      name: row.name,
      kind: row.classKind,
      incomingInstanceCount: row.incomingInstanceCount,
      incomingInstancesByType: row.incomingInstancesByType ?? []
    })
  }
</script>

<template>
  <v-expansion-panels variant="accordion">
    <v-expansion-panel class="rounded-lg elevation-12 opacity-80">
      <v-expansion-panel-title class="elevation-0" color="primary">
        <div class="d-flex align-center w-100">
          <v-icon class="mr-2" size="small">mdi-ghost-outline</v-icon>
          <span>Orphaned classes</span>
          <v-chip
            class="ml-2"
            size="small"
            :color="totalCount > 0 ? 'warning' : 'default'"
            variant="tonal"
          >
            {{ totalCount }}
          </v-chip>
        </div>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <p v-if="totalCount === 0" class="text-disabled mb-0 py-2">
          No orphaned classes. All module-declared classes are active.
        </p>
        <template v-else>
          <div
            v-for="kind in KINDS"
            :key="String(kind.key)"
            class="mb-4"
          >
            <template v-if="orphansByKind[kind.key as string].length > 0">
              <h4 class="text-subtitle-2 font-weight-medium mb-2">
                {{ kind.label }}
                <span class="text-caption text-medium-emphasis">
                  ({{ orphansByKind[kind.key as string].length }})
                </span>
              </h4>
              <v-table density="compact">
                <thead>
                  <tr>
                    <th class="text-left">Module</th>
                    <th class="text-left">Class</th>
                    <th class="text-left">Orphaned</th>
                    <th class="text-left">Incoming instances</th>
                    <th class="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in orphansByKind[kind.key as string]" :key="row.id">
                    <td class="text-medium-emphasis">{{ row.moduleName }}</td>
                    <td><code>{{ row.name }}</code></td>
                    <td>
                      <span v-if="row.orphanedAt">{{ formatRelative(row.orphanedAt) }}</span>
                      <span v-else class="text-disabled">unknown</span>
                    </td>
                    <td>
                      <v-chip
                        size="small"
                        :color="countTone(row.incomingInstanceCount)"
                        variant="tonal"
                      >
                        {{ row.incomingInstanceCount }}
                      </v-chip>
                    </td>
                    <td class="text-right">
                      <v-btn
                        class="mr-2"
                        color="success"
                        prepend-icon="mdi-restore"
                        size="x-small"
                        variant="tonal"
                        @click="onRevive(row)"
                      >
                        Revive
                      </v-btn>
                      <v-btn
                        color="error"
                        prepend-icon="mdi-delete-outline"
                        size="x-small"
                        variant="tonal"
                        @click="onDelete(row)"
                      >
                        Delete…
                      </v-btn>
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </template>
          </div>
        </template>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>
