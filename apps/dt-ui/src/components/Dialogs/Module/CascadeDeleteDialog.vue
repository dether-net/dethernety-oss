<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import type { TypeCount } from '@dethernety/dt-core'
  import { useModulesStore } from '@/stores/modulesStore'
  import {
    cascadeState,
    CASCADE_CAP,
    NEAR_CAP_THRESHOLD
  } from '@/utils/cascadeState'

  // Operator-facing dialog for hard-deleting an orphaned class. Friction
  // is proportional to blast radius (operator-ux-spec.md §1):
  //   - no-dependents       → simple confirm
  //   - has-deps-under-cap  → type-to-confirm + breakdown
  //   - has-deps-near-cap   → adds a "near limit" warning
  //   - has-deps-over-cap   → button disabled, manual cleanup required
  // Analyses present in the breakdown adds a "user work, cannot be
  // recovered" warning regardless of cap state.

  // `class` is reserved as a prop name in Vue → we name it `targetClass`.
  interface TargetClass {
    id: string
    name: string
    kind: string
    incomingInstanceCount: number
    incomingInstancesByType: TypeCount[]
  }

  interface Props {
    show: boolean
    targetClass: TargetClass | null
  }

  const props = defineProps<Props>()
  const emit = defineEmits<{
    close: []
    deleted: []
  }>()

  const modulesStore = useModulesStore()

  const typedConfirmation = ref('')
  const submitting = ref(false)

  watch(
    () => props.show,
    (open) => {
      if (open) {
        typedConfirmation.value = ''
        submitting.value = false
      }
    }
  )

  const state = computed(() =>
    cascadeState(props.targetClass?.incomingInstanceCount ?? 0)
  )

  const requiresTypeConfirm = computed(() => state.value !== 'no-dependents')

  const cascade = computed(() => state.value !== 'no-dependents')

  const breakdown = computed(() => props.targetClass?.incomingInstancesByType ?? [])

  const analysesCount = computed(() => {
    return breakdown.value.find((row) => row.type === 'Analysis')?.count ?? 0
  })

  const breakdownLine = computed(() => {
    if (!props.targetClass) return ''
    const parts = [`1 ${props.targetClass.kind}`]
    for (const row of breakdown.value) {
      parts.push(`${row.count} ${row.type}${row.count === 1 ? '' : 's'}`)
    }
    return parts.join(' + ')
  })

  // Type-to-confirm: case-sensitive, whitespace-stripped match.
  const confirmMatches = computed(() => {
    if (!requiresTypeConfirm.value) return true
    if (!props.targetClass) return false
    return typedConfirmation.value.trim() === props.targetClass.name
  })

  const canSubmit = computed(() => {
    if (state.value === 'has-dependents-over-cap') return false
    if (submitting.value) return false
    return confirmMatches.value
  })

  const submit = async () => {
    if (!canSubmit.value || !props.targetClass) return
    try {
      submitting.value = true
      await modulesStore.deleteOrphanedClass({
        classId: props.targetClass.id,
        classKind: props.targetClass.kind,
        cascade: cascade.value
      })
      emit('deleted')
      emit('close')
    } catch {
      // Error message surfaces via the store's error → snackBar in the parent.
      // Keep the dialog open so the operator can retry or cancel.
    } finally {
      submitting.value = false
    }
  }

  const close = () => {
    if (submitting.value) return
    emit('close')
  }

  const showDialog = computed({
    get: () => props.show,
    set: (val) => {
      if (!val) close()
    }
  })

  const handleEnter = () => {
    if (canSubmit.value) submit()
  }
</script>

<template>
  <v-dialog v-model="showDialog" max-width="640" persistent @keydown.esc="close">
    <v-card v-if="targetClass">
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="error">mdi-delete-alert</v-icon>
        <span>Delete orphaned class — <code>{{ targetClass.name }}</code></span>
        <v-spacer />
        <v-btn
          v-if="!submitting"
          icon="mdi-close"
          size="small"
          variant="text"
          @click="close"
        />
      </v-card-title>

      <v-card-text>
        <!-- No-dependents: simple confirm -->
        <v-alert
          v-if="state === 'no-dependents'"
          color="info"
          density="compact"
          icon="mdi-information-outline"
          variant="tonal"
        >
          This class has no incoming :IS_INSTANCE_OF edges. It can be safely
          deleted.
        </v-alert>

        <!-- Has-dependents (under or near cap): show breakdown + type-to-confirm -->
        <template v-else-if="state === 'has-dependents-under-cap' || state === 'has-dependents-near-cap'">
          <v-alert
            class="mb-3"
            color="warning"
            density="compact"
            icon="mdi-alert"
            variant="tonal"
          >
            <strong>Cascade delete will permanently remove:</strong>
            <div class="mt-1">{{ breakdownLine }}</div>
          </v-alert>

          <v-alert
            v-if="analysesCount > 0"
            class="mb-3"
            color="error"
            density="compact"
            icon="mdi-account-alert"
            variant="tonal"
          >
            <strong>{{ analysesCount }} {{ analysesCount === 1 ? 'Analysis' : 'Analyses' }} will be permanently lost.</strong>
            Analyses represent user work and cannot be recovered.
          </v-alert>

          <v-alert
            v-if="state === 'has-dependents-near-cap'"
            class="mb-3"
            color="warning"
            density="compact"
            icon="mdi-speedometer"
            variant="tonal"
          >
            <strong>Near cascade limit
              ({{ targetClass.incomingInstanceCount }} of {{ CASCADE_CAP }} dependent nodes).</strong>
            Deletes near the cap are slow and may be partially rolled back if
            the database becomes contended.
          </v-alert>

          <p class="text-body-2 mb-2 text-medium-emphasis">
            Type the class name to confirm — case-sensitive.
          </p>
          <v-text-field
            v-model="typedConfirmation"
            :placeholder="targetClass.name"
            :color="confirmMatches ? 'success' : 'error'"
            :disabled="submitting"
            autofocus
            density="compact"
            hide-details
            variant="outlined"
            @keydown.enter.prevent="handleEnter"
          />
        </template>

        <!-- Over-cap: refuse with clear message -->
        <v-alert
          v-else
          color="error"
          density="compact"
          icon="mdi-cancel"
          variant="tonal"
        >
          <strong>Cascade limit exceeded
            ({{ targetClass.incomingInstanceCount }} dependent nodes; cap is {{ CASCADE_CAP }}).</strong>
          Manual cleanup is required before this class can be deleted.
        </v-alert>

        <p class="text-caption text-medium-emphasis mt-3">
          Threshold: {{ NEAR_CAP_THRESHOLD }} = "near limit", {{ CASCADE_CAP }} = hard cap.
        </p>
      </v-card-text>

      <v-card-actions class="px-6 pb-4">
        <v-spacer />
        <v-btn variant="text" :disabled="submitting" @click="close">
          Cancel
        </v-btn>
        <v-tooltip
          :disabled="state !== 'has-dependents-over-cap'"
          location="top"
          text="Cascade limit exceeded — manual cleanup required"
        >
          <template #activator="{ props: tooltipProps }">
            <div v-bind="tooltipProps">
              <v-btn
                color="error"
                variant="elevated"
                :disabled="!canSubmit"
                :loading="submitting"
                @click="submit"
              >
                <v-icon start>mdi-delete</v-icon>
                {{ cascade ? 'Cascade delete' : 'Delete class' }}
              </v-btn>
            </div>
          </template>
        </v-tooltip>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
