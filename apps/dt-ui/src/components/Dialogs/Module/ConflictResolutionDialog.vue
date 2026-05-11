<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import type { Module, RebindConflictDetail } from '@dethernety/dt-core'
  import { useModulesStore } from '@/stores/modulesStore'

  // Operator-facing dialog for resolving strict-mode rebind conflicts.
  // State machine per operator-ux-spec.md §2:
  //   idle → aligning → all-success | partial-success | error
  // Each row has its own direction (adopt module id ↔ keep DB id) and
  // its own outcome — the loop executes them serially so failures surface
  // individually and a cancel mid-flight only stops the next call (the
  // in-flight one always completes).

  interface Props {
    show: boolean
    module: Module | null
  }

  const props = defineProps<Props>()
  const emit = defineEmits<{
    close: []
    resolved: []
  }>()

  const modulesStore = useModulesStore()

  type Direction = 'adopt-module-id' | 'keep-db-id'
  type RowOutcome = 'pending' | 'aligning' | 'done' | 'failed'

  interface Row {
    detail: RebindConflictDetail
    direction: Direction
    outcome: RowOutcome
    errorMessage: string | null
  }

  type DialogState = 'idle' | 'aligning' | 'all-success' | 'partial-success' | 'error'

  const dialogState = ref<DialogState>('idle')
  const rows = ref<Row[]>([])
  const cancelRequested = ref(false)

  // (Re)build rows whenever the dialog is opened or the module changes.
  // Default direction is "adopt-module-id" — the recommended workflow per
  // operator-ux-spec.md §2 (the module is the source of truth).
  const buildRows = () => {
    const conflicts = props.module?.rebindConflicts ?? []
    rows.value = conflicts.map((detail) => ({
      detail,
      direction: 'adopt-module-id',
      outcome: 'pending',
      errorMessage: null
    }))
    dialogState.value = 'idle'
    cancelRequested.value = false
  }

  watch(
    () => props.show,
    (open) => {
      if (open) buildRows()
    },
    { immediate: true }
  )

  const totalRows = computed(() => rows.value.length)
  const doneRows = computed(() => rows.value.filter((r) => r.outcome === 'done').length)
  const failedRows = computed(() => rows.value.filter((r) => r.outcome === 'failed'))

  const resolveBatch = async (targets: Row[]) => {
    if (!props.module || targets.length === 0) return
    cancelRequested.value = false
    dialogState.value = 'aligning'

    for (const row of targets) {
      if (cancelRequested.value) break
      row.outcome = 'aligning'
      row.errorMessage = null
      try {
        const newId =
          row.direction === 'adopt-module-id'
            ? row.detail.moduleDeclaredId
            : row.detail.dbId
        if (row.direction === 'keep-db-id') {
          // No-op for the operator's mental model: the DB id is already
          // correct from the DB's POV. Mark done without a server call.
          row.outcome = 'done'
          continue
        }
        await modulesStore.migrateClassId({
          moduleName: props.module.name,
          className: row.detail.className,
          classKind: row.detail.classKind,
          newId
        })
        row.outcome = 'done'
      } catch (err) {
        row.outcome = 'failed'
        row.errorMessage = (err as Error).message ?? 'Unknown error'
      }
    }

    const failed = rows.value.filter((r) => r.outcome === 'failed').length
    const done = rows.value.filter((r) => r.outcome === 'done').length
    if (failed === 0) dialogState.value = 'all-success'
    else if (done > 0) dialogState.value = 'partial-success'
    else dialogState.value = 'error'

    if (failed === 0) emit('resolved')
  }

  const alignAll = () => resolveBatch(rows.value.filter((r) => r.outcome === 'pending'))
  const retryFailed = () => {
    failedRows.value.forEach((r) => {
      r.outcome = 'pending'
      r.errorMessage = null
    })
    resolveBatch(failedRows.value)
  }

  const cancel = () => {
    if (dialogState.value === 'aligning') {
      // Soft cancel — current in-flight call completes; the loop stops
      // before issuing the next mutation. Already-aligned rows stay aligned.
      cancelRequested.value = true
      return
    }
    emit('close')
  }

  const close = () => emit('close')

  const showDialog = computed({
    get: () => props.show,
    set: (val) => {
      if (!val) emit('close')
    }
  })

  const directionOptions: Array<{ value: Direction; label: string; subtitle: string }> = [
    {
      value: 'adopt-module-id',
      label: 'Adopt module id',
      subtitle: 'Recommended — align DB to what the module declares.'
    },
    {
      value: 'keep-db-id',
      label: 'Keep DB id',
      subtitle: 'Skip — keeps the DB id as-is (module install will keep failing for this class).'
    }
  ]
</script>

