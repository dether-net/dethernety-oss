<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import { useFlowStore } from '@/stores/flowStore'
  import type { Zone, Plane, Conduit, ConduitDirection } from '@dethernety/dt-core'
  import BoundaryPickerSheet from '@/components/DataFlow/BoundaryPicker/BoundaryPickerSheet.vue'
  import {
    ZONE_LABEL,
    ZONE_HINT,
    ZONE_SELECT_ITEMS,
    ROLE_LABEL,
    ROLE_ORDER,
    roleToPlanes,
    planesToRole,
    type Role,
  } from '@/utils/zoneColor'

  // Buffer-up shape (mirrors SettingsGeneralTab): the parent owns the buffer; this tab holds no form state,
  // reading props.zoning.* and emitting the full object on every edit. No gql — store getters only.
  interface ZoningBuffer {
    zone: Zone | null
    domains: string[]
    planes: Plane[]
    conduits: Conduit[]
  }

  const props = defineProps<{
    zoning: ZoningBuffer
    boundaryId: string
  }>()

  const emit = defineEmits<{
    'update:zoning': [value: ZoningBuffer]
  }>()

  const flowStore = useFlowStore()

  const patch = (delta: Partial<ZoningBuffer>) => {
    emit('update:zoning', { ...props.zoning, ...delta })
  }

  // ── Zone ──
  // Grouped select items ("Your tiers" / "Outside") are shared with the bulk overview (zoneColor.ts).
  const zoneItems = ZONE_SELECT_ITEMS

  const onZone = (value: Zone | null) => {
    patch({ zone: value ?? null })
  }

  // The resolved zone after inheritance — drives the ghost placeholder + the under-field consequence line
  // when no concrete zone is set here. Pure store getter (no backend).
  const effectiveZone = computed(() => flowStore.effectiveZone(props.boundaryId))

  // Ghost text shown inside the (empty) select when zone is unset: the inherited/default value, muted+italic.
  const ghostText = computed(() => {
    const ez = effectiveZone.value
    const base = ZONE_LABEL[ez.zone]
    if (ez.source === 'inherited') {
      const fromName = (flowStore.boundaryById(ez.from || '') as any)?.data?.label || 'a parent boundary'
      return `${base} (inherited from ${fromName})`
    }
    return `${base} (default)`
  })

  // Consequence line under the field — the selected zone's hint, or the ghosted effective one when unset.
  const consequenceHint = computed(() => ZONE_HINT[props.zoning.zone ?? effectiveZone.value.zone])

  const isUnset = computed(() => props.zoning.zone == null)

  // Visible-inheritance nudge: when no zone is set here but one is inherited, name the source and invite
  // an override (the silent-suppression trap — a too-coarse parent zone quietly weakens a child's findings).
  const inheritedFromName = computed(() => {
    const ez = effectiveZone.value
    if (ez.source !== 'inherited') return null
    return (flowStore.boundaryById(ez.from || '') as any)?.data?.label || 'a parent boundary'
  })

  // ── Tags (domain + role) ──
  // Hidden behind "+ Add tags" at rest; auto-open once anything is set (never re-collapse populated data).
  const tagsForced = ref(false)
  const hasTags = computed(() => props.zoning.domains.length > 0 || props.zoning.planes.length > 0)
  const showTags = computed(() => tagsForced.value || hasTags.value)
  // Reset the forced-open flag on any selection change; `showTags` still stays open for an already-tagged
  // boundary via `hasTags`, so populated data is never re-collapsed.
  watch(() => props.boundaryId, () => { tagsForced.value = false })

  const onDomains = (value: string[]) => {
    patch({ domains: Array.isArray(value) ? value : [] })
  }

  const role = computed<Role>(() => planesToRole(props.zoning.planes))
  const roleItems = computed(() =>
    ROLE_ORDER.map(r => ({ title: r === 'BOTH' ? `${ROLE_LABEL[r]} ⚠` : ROLE_LABEL[r], value: r })),
  )
  const onRole = (value: Role) => {
    patch({ planes: roleToPlanes(value) })
  }

  // ── Approved channels (authoring via the peer picker drawer, S5) ──
  const channelCount = computed(() => props.zoning.conduits.length)
  const peerName = (c: Conduit) =>
    c.peerName || ((flowStore.boundaryById(c.peerId) as any)?.data?.label ?? c.peerId)

  const pickerOpen = ref(false)

  // Drawer confirm → append the authored conduit(s) to the buffer (no controlRefs — not author-settable in
  // v1). A bidirectional add arrives as 1–2 specs in ONE event, appended in a single patch: emitting two
  // events would race on the prop round-trip and drop the first. The parent Save commits via the existing
  // store path; dt-core dedupes per (peer, direction).
  const onAddChannel = (
    specs: { peerId: string; peerName: string; direction: ConduitDirection; justification?: string }[],
  ) => {
    patch({ conduits: [...props.zoning.conduits, ...specs.map(s => ({ ...s }))] })
  }

  const removeChannel = (index: number) => {
    patch({ conduits: props.zoning.conduits.filter((_, i) => i !== index) })
  }
</script>

