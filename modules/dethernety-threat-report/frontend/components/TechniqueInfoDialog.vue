<!--
  TechniqueInfoDialog.vue — the shared "what is this ATT&CK technique?" dialog.

  An attack_id is opaque on its own, so this resolves it to the ATT&CK name +
  tactics + cleaned description. Used by the Coverage & Gaps matrix (the ⓘ on a
  technique row), the Component Profile, and the Residual Risk ledger (the
  technique chips on a finding) — ONE component so the affordance is identical
  everywhere.

  A Vuetify v-dialog (not the hand-rolled fixed overlay this replaced) so it
  stacks correctly ABOVE the Component Profile dialog (Vuetify gives nested
  dialogs an incrementally higher z-index) and inherits the host scrim / Esc /
  teleport. The
  inner panel keeps the original info-panel look so it reads the same as before.
-->
<template>
  <v-dialog
    :model-value="!!technique"
    max-width="640"
    scrollable
    @update:model-value="(v) => { if (!v) $emit('close') }"
  >
    <div v-if="technique" class="trd-info-panel" role="dialog" aria-modal="true" aria-labelledby="trd-info-title">
      <div class="trd-info-head">
        <h3 id="trd-info-title" class="trd-info-title">
          <span class="trd-info-id">{{ technique.techniqueId }}</span><span v-if="technique.name"> · {{ technique.name }}</span>
        </h3>
        <button type="button" class="trd-info-close" @click="$emit('close')" aria-label="Close">✕</button>
      </div>
      <p v-if="technique.tactics && technique.tactics.length" class="trd-info-tactics">
        Tactics: {{ technique.tactics.join(' · ') }}
      </p>
      <p class="trd-info-desc">{{ cleanDescription }}</p>
      <p class="trd-info-foot">MITRE ATT&amp;CK technique · {{ technique.techniqueId }}</p>
    </div>
  </v-dialog>
</template>

<script setup>
  import { computed } from 'vue'

  const props = defineProps({
    // The technique to describe: { techniqueId, name?, tactics?, description? }.
    // null/absent ⇒ the dialog is closed.
    technique: { type: Object, default: null },
  })
  defineEmits(['close'])

  // MITRE descriptions carry markdown noise — inline "(Citation: …)" markers,
  // "[text](url)" links, and the odd HTML tag. Reduce to clean prose for reading.
  const cleanDescription = computed(() => {
    const d = props.technique?.description
    if (!d) return 'No description is available for this technique.'
    return d
      .replace(/\(Citation:[^)]*\)/g, '') // citation markers
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // markdown links → their text
      .replace(/<\/?[^>]+>/g, '') // stray HTML tags
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  })
</script>

<style scoped>
  .trd-info-panel {
    background: rgb(var(--v-theme-surface, 33 33 33));
    color: rgb(var(--v-theme-on-surface, 255 255 255));
    border: 1px solid rgba(127, 127, 127, 0.4);
    border-radius: 8px;
    max-height: 80vh;
    overflow-y: auto;
    padding: 1rem 1.2rem;
  }
  .trd-info-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .trd-info-title { margin: 0; font-size: 1.05rem; line-height: 1.3; }
  .trd-info-id { font-family: ui-monospace, monospace; }
  .trd-info-close { background: none; border: none; font: inherit; font-size: 1.1rem; color: inherit; opacity: 0.7; cursor: pointer; }
  .trd-info-close:hover { opacity: 1; }
  .trd-info-close:focus-visible { outline: 2px solid #00b8d4; outline-offset: 2px; }
  .trd-info-tactics { font-size: 0.78rem; opacity: 0.7; margin: 0.35rem 0 0.7rem; }
  .trd-info-desc { font-size: 0.85rem; line-height: 1.55; margin: 0; white-space: pre-wrap; }
  .trd-info-foot { font-size: 0.7rem; opacity: 0.5; margin: 0.9rem 0 0; }
</style>
