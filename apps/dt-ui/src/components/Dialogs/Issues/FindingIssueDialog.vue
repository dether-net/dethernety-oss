<script setup lang="ts">
  /**
   * FindingIssueDialog — the app-level, store-driven home for the finding→issue
   * workflow, mounted once in `layouts/default.vue` and opened from anywhere (incl.
   * module-loaded report surfaces) via `useHostContext().services
   * .openFindingIssueSelector` → `issueDialogStore.open()`.
   *
   * It presents the SAME two paths as the exposures tab's `IssueSelector` speed-dial —
   * "Add to Issue board" (copy + redirect) and one entry per issue class (create a
   * real issue, attached to the element, via the unchanged `IssueDialog`) — but as a
   * centred picker, since a module-triggered open has no FAB to anchor a speed-dial.
   * The name/description/element-id shapes mirror `SettingsExposuresTab.onAddIssue`/
   * `onCopyToIssue` exactly, so the report's issue workflow can't drift from dt-ui's.
   */
  import { ref, computed, watch, nextTick } from 'vue'
  import { useRouter } from 'vue-router'
  import type { Class } from '@dethernety/dt-core'
  import { useIssueStore } from '@/stores/issueStore'
  import { useIssueDialogStore } from '@/stores/issueDialogStore'
  import { getPageDisplayName } from '@/utils/dataFlowUtils'
  import IssueDialog from '@/components/Dialogs/Issues/IssueDialog.vue'

  const router = useRouter()
  const issueStore = useIssueStore()
  const store = useIssueDialogStore()

  // Once a class is picked, IssueDialog takes over (creates on mount); until then the
  // centred picker menu is shown. `mountIssue` mounts IssueDialog only AFTER the picker
  // overlay has started tearing down (next tick), so the two v-dialogs never transition
  // in the same frame — which can otherwise suppress the second overlay.
  const pickedClass = ref<Class | null>(null)
  const mountIssue = ref(false)
  // IssueDialog emits issue:added once it actually creates the issue, then stays open
  // for editing. We record that here and only resolve open() as { created } when the
  // card finally closes — so a created-then-closed flow is distinguished from a pure
  // cancel (which resolves null).
  const created = ref(false)
  const showPicker = computed(() => store.show && !pickedClass.value)

  const resetFlow = () => {
    pickedClass.value = null
    mountIssue.value = false
    created.value = false
  }

  // Reset local state whenever the store closes, so a re-open starts at the menu.
  watch(() => store.show, (open) => {
    if (!open) resetFlow()
  })
  // A re-open for a different finding while a create flow is mid-air must not leave the
  // previously-mounted IssueDialog showing the prior finding's form.
  watch(() => store.finding, () => resetFlow())

  // Capitalise + de-underscore, matching IssueSelector.onAddIssue.
  const displayName = computed(() => {
    const raw = store.finding?.name ?? ''
    return raw.charAt(0).toUpperCase() + raw.replaceAll('_', ' ').slice(1)
  })
  const onLabel = computed(() => (store.elementLabel ? ` Issue on ${store.elementLabel}` : ' Issue'))

  // Shapes mirror SettingsExposuresTab.onAddIssue.
  const issueName = computed(() => displayName.value + onLabel.value)
  const issueDescription = computed(() => 'Exposure: ' + (store.finding?.description ?? store.finding?.name ?? ''))
  // The report's analog of [componentId, modelId, exposureId].
  const elementIds = computed(() =>
    [store.elementId, store.modelId, store.finding?.id ?? ''].filter(Boolean),
  )

  const onPickClass = async (cls: Class) => {
    pickedClass.value = cls // hides the picker
    await nextTick() // let the picker overlay begin tearing down
    mountIssue.value = true // then mount IssueDialog (creates on mount)
  }

  // Board copy — mirrors SettingsExposuresTab.onCopyToIssue (name/description/elementIds/returnTo).
  const onAddToBoard = () => {
    const current = router.currentRoute.value
    // setIssueDataClipboard rejects an empty name; fall back for a nameless finding so
    // the board path can't throw inside this handler and wedge an unresolved promise.
    const name = displayName.value || 'Finding'
    issueStore.setIssueDataClipboard({
      name,
      description: name + onLabel.value + (store.finding?.description ?? ''),
      elementIds: [store.finding?.id ?? '', store.elementId, store.modelId],
      returnTo: {
        name: getPageDisplayName(current.path),
        path: current.path,
        query: { ...current.query },
      },
    })
    store.close({ copied: true })
    router.push({ name: 'issues' })
  }

  // IssueDialog created the issue; it stays open for editing, so just record it.
  const onIssueAdded = () => {
    created.value = true
  }
  // Card closed (× / cancel) — resolve created if a real create happened, else cancel.
  const onIssueCancel = () => {
    const wasCreated = created.value
    resetFlow()
    store.close(wasCreated ? { created: true } : null)
  }
  const onPickerClose = () => store.close(null)
</script>

<template>
  <!-- Class picker (the IssueSelector menu contents, as a centred modal). `persistent`
       (matching DispositionDialog) so the click that opens it isn't caught as a
       click-outside and dismissed — closed only via Cancel / Esc. -->
  <v-dialog
    :model-value="showPicker"
    max-width="440"
    persistent
    @keydown.esc="onPickerClose"
  >
    <v-card color="foreground">
      <v-card-title class="text-body-1 d-flex align-center">
        <v-icon class="mr-2" color="warning" icon="mdi-alert-plus-outline" size="small" />
        Raise an issue from this finding
      </v-card-title>
      <v-card-subtitle v-if="store.finding?.name" class="pb-0">
        {{ displayName }}
      </v-card-subtitle>
      <v-card-text class="d-flex flex-column pt-3">
        <v-btn
          color="secondary"
          variant="tonal"
          class="mb-2 justify-start"
          prepend-icon="mdi-clipboard-plus-outline"
          @click="onAddToBoard"
        >
          Add to Issue board
        </v-btn>
        <template v-if="issueStore.issueClasses.length">
          <v-divider class="my-2" />
          <div class="text-caption text-medium-emphasis mb-1">Or create an issue:</div>
          <v-btn
            v-for="cls in issueStore.issueClasses"
            :key="cls.id"
            color="secondary"
            variant="tonal"
            class="mb-1 justify-start"
            prepend-icon="mdi-plus-circle-outline"
            @click="onPickClass(cls)"
          >
            {{ cls.name }}
          </v-btn>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="onPickerClose">Cancel</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <!-- Create flow — reuses the platform IssueDialog (creates on mount, then edits).
       Mounted only after the picker overlay has begun closing (mountIssue), so the two
       dialogs don't transition in the same frame. -->
  <IssueDialog
    v-if="mountIssue && pickedClass"
    :show="true"
    :issue-class="pickedClass"
    :issue-name="issueName"
    :issue-description="issueDescription"
    :element-ids="elementIds"
    @cancel:issue="onIssueCancel"
    @issue:added="onIssueAdded"
  />
</template>
