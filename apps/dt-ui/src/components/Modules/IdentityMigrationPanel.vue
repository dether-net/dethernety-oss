<script setup lang="ts">
  import { ref, computed, onUnmounted } from 'vue'
  import type { IdentityMigrationReport } from '@dethernety/dt-core'
  import { useModulesStore } from '@/stores/modulesStore'

  // "Advanced" panel for re-running the idempotent class-identity cleanup
  // migration. Dry-run defaults ON; the apply funnel is the natural path.
  // The server has no cancel hook — we make that explicit in the caption
  // rather than fake a cancel button. Renders `totalActions` + `details`
  // verbatim from the backend report.

  type PanelState =
    | 'idle'
    | 'dry-run-in-flight'
    | 'dry-run-complete'
    | 'apply-in-flight'
    | 'apply-complete'
    | 'error'

  const modulesStore = useModulesStore()

  const panelState = ref<PanelState>('idle')
  const dryRunMode = ref<boolean>(true)
  const lastReport = ref<IdentityMigrationReport | null>(null)
  const errorMessage = ref<string>('')
  const elapsedSeconds = ref<number>(0)
  let elapsedTimer: ReturnType<typeof setInterval> | null = null
  // Locked once the operator has at least one dry-run for this session,
  // so the "direct apply protection" only fires on truly-cold applies.
  const hasRunDryRunThisSession = ref<boolean>(false)
  const directApplyAcknowledged = ref<boolean>(false)

  const startElapsed = () => {
    elapsedSeconds.value = 0
    if (elapsedTimer) clearInterval(elapsedTimer)
    elapsedTimer = setInterval(() => {
      elapsedSeconds.value += 1
    }, 1000)
  }

  const stopElapsed = () => {
    if (elapsedTimer) {
      clearInterval(elapsedTimer)
      elapsedTimer = null
    }
  }

  onUnmounted(stopElapsed)

  const inFlight = computed(
    () => panelState.value === 'dry-run-in-flight' || panelState.value === 'apply-in-flight'
  )

  const longRunHint = computed(() => elapsedSeconds.value > 60)

  // The operator hasn't dry-run yet but is trying to flip the toggle off
  // (i.e. apply directly). Surface the warning and require an explicit
  // acknowledgement before the apply button appears unguarded.
  const directApplyWarning = computed(
    () => !dryRunMode.value && !hasRunDryRunThisSession.value && !directApplyAcknowledged.value
  )

  const runDryRun = async () => {
    panelState.value = 'dry-run-in-flight'
    errorMessage.value = ''
    startElapsed()
    try {
      lastReport.value = await modulesStore.runIdentityMigration({ dryRun: true })
      hasRunDryRunThisSession.value = true
      panelState.value = 'dry-run-complete'
    } catch (err) {
      errorMessage.value = (err as Error).message ?? 'Unknown error'
      panelState.value = 'error'
    } finally {
      stopElapsed()
    }
  }

  const runApply = async () => {
    panelState.value = 'apply-in-flight'
    errorMessage.value = ''
    startElapsed()
    try {
      lastReport.value = await modulesStore.runIdentityMigration({ dryRun: false })
      panelState.value = 'apply-complete'
    } catch (err) {
      errorMessage.value = (err as Error).message ?? 'Unknown error'
      panelState.value = 'error'
    } finally {
      stopElapsed()
    }
  }

  const discard = () => {
    lastReport.value = null
    errorMessage.value = ''
    panelState.value = 'idle'
  }

  const ackDirectApply = () => {
    directApplyAcknowledged.value = true
  }

  const cancelDirectApply = () => {
    dryRunMode.value = true
    directApplyAcknowledged.value = false
  }

  const primaryButtonLabel = computed(() => {
    if (dryRunMode.value) return 'Run dry-run'
    return 'Apply migration without dry-run'
  })
</script>

