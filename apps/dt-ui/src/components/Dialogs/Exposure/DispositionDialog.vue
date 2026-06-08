<script setup lang="ts">
  import { ref, computed, watch, nextTick } from 'vue'
  import { useFlowStore } from '@/stores/flowStore'
  import { useControlsStore } from '@/stores/controlsStore'
  import type { DispositionKind, DispositionMutationResult } from '@dethernety/dt-core'
  import {
    affirmDialogTitleFor,
    saveLabelFor,
    dispositionKindLabel,
    type FindingType,
  } from '@/composables/useFindingDisposition'

  /**
   * Disposition dialog — shared by both finding types via `findingType`.
   *
   * Single form with:
   *   - Pickable-kinds radio group, filtered by finding type:
   *       EXPOSURE      → NOT_APPLICABLE / FALSE_POSITIVE / COMPENSATING_CONTROL / RISK_ACCEPTED
   *       COUNTERMEASURE → NOT_APPLICABLE / FALSE_POSITIVE / WAIVED
   *     SUPERSEDED is filtered out for both — not user-pickable (set by the Supersede flow).
   *   - Locked-kind read-only line variant when `lockKind === true` (SUPERSEDED-only case).
   *   - Mandatory reason textarea (2000-char limit, Vuetify counter).
   *   - Stale banner (when `isStale === true`).
   *   - Provenance read-only line when editing.
   *   - Action row layout: Cancel / Remove disposition (two-tap, editor-only) on
   *     the left of the spacer; Save | Re-affirm on the right. The destructive
   *     Remove button is intentionally separated from the primary Save so a
   *     mis-aim can't destroy disposition history.
   *   - Autofocus on open: stale alert (when stale) → first radio (new
   *     disposition) → reason textarea (edit).
   *   - Esc / Cancel with unsaved changes surfaces an inline discard banner
   *     rather than silently dropping edits.
   *
   * Save / Remove dispatch by `findingType`: EXPOSURE → flowStore, COUNTERMEASURE
   * → controlsStore. Re-affirm label is cosmetic — the wire call is identical to
   * Save (always clears stale).
   */

  interface Props {
    showDialog: boolean
    findingId: string
    findingName: string
    findingType: FindingType
    initialKind?: DispositionKind | null
    initialReason?: string
    isStale?: boolean
    lockKind?: boolean
    initialDispositionedBy?: string
    initialDispositionedAt?: string
  }
  const props = withDefaults(defineProps<Props>(), {
    initialKind: null,
    initialReason: '',
    isStale: false,
    lockKind: false,
    initialDispositionedBy: '',
    initialDispositionedAt: '',
  })

  const emit = defineEmits<{
    close: []
    saved: [result: DispositionMutationResult]
    cleared: [result: DispositionMutationResult]
  }>()

  const flowStore = useFlowStore()
  const controlsStore = useControlsStore()

  const isCountermeasure = computed(() => props.findingType === 'COUNTERMEASURE')
  const findingTypeLabel = computed(() => (isCountermeasure.value ? 'Countermeasure' : 'Exposure'))

  const PICKABLE_KINDS = computed<DispositionKind[]>(() =>
    isCountermeasure.value
      ? ['NOT_APPLICABLE', 'FALSE_POSITIVE', 'WAIVED']
      : ['NOT_APPLICABLE', 'FALSE_POSITIVE', 'COMPENSATING_CONTROL', 'RISK_ACCEPTED'],
  )

  // Per-kind helper copy shown under the radio. WAIVED needs the intent spelled
  // out for a non-security analyst — the bare chip reads as a label only.
  const KIND_HELP: Partial<Record<DispositionKind, string>> = {
    WAIVED: 'Waived — we have decided not to implement this control.',
  }

  // Local form state — initial values copied in on each open.
  const kind = ref<DispositionKind | null>(props.initialKind)
  const reason = ref<string>(props.initialReason)
  const isSaving = ref(false)
  const errorMessage = ref<string>('')
  const removeConfirmPending = ref(false)
  const removeConfirmTimer = ref<ReturnType<typeof setTimeout> | null>(null)
  const discardConfirmPending = ref(false)
  // Polite live-region text so keyboard/AT users hear the two-tap remove
  // entering its pending state and its 4s auto-expiry (sighted users get the
  // button-label change).
  const liveAnnouncement = ref<string>('')

  // Refs for autofocus management.
  const staleAlertRef = ref<HTMLElement | null>(null)
  const radioGroupRef = ref<unknown>(null)
  const reasonTextareaRef = ref<unknown>(null)

  // Re-seed local state on each open. Re-open with different inputs is a real
  // scenario (user closes + clicks dispose on a different row).
  watch(() => props.showDialog, async open => {
    if (open) {
      kind.value = props.initialKind
      reason.value = props.initialReason
      errorMessage.value = ''
      isSaving.value = false
      removeConfirmPending.value = false
      discardConfirmPending.value = false
      if (removeConfirmTimer.value) clearTimeout(removeConfirmTimer.value)

      // Autofocus: stale-first → first radio (new) → reason (edit).
      // Wait for the dialog to render before focusing.
      await nextTick()
      const radioEl = (radioGroupRef.value as { $el?: HTMLElement } | null)?.$el ?? null
      const textareaEl = (reasonTextareaRef.value as { $el?: HTMLElement } | null)?.$el ?? null
      if (props.isStale && staleAlertRef.value) {
        staleAlertRef.value.focus()
      } else if (!props.initialKind && radioEl) {
        const firstInput = radioEl.querySelector('input[type="radio"]')
        if (firstInput instanceof HTMLElement) firstInput.focus()
      } else if (textareaEl) {
        const textarea = textareaEl.querySelector('textarea')
        if (textarea instanceof HTMLElement) textarea.focus()
      }
    }
  })

  const isEdit = computed(() => Boolean(props.initialKind))
  // Lifecycle-aware title + save label. The affirm-edit variant (lockKind + AFFIRMED,
  // from affirmDialogStateFor) must NEVER read "Dispose" and saves as an affirmation.
  const isAffirmEdit = computed(() => props.lockKind && props.initialKind === 'AFFIRMED')
  const dialogTitle = computed(() =>
    isAffirmEdit.value
      ? affirmDialogTitleFor(props.findingType, props.isStale)
      : `Dispose ${findingTypeLabel.value}`,
  )
  const saveLabel = computed(() => saveLabelFor(props.lockKind, props.initialKind ?? null, props.isStale))
  const saveDisabled = computed(() => isSaving.value || !kind.value || !reason.value.trim() || reason.value.length > 2000)
  const hasUnsavedChanges = computed(
    () =>
      (kind.value ?? null) !== (props.initialKind ?? null) ||
      reason.value !== props.initialReason,
  )

  async function onSave(): Promise<void> {
    if (!kind.value || saveDisabled.value) return
    isSaving.value = true
    errorMessage.value = ''
    try {
      const result = isCountermeasure.value
        ? await controlsStore.disposeCountermeasure({
          countermeasureId: props.findingId,
          kind: kind.value,
          reason: reason.value.trim(),
        })
        : await flowStore.disposeExposure({
          exposureId: props.findingId,
          kind: kind.value,
          reason: reason.value.trim(),
        })
      if (!result.success) {
        errorMessage.value = result.errorMessage ?? 'Save failed.'
        return
      }
      emit('saved', result)
      emit('close')
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'Save failed.'
    } finally {
      isSaving.value = false
    }
  }

  async function onRemove(): Promise<void> {
    if (!removeConfirmPending.value) {
      removeConfirmPending.value = true
      liveAnnouncement.value = 'Confirm removal: activate Remove disposition again within 4 seconds to remove it.'
      // Auto-revert after 4s if the user doesn't confirm.
      removeConfirmTimer.value = setTimeout(() => {
        removeConfirmPending.value = false
        liveAnnouncement.value = 'Removal confirmation expired.'
      }, 4000)
      return
    }
    // Second tap — fire the clear.
    if (removeConfirmTimer.value) clearTimeout(removeConfirmTimer.value)
    removeConfirmPending.value = false
    liveAnnouncement.value = ''
    isSaving.value = true
    errorMessage.value = ''
    try {
      const result = isCountermeasure.value
        ? await controlsStore.clearCountermeasureDisposition({ countermeasureId: props.findingId })
        : await flowStore.clearDisposition({ exposureId: props.findingId })
      if (!result.success) {
        errorMessage.value = result.errorMessage ?? 'Remove failed.'
        return
      }
      emit('cleared', result)
      emit('close')
    } catch (err) {
      errorMessage.value = err instanceof Error ? err.message : 'Remove failed.'
    } finally {
      isSaving.value = false
    }
  }

  function onCancel(): void {
    if (removeConfirmPending.value) {
      // Esc / Cancel reverts the two-tap-pending state without closing.
      if (removeConfirmTimer.value) clearTimeout(removeConfirmTimer.value)
      removeConfirmPending.value = false
      liveAnnouncement.value = 'Removal cancelled.'
      return
    }
    if (hasUnsavedChanges.value && !discardConfirmPending.value) {
      // Two-step discard: surface an inline banner; user must confirm to drop
      // unsaved edits.
      discardConfirmPending.value = true
      return
    }
    emit('close')
  }

  function onDiscardKeep(): void {
    discardConfirmPending.value = false
  }

  function onDiscardConfirm(): void {
    discardConfirmPending.value = false
    emit('close')
  }

  function formatDate(iso?: string): string {
    if (!iso) return ''
    try {
      return new Date(iso).toLocaleString()
    } catch {
      return iso
    }
  }
