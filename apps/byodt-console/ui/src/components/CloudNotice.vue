<script setup lang="ts">
// An actionable cloud-phase failure notice: a title, the reason, an optional exact value to register
// (shown monospace so the operator can copy it), and optional ordered recovery steps. It replaces the
// grey one-line message the cloud sign-in flow used to show for errors that need a fix, not just a name.
export interface CloudNoticeData {
  title: string
  message: string
  // A value the operator must register verbatim with their identity provider (the callback URI).
  registerUri?: string
  // Ordered recovery steps, shown as a numbered list.
  recovery?: string[]
}

defineProps<{ notice: CloudNoticeData }>()
</script>

<template>
  <section
    data-notice
    role="alert"
    class="rounded-r-md border-l-4 border-dt-quinary bg-dt-quinary/10 px-3 py-2"
  >
    <p class="text-sm font-heading font-semibold text-dt-text">{{ notice.title }}</p>
    <p class="mt-1 text-sm text-dt-text-muted">{{ notice.message }}</p>

    <p v-if="notice.registerUri" class="mt-2 text-sm text-dt-text-muted">
      Register this exact value with your identity provider:
      <code class="mt-1 block break-all rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs text-dt-text">{{
        notice.registerUri
      }}</code>
    </p>

    <ol
      v-if="notice.recovery && notice.recovery.length"
      class="mt-2 list-decimal space-y-0.5 pl-5 text-sm text-dt-text-muted"
    >
      <li v-for="(step, i) in notice.recovery" :key="i">{{ step }}</li>
    </ol>
  </section>
</template>
