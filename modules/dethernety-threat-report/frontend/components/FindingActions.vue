<!--
  FindingActions.vue — the per-finding lifecycle action cluster for the residual-risk
  views (Residual Risk ledger + Component Profile). Presentational only: it renders
  the ordered 2×2 from actionsFor(finding) as compact glyph buttons (icon-button form,
  like the dt-ui exposures tab) and EMITS a semantic event per click; the shell
  (ThreatReportShell) owns host context and routes each to the centralized host action
  service (affirm / dispose / supersede / add-note / delete / issue). Mirrors the
  dt-ui exposures tab so the two surfaces don't drift.

  Layout: inline 2-column grid — a pending SYSTEM row reads [✓ ⊘] / [⧉ ⚑]; fewer-action
  states degrade to 2+1 / 1 without a ragged grid. Each glyph carries a title +
  aria-label. Delete is a two-step in-place confirm: the first click arms it (turns
  red), the second deletes — so a misclick is recoverable, no modal needed.
-->
<template>
  <div class="trd-actions" v-if="canDispose">
    <template v-for="a in actions" :key="a.key">
      <!-- Delete: single glyph that arms (red) on first click, deletes on the second. -->
      <button
        v-if="a.event === 'delete'"
        type="button"
        class="trd-act trd-act--danger"
        :class="{ 'trd-act--armed': confirmingDelete }"
        :title="confirmingDelete ? `Click again to delete “${finding.name}”` : a.title"
        :aria-label="confirmingDelete ? `Confirm delete ${finding.name}` : a.label"
        @click="onDeleteClick"
      >{{ a.icon }}</button>
      <!-- All other actions emit directly. -->
      <button
        v-else
        type="button"
        class="trd-act"
        :class="accentClass(a.accent)"
        :title="a.title"
        :aria-label="a.label"
        @click="emitAction(a.event)"
      >{{ a.icon }}</button>
    </template>
  </div>
</template>

<script setup>
  import { ref, computed, watch } from 'vue'
  import { actionsFor } from '../lib/findingActions.js'

  const props = defineProps({
    finding: { type: Object, required: true },
    // The host element id the finding belongs to (its group / profile element) —
    // needed by supersede + issue, passed straight through in the emit payload.
    elementId: { type: String, default: '' },
    // Gate: only render when the host exposes the disposition/action services
    // (older host builds won't) — avoids silently-inert buttons.
    canDispose: { type: Boolean, default: false },
  })

  const emit = defineEmits(['affirm', 'dispose', 'supersede', 'add-note', 'delete', 'issue'])

  const actions = computed(() => actionsFor(props.finding))

  // Two-step delete confirm, reset if the row's finding changes underneath us.
  const confirmingDelete = ref(false)
  watch(() => props.finding?.id, () => { confirmingDelete.value = false })

  const emitAction = (event) => emit(event, { finding: props.finding, elementId: props.elementId })
  const onDeleteClick = () => {
    if (confirmingDelete.value) {
      confirmingDelete.value = false
      emitAction('delete')
    } else {
      confirmingDelete.value = true
    }
  }

  const accentClass = (accent) =>
    accent === 'affirm' ? 'trd-act--affirm'
      : accent === 'danger' ? 'trd-act--danger'
        : accent === 'warn' ? 'trd-act--warn'
          : null
</script>

<style scoped>
  /* Inline 2-column grid → [✓ ⊘] / [⧉ ⚑] for a 4-action (pending) row; 2+1 / 1 for
     fewer actions. Right-aligned in the (narrow) action column. */
  .trd-actions {
    display: inline-grid;
    grid-template-columns: repeat(2, 1.45rem);
    gap: 2px;
    justify-content: end;
  }
  /* Compact glyph buttons — the icon-button analogue of the dt-ui 2×2. */
  .trd-act {
    width: 1.45rem;
    height: 1.45rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 3px;
    padding: 0;
    font: inherit;
    font-size: 0.82rem;
    line-height: 1;
    cursor: pointer;
    opacity: 0.7;
  }
  .trd-act:hover { opacity: 1; }
  .trd-act:focus-visible { outline: 2px solid #00b8d4; outline-offset: 1px; }
  /* Affirm — a distinct cyan accent so the confirm-as-live-risk action reads at a
     glance (never green; green stays reserved for "in place" elsewhere). */
  .trd-act--affirm { color: #0892ad; opacity: 1; }
  .trd-act--affirm:hover { background: rgba(0, 184, 212, 0.14); }
  .trd-act--danger { color: #c0392b; }
  .trd-act--danger:hover { background: rgba(192, 57, 43, 0.1); }
  /* Armed delete: filled red so the next click reads as destructive. */
  .trd-act--armed { background: #c0392b; color: #fff; opacity: 1; }
  .trd-act--warn { color: #b9651b; opacity: 0.9; }
  .trd-act--warn:hover { background: rgba(185, 101, 27, 0.1); }
</style>
