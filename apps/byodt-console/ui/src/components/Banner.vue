<script setup lang="ts">
// The one alert primitive: a left-ruled block the now-region uses for every transient message.
// tone picks the brand colour; the title is the headline; the default slot is the body.
defineProps<{ tone: 'fault' | 'warn' | 'info'; title: string }>()

const TONE: Record<'fault' | 'warn' | 'info', string> = {
  fault: 'border-dt-quinary bg-dt-quinary/10',
  warn: 'border-dt-tertiary bg-dt-tertiary/10',
  info: 'border-dt-border bg-white/5',
}
</script>

<template>
  <div role="alert" class="rounded-r-md border-l-4 px-3 py-2" :class="TONE[tone]">
    <p class="text-sm font-semibold text-dt-text">{{ title }}</p>
    <div class="mt-0.5 text-sm text-dt-text-muted"><slot /></div>
  </div>
</template>
