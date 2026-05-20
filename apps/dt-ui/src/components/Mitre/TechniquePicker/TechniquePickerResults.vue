<script setup lang="ts">
  import { computed } from 'vue'
  import type { MitreCandidate, MitreKind } from '@dethernety/dt-core'

  /**
   * Shared row component used in TechniquePickerInline's dropdown
   * and TechniquePickerSheet's list. Renders ID (monospace, leftmost) + name +
   * tactic (right-aligned, muted) + one-line description.
   *
   * Mirrors ClassPickerResults shape; differences:
   *   - keyed by mitreId, not classId
   *   - tactic column gets a fixed-width invisible spacer for ATTACK_MITIGATION
   *     (no tactic) so column rhythm stays consistent across kinds
   *   - similarity meter (3-dot) for VECTOR_SIMILARITY matches
   */

  interface Props {
    candidates: MitreCandidate[]
    kind: MitreKind
    boundMitreIds?: readonly string[]
    emptyHint?: string
    // Inline-dropdown consumer opts in to a hover tooltip showing the full
    // description (the dropdown has no preview pane). Sheet consumer leaves
    // it off because the sheet already surfaces the description in its
    // preview pane on focus.
    descriptionTooltip?: boolean
    // Listbox option semantics (opt-in). When optionIdPrefix is set, each row
    // becomes a role="option" with a stable id (`${prefix}-${start + i}`) so a
    // parent combobox can point aria-activedescendant at the focused row. The
    // Sheet consumer omits these and renders plain rows.
    optionIdPrefix?: string
    optionStartIndex?: number
    activeOptionIndex?: number | null
  }
  const props = withDefaults(defineProps<Props>(), {
    boundMitreIds: () => [],
    emptyHint: 'No candidates available.',
    descriptionTooltip: false,
    optionIdPrefix: undefined,
    optionStartIndex: 0,
    activeOptionIndex: null,
  })

  defineEmits<{
    select: [candidate: MitreCandidate]
    confirm: [candidate: MitreCandidate]
  }>()

  // Lowest score the backend returns — mirrors the EMBEDDING_SIMILARITY_THRESHOLD
  // default (0.40) applied in the matchMitreTechniques resolver. The 3-dot meter
  // is anchored to this floor so a returned match always lights at least one dot;
  // the buckets are derived from it (not a separate magic number) so they can't
  // drift from the threshold the way a hardcoded 0.7 did.
  const VECTOR_SIMILARITY_FLOOR = 0.4

  const meterLevel = (score?: number | null): number => {
    if (score == null) return 0
    const span = 1 - VECTOR_SIMILARITY_FLOOR
    if (score >= VECTOR_SIMILARITY_FLOOR + span * 0.5) return 3 // >= 0.70
    if (score >= VECTOR_SIMILARITY_FLOOR + span * 0.25) return 2 // >= 0.55
    if (score >= VECTOR_SIMILARITY_FLOOR) return 1 // >= 0.40
    return 0
  }

  const showTacticColumn = computed(() => props.kind !== 'ATTACK_MITIGATION')
</script>

<template>
  <div class="technique-picker-results">
    <v-list v-if="candidates.length" density="compact">
      <v-tooltip
        v-for="(candidate, i) in candidates"
        :key="candidate.mitreId"
        :disabled="!descriptionTooltip || !candidate.description"
        :text="candidate.description ?? ''"
        location="start"
        :open-delay="400"
        max-width="420"
      >
        <template #activator="{ props: tipProps }">
          <v-list-item
            v-bind="tipProps"
            :id="optionIdPrefix ? `${optionIdPrefix}-${optionStartIndex + i}` : undefined"
            :role="optionIdPrefix ? 'option' : undefined"
            :aria-selected="optionIdPrefix ? optionStartIndex + i === activeOptionIndex : undefined"
            :class="{ 'v-list-item--active': optionIdPrefix != null && optionStartIndex + i === activeOptionIndex }"
            @click="$emit('select', candidate)"
            @dblclick="$emit('confirm', candidate)"
          >
            <template #prepend>
              <span class="font-monospace text-caption mr-3 mitre-id">{{ candidate.mitreId }}</span>
            </template>
            <v-list-item-title>
              {{ candidate.name }}
              <v-chip
                v-if="props.boundMitreIds.includes(candidate.mitreId)"
                class="ml-2"
                color="success"
                size="x-small"
                variant="tonal"
              >Added</v-chip>
              <span
                v-if="candidate.matchType === 'VECTOR_SIMILARITY'"
                class="text-caption text-disabled ml-1"
              >
                · Suggested
                <span class="similarity-meter ml-1">
                  <span
                    v-for="n in 3"
                    :key="n"
                    :class="['similarity-dot', n <= meterLevel(candidate.similarityScore) ? 'filled' : '']"
                  />
                </span>
              </span>
            </v-list-item-title>
            <v-list-item-subtitle v-if="candidate.description" class="description-line">
              {{ candidate.description }}
            </v-list-item-subtitle>
            <template #append>
              <!-- ATTACK_MITIGATION has no tactic; render an invisible spacer so the
                   column rhythm stays consistent across kinds. -->
              <span
                v-if="showTacticColumn"
                class="text-caption text-disabled tactic-column"
              >{{ candidate.tactic || '' }}</span>
              <span v-else class="tactic-spacer" aria-hidden="true" />
            </template>
          </v-list-item>
        </template>
      </v-tooltip>
    </v-list>

    <div v-else class="text-disabled px-4 py-2 empty-state">{{ emptyHint }}</div>
  </div>
</template>

<style scoped>
  .mitre-id {
    min-width: 80px;
    color: rgba(var(--v-theme-on-surface), 0.7);
  }
  .description-line {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 360px;
  }
  .tactic-column,
  .tactic-spacer {
    min-width: 80px;
    text-align: right;
  }
  .tactic-spacer {
    visibility: hidden;
  }
  .similarity-meter {
    display: inline-flex;
    gap: 2px;
    vertical-align: middle;
  }
  .similarity-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background-color: rgba(var(--v-theme-on-surface), 0.2);
    display: inline-block;
  }
  .similarity-dot.filled {
    background-color: rgb(var(--v-theme-primary));
  }
</style>
