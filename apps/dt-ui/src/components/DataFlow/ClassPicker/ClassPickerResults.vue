<script setup lang="ts">
  import { computed } from 'vue'
  import type { ClassCandidate } from '@/stores/classSuggestionsStore'

  interface Props {
    candidates: ClassCandidate[]
    plain?: boolean
    boundClassIds?: readonly string[]
  }
  const props = withDefaults(defineProps<Props>(), {
    plain: false,
    boundClassIds: () => [],
  })

  defineEmits<{
    select: [candidate: ClassCandidate]
    confirm: [candidate: ClassCandidate]
  }>()

  const VECTOR_SIMILARITY_THRESHOLD = 0.7

  const allTypeMatch = computed(() =>
    props.candidates.length > 0 && props.candidates.every(c => c.matchType === 'type_match'),
  )

  const showGroupHeader = computed(() => allTypeMatch.value && !props.plain)

  const orderedCandidates = computed(() =>
    showGroupHeader.value
      ? [...props.candidates].sort((a, b) => a.className.localeCompare(b.className))
      : props.candidates,
  )

  const meterLevel = (score?: number): number => {
    if (score == null) return 0
    if (score >= 0.9) return 3
    if (score >= 0.8) return 2
    if (score >= VECTOR_SIMILARITY_THRESHOLD) return 1
    return 0
  }
</script>

<template>
  <div class="class-picker-results">
    <div v-if="showGroupHeader" class="text-caption text-disabled px-4 py-2 group-header">
      All classes of this type
    </div>

    <v-list v-if="orderedCandidates.length" density="compact">
      <v-list-item
        v-for="candidate in orderedCandidates"
        :key="candidate.classId"
        @click="$emit('select', candidate)"
        @dblclick="$emit('confirm', candidate)"
      >
        <v-list-item-title>
          {{ candidate.className }}
          <v-chip
            v-if="props.boundClassIds.includes(candidate.classId)"
            class="ml-2 added-chip"
            color="success"
            size="x-small"
            variant="tonal"
          >Added</v-chip>
          <span
            v-if="candidate.matchType === 'fuzzy_name'"
            class="text-caption text-disabled ml-1"
          >· Likely match</span>
          <span
            v-else-if="candidate.matchType === 'vector_similarity'"
            class="text-caption text-disabled ml-1 vector-suggested"
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
        <v-list-item-subtitle v-if="candidate.classCategory || candidate.moduleName">
          {{ [candidate.classCategory, candidate.moduleName].filter(Boolean).join(' · ') }}
        </v-list-item-subtitle>
      </v-list-item>
    </v-list>

    <div v-else class="text-disabled px-4 py-2 empty-state">
      No candidates available.
    </div>
  </div>
</template>

<style scoped>
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