</script>

<template>
  <v-dialog :model-value="showDialog" max-width="600" persistent @keydown.esc="onCancel">
    <v-card class="pa-0 ma-0 rounded-lg">
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <span>{{ dialogTitle }}</span>
          <span class="text-subtitle-2 text-disabled ml-2">{{ findingName }}</span>
        </v-sheet>
      </v-card-title>

      <v-card-text>
        <v-alert
          v-if="discardConfirmPending"
          type="info"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          You have unsaved changes.
          <template #append>
            <v-btn size="small" variant="text" @click="onDiscardKeep">Keep editing</v-btn>
            <v-btn size="small" variant="flat" color="warning" @click="onDiscardConfirm">Discard</v-btn>
          </template>
        </v-alert>

        <v-alert
          v-if="isStale"
          ref="staleAlertRef"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3"
          role="alert"
          aria-live="assertive"
          tabindex="-1"
        >
          Model attributes changed since this disposition was set. Review and re-affirm if it still applies.
        </v-alert>

        <!-- Locked-kind read-only variant. The kind is fixed (not user-pickable):
             the affirm-edit path locks it to AFFIRMED so re-affirm / "Add note…"
             can never convert a confirmed finding into a disposal. Label derived
             from initialKind (do NOT hardcode a kind here). -->
        <div
          v-if="lockKind"
          role="group"
          :aria-label="`Disposition kind, locked: ${dispositionKindLabel(initialKind)}`"
          class="locked-kind-line mb-3"
        >
          <span class="text-subtitle-2 text-medium-emphasis">Disposition:</span>
          <span class="ml-2">{{ dispositionKindLabel(initialKind) }}</span>
        </div>

        <!-- Radio group variant -->
        <v-radio-group
          v-else
          ref="radioGroupRef"
          v-model="kind"
          density="compact"
          hide-details
          class="mb-3"
          :label="isEdit ? 'Change disposition' : 'Select a disposition'"
        >
          <v-radio
            v-for="k in PICKABLE_KINDS"
            :key="k"
            :value="k"
          >
            <template #label>
              <div class="d-flex flex-column">
                <span>{{ dispositionKindLabel(k) }}</span>
                <span v-if="KIND_HELP[k]" class="text-caption text-medium-emphasis">{{ KIND_HELP[k] }}</span>
              </div>
            </template>
          </v-radio>
        </v-radio-group>

        <v-textarea
          ref="reasonTextareaRef"
          v-model="reason"
          label="Reason"
          placeholder="Explain why this finding gets this disposition"
          variant="outlined"
          density="compact"
          :counter="2000"
          :rules="[v => (v && v.trim().length > 0) || 'Reason is required', v => (v?.length ?? 0) <= 2000 || 'Maximum 2000 characters']"
          rows="4"
          auto-grow
          required
        />

        <div v-if="initialDispositionedBy && initialDispositionedAt" class="text-caption text-disabled mt-2 provenance">
          Set by {{ initialDispositionedBy }} on {{ formatDate(initialDispositionedAt) }}
        </div>

        <v-alert v-if="errorMessage" type="error" variant="tonal" density="compact" class="mt-3">
          {{ errorMessage }}
        </v-alert>
      </v-card-text>

      <!--
        Action row layout:
          Cancel | Remove disposition  ----spacer----  Save / Re-affirm
        The destructive "Remove disposition" sits adjacent to Cancel on the
        LEFT, well separated from the primary Save on the right. Two-tap
        confirmation remains as a second guard.
      -->
      <v-card-actions>
        <v-btn variant="text" @click="onCancel" color="secondary">Cancel</v-btn>
        <v-btn
          v-if="isEdit"
          :color="removeConfirmPending ? 'error' : 'secondary'"
          :variant="removeConfirmPending ? 'outlined' : 'text'"
          class="ml-2"
          :disabled="isSaving"
          @click="onRemove"
        >
          {{ removeConfirmPending ? 'Click again to confirm' : 'Remove disposition' }}
        </v-btn>
        <v-spacer />
        <v-btn
          color="secondary"
          variant="flat"
          :loading="isSaving"
          :disabled="saveDisabled"
          @click="onSave"
        >{{ saveLabel }}</v-btn>
      </v-card-actions>
      <span class="sr-only" role="status" aria-live="polite">{{ liveAnnouncement }}</span>
    </v-card>
  </v-dialog>
</template>

<style scoped>
  /*
   * Locked-kind line min-height matches the radio-group's natural height
   * (4 radios × ~42px ≈ 168px) so the dialog body doesn't shift between the
   * Supersede-flow (locked) and normal-dispose (radio group) variants.
   */
  .locked-kind-line {
    min-block-size: 168px;
    display: flex;
    align-items: center;
  }
  /* Visually-hidden live region (announced by AT, off-screen for sighted users). */
  .sr-only {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