<template>
  <v-card flat>
    <v-container class="zoning-tab">
      <!-- First-use teaching line — only while no concrete zone is set here. -->
      <p v-if="isUnset" class="text-caption text-medium-emphasis mb-2 zoning-firstuse">
        Optionally place this boundary on your trust gradient — everything here is optional; skip what doesn't apply.
      </p>

      <!-- Trust zone -->
      <v-select
        class="zone-select"
        :class="{ 'zone-ghosted': isUnset }"
        label="Trust zone"
        :model-value="props.zoning.zone"
        :items="zoneItems"
        item-title="title"
        item-value="value"
        :placeholder="isUnset ? ghostText : undefined"
        :persistent-placeholder="isUnset"
        clearable
        hide-details
        density="comfortable"
        aria-describedby="zone-hint"
        @update:model-value="onZone"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-subheader v-if="item.raw.type === 'subheader'">{{ item.raw.title }}</v-list-subheader>
          <v-list-item v-else v-bind="itemProps" :subtitle="item.raw.subtitle" />
        </template>
      </v-select>
      <p id="zone-hint" class="text-caption text-medium-emphasis mt-1 mb-0 zone-consequence">
        {{ consequenceHint }}
      </p>
      <!-- Over-claim guardrail — once, quietly, under the zone field. -->
      <p class="text-caption text-disabled mt-0 mb-1 zone-guardrail">
        Declared design intent, not verified evidence.
      </p>
      <!-- Inheritance nudge — only while unset and inheriting a zone from an ancestor. -->
      <p v-if="isUnset && inheritedFromName" class="text-caption text-medium-emphasis mt-0 mb-3 zone-inherited-note">
        Inherited from {{ inheritedFromName }}. Set it here if this boundary differs.
      </p>
      <div v-else class="mb-2" />

      <!-- Tags: domain + role, behind "+ Add tags" at rest -->
      <v-btn
        v-if="!showTags"
        class="add-tags-btn px-0"
        color="secondary"
        size="small"
        variant="text"
        prepend-icon="mdi-plus"
        @click="tagsForced = true"
      >
        Add tags
      </v-btn>

      <v-row v-else class="tags-row" no-gutters>
        <v-col cols="7" class="pr-2">
          <v-combobox
            class="domains-combobox"
            label="Business function"
            :model-value="props.zoning.domains"
            multiple
            chips
            closable-chips
            hide-details
            density="comfortable"
            placeholder="e.g. erp, payments"
            @update:model-value="onDomains"
          />
        </v-col>
        <v-col cols="5">
          <v-select
            class="role-select"
            label="Role"
            :model-value="role"
            :items="roleItems"
            item-title="title"
            item-value="value"
            hide-details
            density="comfortable"
            @update:model-value="onRole"
          >
            <template #append-inner>
              <v-tooltip
                location="top"
                text="Workload by default. Pick Management only if this also runs admin / control infrastructure."
              >
                <template #activator="{ props: tProps }">
                  <v-icon v-bind="tProps" size="x-small" icon="mdi-help-circle-outline" />
                </template>
              </v-tooltip>
            </template>
          </v-select>
        </v-col>
      </v-row>

      <!-- Approved channels — authored via the peer picker drawer ("+ Add"); rows removable inline. -->
      <v-expansion-panels class="channels-panels mt-3" variant="accordion">
        <v-expansion-panel>
          <v-expansion-panel-title>
            <span class="channels-title">Approved channels ({{ channelCount }})</span>
            <v-spacer />
            <v-btn
              class="add-channel-btn"
              size="x-small"
              variant="text"
              color="secondary"
              prepend-icon="mdi-plus"
              @click.stop="pickerOpen = true"
            >
              Add
            </v-btn>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <p v-if="channelCount === 0" class="text-caption text-medium-emphasis mb-0">
              No approved channels declared.
            </p>
            <ul v-else class="channels-list">
              <li v-for="(c, i) in props.zoning.conduits" :key="c.peerId + '-' + c.direction + '-' + i" class="channel-row">
                <span class="channel-glyph">{{ c.direction === 'OUTBOUND' ? '→' : '←' }}</span>
                <span class="channel-peer">{{ peerName(c) }}</span>
                <span class="channel-dir text-medium-emphasis">{{ c.direction === 'OUTBOUND' ? 'out' : 'in' }}</span>
                <span v-if="c.justification" class="channel-why text-medium-emphasis">{{ c.justification }}</span>
                <v-spacer />
                <v-btn
                  class="remove-channel-btn"
                  :aria-label="`Remove channel to ${peerName(c)}`"
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  density="comfortable"
                  @click="removeChannel(i)"
                />
              </li>
            </ul>
            <p class="text-caption text-medium-emphasis mt-2 mb-0">
              Channels you intend and accept. The analysis judges them.
            </p>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-container>

    <!-- Peer picker drawer (teleports to body, z-index 2500 → floats above the settings window). -->
    <BoundaryPickerSheet
      v-model="pickerOpen"
      :current-boundary-id="props.boundaryId"
      :existing-conduits="props.zoning.conduits"
      @commit-request="onAddChannel"
    />
  </v-card>
</template>

<style scoped>
  .zoning-tab {
    max-height: 290px;
    overflow-y: auto;
  }
  /* Ghosted (inherited/default) zone placeholder: muted + italic, never a hue cue. */
  .zone-ghosted :deep(input::placeholder) {
    font-style: italic;
    opacity: 0.7;
  }
  .channels-title {
    font-weight: 500;
  }
  .channels-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .channel-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 2px 0;
  }
  .channel-glyph {
    width: 1rem;
    text-align: center;
  }
  .channel-peer {
    font-weight: 500;
  }
  .channel-why {
    font-style: italic;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
