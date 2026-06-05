<!--
  TechniqueChips.vue — clickable MITRE ATT&CK technique chips for one exposure.

  Presentational: given an exposure's resolved techniques (from
  buildExposureTechniqueIndex), renders one small monospace chip per technique and
  emits `show(technique)` on click, so the host view opens the shared
  TechniqueInfoDialog. Renders NOTHING when there are no techniques — the chips are
  additive enrichment.

  Honesty: a chip is an IDENTITY + a launcher, deliberately NOT tinted by coverage
  tier — coverage encoding lives only in the ① matrix, so a chip never doubles as a
  coverage claim. Their absence is not a "no techniques" assertion (an unmapped
  exposure simply has no entry; the matrix owns that accounting).
-->
<template>
  <span v-if="techniques && techniques.length" class="trd-techchips" :class="{ 'trd-techchips--dense': dense }">
    <button
      v-for="t in techniques"
      :key="t.techniqueId"
      type="button"
      class="trd-techchip"
      :title="t.name ? `${t.techniqueId}: ${t.name} — details` : `What is ${t.techniqueId}?`"
      @click.stop="$emit('show', t)"
    >{{ t.techniqueId }}</button>
  </span>
</template>

<script setup>
  defineProps({
    // Resolved techniques: [{ techniqueId, name?, tactics?, description? }].
    techniques: { type: Array, default: () => [] },
    // Tighter sizing for the dense ledger tables (vs the roomier ⑥ profile).
    dense: { type: Boolean, default: false },
  })
  defineEmits(['show'])
</script>

<style scoped>
  .trd-techchips { display: inline-flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; }
  .trd-techchip {
    background: transparent;
    border: 1px solid rgba(127, 127, 127, 0.45);
    border-radius: 10px;
    padding: 0 7px;
    font: inherit;
    font-size: 0.68rem;
    font-family: ui-monospace, monospace;
    line-height: 1.5;
    color: inherit;
    opacity: 0.85;
    cursor: pointer;
  }
  .trd-techchip:hover { opacity: 1; border-color: #00b8d4; color: #00b8d4; }
  .trd-techchip:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }
  .trd-techchips--dense .trd-techchip { font-size: 0.64rem; padding: 0 5px; }
</style>
