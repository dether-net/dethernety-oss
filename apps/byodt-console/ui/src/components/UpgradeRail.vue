<script setup lang="ts">
// The open-source-edition funnel: shown only in local posture, it states the paid value plainly and
// jumps to the Cloud tab where the deployment recipe is pasted. No dark pattern — it never obstructs
// the health above it, and the deployment keeps working untouched if ignored.
defineEmits<{ (e: 'connect'): void }>()
</script>

<template>
  <div class="dt-card p-6">
    <p class="dt-eyebrow mb-2">Connect to cloud</p>
    <div class="flex flex-wrap items-center justify-between gap-4">
      <p class="max-w-xl text-sm text-dt-text-muted">
        Subscribe to mount curated content and sign your team in with SSO. Paste the deployment recipe
        from your account to connect this deployment.
      </p>
      <button
        type="button"
        class="shrink-0 rounded-lg bg-dt-secondary px-4 py-2 font-heading text-sm text-dt-surface hover:bg-dt-secondary/80"
        @click="$emit('connect')"
      >
        Connect this deployment
      </button>
    </div>
  </div>
</template>