<template>
  <v-dialog v-model="showDialog" max-width="780" persistent>
    <v-card v-if="module">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="warning">mdi-alert-decagram-outline</v-icon>
        <span>Resolve rebind conflicts — {{ module.name }}</span>
        <v-spacer />
        <v-btn
          v-if="dialogState !== 'aligning'"
          icon="mdi-close"
          size="small"
          variant="text"
          @click="close"
        />
      </v-card-title>

      <v-card-subtitle>
        Each row was blocked by strict-mode rebind during install. Pick a
        direction per row and click <strong>Align all</strong>.
      </v-card-subtitle>

      <v-card-text>
        <v-alert
          v-if="dialogState === 'all-success' || (dialogState === 'partial-success' && doneRows > 0)"
          class="mb-4"
          color="success"
          density="compact"
          icon="mdi-restart-alert"
          variant="tonal"
        >
          <strong>Restart <code>dt-ws</code> to apply the alignments and re-attempt the install.</strong>
          Modules load at startup — re-install is not currently triggerable from the UI.
        </v-alert>

        <v-alert
          v-if="dialogState === 'partial-success'"
          class="mb-4"
          color="warning"
          density="compact"
          icon="mdi-alert"
          variant="tonal"
        >
          {{ failedRows.length }} of {{ totalRows }} rows failed. Click
          <strong>Retry {{ failedRows.length }} failed</strong> below to re-attempt.
        </v-alert>

        <v-alert
          v-if="dialogState === 'error'"
          class="mb-4"
          color="error"
          density="compact"
          icon="mdi-close-circle"
          variant="tonal"
        >
          All {{ totalRows }} rows failed. See per-row messages.
        </v-alert>

        <div v-if="totalRows === 0" class="text-center text-disabled py-6">
          No conflicts to resolve.
        </div>

        <v-list v-else density="compact" lines="three">
          <v-list-item
            v-for="(row, idx) in rows"
            :key="idx"
            :class="{
              'bg-grey-lighten-4': row.outcome === 'pending',
              'bg-blue-lighten-5': row.outcome === 'aligning',
              'bg-green-lighten-5': row.outcome === 'done',
              'bg-red-lighten-5': row.outcome === 'failed'
            }"
          >
            <v-list-item-title>
              <v-chip
                :color="row.outcome === 'failed' ? 'error' : row.outcome === 'done' ? 'success' : 'default'"
                class="mr-2"
                size="x-small"
                variant="tonal"
              >
                {{ row.detail.classKind }}
              </v-chip>
              <code>{{ row.detail.className }}</code>
              <v-chip v-if="row.outcome === 'aligning'" class="ml-2" color="info" size="x-small" variant="tonal">
                aligning…
              </v-chip>
              <v-chip v-else-if="row.outcome === 'done'" class="ml-2" color="success" size="x-small" variant="tonal">
                ✓ done
              </v-chip>
              <v-chip v-else-if="row.outcome === 'failed'" class="ml-2" color="error" size="x-small" variant="tonal">
                ✗ failed
              </v-chip>
            </v-list-item-title>
            <v-list-item-subtitle>
              <span class="text-medium-emphasis">DB:</span> <code>{{ row.detail.dbId }}</code>
              &nbsp;→&nbsp;
              <span class="text-medium-emphasis">Module:</span> <code>{{ row.detail.moduleDeclaredId }}</code>
              <div v-if="row.errorMessage" class="text-caption text-error mt-1">
                {{ row.errorMessage }}
              </div>
            </v-list-item-subtitle>
            <template #append>
              <v-radio-group
                v-model="row.direction"
                :disabled="dialogState === 'aligning' || row.outcome === 'done'"
                density="compact"
                hide-details
                inline
              >
                <v-radio
                  v-for="opt in directionOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :title="opt.subtitle"
                  :value="opt.value"
                />
              </v-radio-group>
            </template>
          </v-list-item>
        </v-list>
      </v-card-text>

      <v-card-actions class="px-6 pb-4">
        <span class="text-caption text-medium-emphasis">
          {{ doneRows }} done · {{ failedRows.length }} failed · {{ totalRows }} total
        </span>
        <v-spacer />
        <v-btn
          v-if="dialogState === 'aligning'"
          variant="text"
          @click="cancel"
        >
          Cancel
        </v-btn>
        <v-btn
          v-else-if="dialogState === 'all-success'"
          color="secondary"
          variant="elevated"
          @click="close"
        >
          Close
        </v-btn>
        <template v-else>
          <v-btn variant="text" @click="cancel">
            {{ dialogState === 'partial-success' || dialogState === 'error' ? 'Close' : 'Cancel' }}
          </v-btn>
          <v-btn
            v-if="dialogState === 'partial-success' || dialogState === 'error'"
            color="warning"
            variant="elevated"
            :disabled="failedRows.length === 0"
            @click="retryFailed"
          >
            Retry {{ failedRows.length }} failed
          </v-btn>
          <v-btn
            v-else
            color="secondary"
            variant="elevated"
            :disabled="totalRows === 0"
            @click="alignAll"
          >
            Align {{ totalRows }} {{ totalRows === 1 ? 'class' : 'classes' }}
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