<template>
  <v-expansion-panel class="elevation-12 rounded-lg opacity-80" static>
    <v-expansion-panel-title color="primary">
      <v-icon class="mr-2" size="small">mdi-database-cog-outline</v-icon>
      <span>Advanced — Identity migration (re-run cleanup)</span>
    </v-expansion-panel-title>

    <v-expansion-panel-text>
      <p class="text-body-2 text-medium-emphasis mb-3">
        Re-runs the idempotent class-identity cleanup against the current DB.
        Safe to invoke any time (a clean second run reports zero changes).
      </p>

      <!-- IDLE -->
      <template v-if="panelState === 'idle'">
        <v-row align="center" class="mb-2" dense>
          <v-col cols="auto">
            <v-switch
              v-model="dryRunMode"
              color="secondary"
              density="compact"
              hide-details
              label="Dry-run"
            />
          </v-col>
          <v-col class="text-caption text-medium-emphasis">
            Dry-run: <strong>{{ dryRunMode ? 'ON' : 'OFF (will write to the database)' }}</strong>
          </v-col>
        </v-row>

        <v-alert
          v-if="directApplyWarning"
          class="mb-3"
          color="warning"
          density="compact"
          icon="mdi-alert"
          variant="tonal"
        >
          <strong>You're about to apply changes without previewing them.</strong>
          Recommended: run dry-run first to see what will change.
          <div class="mt-2 d-flex ga-2">
            <v-btn color="secondary" size="small" variant="elevated" @click="cancelDirectApply">
              Cancel and run dry-run instead
            </v-btn>
            <v-btn color="warning" size="small" variant="outlined" @click="ackDirectApply">
              Apply without dry-run
            </v-btn>
          </div>
        </v-alert>

        <div v-else>
          <v-btn
            :color="dryRunMode ? 'primary' : 'error'"
            variant="elevated"
            @click="dryRunMode ? runDryRun() : runApply()"
          >
            <v-icon start>{{ dryRunMode ? 'mdi-play-outline' : 'mdi-database-edit-outline' }}</v-icon>
            {{ primaryButtonLabel }}
          </v-btn>
        </div>
      </template>

      <!-- IN-FLIGHT -->
      <v-card v-if="inFlight" class="mb-3" variant="outlined">
        <v-card-text>
          <div class="d-flex align-center">
            <v-progress-circular class="mr-3" indeterminate size="24" />
            <div>
              <strong>
                Running {{ panelState === 'dry-run-in-flight' ? 'dry-run' : 'migration' }}…
              </strong>
              <span class="ml-2 text-medium-emphasis">{{ elapsedSeconds }}s elapsed</span>
            </div>
          </div>
          <p class="text-caption text-medium-emphasis mt-2 mb-0">
            ~30s on typical databases, longer on large ones.
            <strong>The operation cannot be cancelled</strong> — the server
            completes it regardless.
          </p>
          <v-alert
            v-if="longRunHint"
            class="mt-2"
            color="info"
            density="compact"
            icon="mdi-clock-outline"
            variant="tonal"
          >
            This can take more than a minute on large databases. Check the
            <code>dt-ws</code> logs for progress. Refresh the page if you don't
            see results within 5 minutes — the server completes the migration
            regardless.
          </v-alert>
        </v-card-text>
      </v-card>

      <!-- DRY-RUN-COMPLETE -->
      <template v-if="panelState === 'dry-run-complete' && lastReport">
        <v-card class="mb-3" variant="outlined">
          <v-card-title class="text-subtitle-1">
            <v-icon class="mr-2" color="info" size="small">mdi-clipboard-text-outline</v-icon>
            Dry-run report
          </v-card-title>
          <v-card-text>
            <p class="text-h5 mb-3">
              Will perform <strong>{{ lastReport.totalActions }}</strong>
              {{ lastReport.totalActions === 1 ? 'action' : 'actions' }}
            </p>
            <v-expansion-panels v-if="lastReport.details.length > 0" variant="accordion">
              <v-expansion-panel>
                <v-expansion-panel-title>
                  Details ({{ lastReport.details.length }} log lines)
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <ul class="text-body-2">
                    <li v-for="(line, idx) in lastReport.details" :key="idx">
                      <code>{{ line }}</code>
                    </li>
                  </ul>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
            <p v-else class="text-medium-emphasis">
              No actions to perform — the database is already in the target state.
            </p>
          </v-card-text>
          <v-card-actions class="px-4 pb-4">
            <v-btn variant="text" @click="discard">Discard and start over</v-btn>
            <v-spacer />
            <v-btn
              color="error"
              variant="elevated"
              :disabled="lastReport.totalActions === 0"
              @click="runApply"
            >
              <v-icon start>mdi-database-edit-outline</v-icon>
              Apply these changes
            </v-btn>
          </v-card-actions>
        </v-card>
      </template>

      <!-- APPLY-COMPLETE -->
      <template v-if="panelState === 'apply-complete' && lastReport">
        <v-card class="mb-3" variant="outlined">
          <v-card-title class="text-subtitle-1">
            <v-icon class="mr-2" color="success" size="small">mdi-check-circle-outline</v-icon>
            Migration applied
          </v-card-title>
          <v-card-text>
            <p class="text-h5 mb-3">
              Performed <strong>{{ lastReport.totalActions }}</strong>
              {{ lastReport.totalActions === 1 ? 'action' : 'actions' }}
            </p>
            <v-expansion-panels v-if="lastReport.details.length > 0" variant="accordion">
              <v-expansion-panel>
                <v-expansion-panel-title>
                  Details ({{ lastReport.details.length }} log lines)
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <ul class="text-body-2">
                    <li v-for="(line, idx) in lastReport.details" :key="idx">
                      <code>{{ line }}</code>
                    </li>
                  </ul>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
            <v-alert class="mt-3" color="info" density="compact" icon="mdi-information-outline" variant="tonal">
              Migration applied. Re-run dry-run to verify nothing was missed —
              a clean second run reports zero changes.
            </v-alert>
          </v-card-text>
          <v-card-actions class="px-4 pb-4">
            <v-spacer />
            <v-btn color="secondary" variant="text" @click="discard">Run again</v-btn>
          </v-card-actions>
        </v-card>
      </template>

      <!-- ERROR -->
      <template v-if="panelState === 'error'">
        <v-card class="mb-3" variant="outlined">
          <v-card-text>
            <v-alert color="error" density="compact" icon="mdi-close-circle" variant="tonal">
              <strong>Migration failed.</strong>
              <div class="mt-1"><code>{{ errorMessage }}</code></div>
            </v-alert>
          </v-card-text>
          <v-card-actions class="px-4 pb-4">
            <v-spacer />
            <v-btn variant="text" @click="discard">Discard</v-btn>
            <v-btn color="secondary" variant="elevated" @click="dryRunMode ? runDryRun() : runApply()">
              Retry
            </v-btn>
          </v-card-actions>
        </v-card>
      </template>
    </v-expansion-panel-text>
  </v-expansion-panel>
</template>
