<script setup lang="ts">
  import type { Module } from '@dethernety/dt-core'

  const props = defineProps<{ modules: Module[] }>()
  const emit = defineEmits<{ 'review-conflicts': [module: Module] }>()

  const blockedModules = computed(() =>
    props.modules.filter((m) => (m.rebindConflicts?.length ?? 0) > 0)
  )

  const totalBlockedClasses = computed(() =>
    blockedModules.value.reduce(
      (sum, m) => sum + (m.rebindConflicts?.length ?? 0),
      0
    )
  )
</script>

<template>
  <v-alert
    v-if="blockedModules.length > 0"
    type="warning"
    variant="tonal"
    border="start"
    icon="mdi-alert"
  >
    <p class="font-weight-medium mb-1">
      {{ blockedModules.length }}
      {{ blockedModules.length === 1 ? 'module has' : 'modules have' }}
      blocked installs
      ({{ totalBlockedClasses }} class{{ totalBlockedClasses === 1 ? '' : 'es' }} conflicting)
    </p>
    <p class="text-body-2 mb-2">
      Modules with strict-mode rebind conflicts cannot complete install until the
      operator aligns the class id.
    </p>
    <div class="d-flex flex-wrap ga-2">
      <v-btn
        v-for="m in blockedModules"
        :key="m.id"
        size="small"
        variant="tonal"
        color="warning"
        @click="emit('review-conflicts', m)"
      >
        Review conflicts — {{ m.name }} ({{ m.rebindConflicts?.length ?? 0 }})
      </v-btn>
    </div>
  </v-alert>
</template>
