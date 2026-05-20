<script setup lang="ts">
  import { ref } from 'vue'
  import type { MitreKind } from '@dethernety/dt-core'
  import AttackTechniqueDialog from '@/components/Dialogs/Mitre/AttackTechniqueDialog.vue'
  import DefendTechniqueDialog from '@/components/Dialogs/Mitre/DefendTechniqueDialog.vue'
  import AttackMitigationDialog from '@/components/Dialogs/Mitre/AttackMitigationDialog.vue'

  /**
   * Always-visible chip row for selected techniques.
   *
   * Each chip: ID (monospace) + name. X-icon removes; chip body click opens
   * the kind-appropriate detail dialog — one of AttackTechniqueDialog,
   * DefendTechniqueDialog, or AttackMitigationDialog.
   *
   * ARIA model:
   *   - container: role="group" (not listbox — chips don't represent a
   *     selection state, they're already-selected items with a remove action)
   *   - each chip: aria-label explains the keyboard model explicitly
   *
   * Keyboard:
   *   - Tab cycles chips L→R then to input
   *   - Delete/Backspace on focused chip removes; focus moves to previous
   *     chip (or input if last)
   *   - Enter on focused chip opens the kind-appropriate detail dialog
   *
   * Catalog-hydration race: chips render in ID-only skeleton state when the
   * parent passes selectedMitreIds before the catalog hydrates. The chips
   * snap to full label once `nameById` contains the id.
   */

  interface Props {
    mitreIds: string[]
    kind: MitreKind
    // Map from mitreId → display name. Sourced from the parent's hydrated catalog
    // and/or recent-results state. Missing entries render as skeleton chips.
    nameById?: Record<string, string>
    disabled?: boolean
  }
  const props = withDefaults(defineProps<Props>(), {
    nameById: () => ({}),
    disabled: false,
  })

  const emit = defineEmits<{
    remove: [mitreId: string]
  }>()

  const detailDialog = ref<{ show: boolean, mitreId: string | null }>({ show: false, mitreId: null })

  function nameFor(mitreId: string): string | null {
    return props.nameById[mitreId] ?? null
  }

  function openDetail(mitreId: string): void {
    detailDialog.value = { show: true, mitreId }
  }

  function closeDetail(): void {
    detailDialog.value = { show: false, mitreId: null }
  }

  function onChipKey(event: KeyboardEvent, mitreId: string): void {
    if (props.disabled) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      emit('remove', mitreId)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      openDetail(mitreId)
    }
  }

  function chipAriaLabel(mitreId: string): string {
    const name = nameFor(mitreId)
    const head = name ? `${mitreId} ${name}` : `Loading ${mitreId}`
    return `${head}. Press Enter to view details, or Delete to remove.`
  }
</script>

<template>
  <div
    v-if="mitreIds.length"
    class="technique-picker-chips"
    role="group"
    aria-label="Selected items"
  >
    <v-chip
      v-for="mitreId in mitreIds"
      :key="mitreId"
      :aria-busy="!nameFor(mitreId)"
      :aria-label="chipAriaLabel(mitreId)"
      :tabindex="disabled ? -1 : 0"
      :closable="!disabled"
      class="ma-1"
      variant="tonal"
      @click="openDetail(mitreId)"
      @click:close="emit('remove', mitreId)"
      @keydown="onChipKey($event, mitreId)"
    >
      <span class="font-monospace text-caption mr-2">{{ mitreId }}</span>
      <template v-if="nameFor(mitreId)">{{ nameFor(mitreId) }}</template>
      <v-skeleton-loader
        v-else
        type="text"
        class="skeleton-name"
      />
    </v-chip>

    <!-- v-if includes detailDialog.show so the dialog REMOUNTS on each open —
         the detail dialogs read their id prop once on setup; without remount,
         clicking a second chip would show the first chip's content. -->
    <AttackTechniqueDialog
      v-if="kind === 'ATTACK_TECHNIQUE' && detailDialog.show && detailDialog.mitreId"
      :show="detailDialog.show"
      :attack-id="detailDialog.mitreId"
      @close="closeDetail"
    />
    <DefendTechniqueDialog
      v-if="kind === 'DEFEND_TECHNIQUE' && detailDialog.show && detailDialog.mitreId"
      :show="detailDialog.show"
      :d3fend-id="detailDialog.mitreId"
      @close="closeDetail"
    />
    <AttackMitigationDialog
      v-if="kind === 'ATTACK_MITIGATION' && detailDialog.show && detailDialog.mitreId"
      :show="detailDialog.show"
      :attack-id="detailDialog.mitreId"
      @close="closeDetail"
    />
  </div>
</template>

<style scoped>
  .technique-picker-chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    margin: 4px 0;
  }
  .skeleton-name {
    display: inline-block;
    min-width: 120px;
    height: 16px;
    vertical-align: middle;
  }
</style>
