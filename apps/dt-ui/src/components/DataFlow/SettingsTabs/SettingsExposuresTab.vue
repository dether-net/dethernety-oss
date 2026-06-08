<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import {
    Class, Exposure,
    type DispositionMutationResult,
  } from '@dethernety/dt-core'
  import { useFlowStore } from '@/stores/flowStore'
  import { useIssueStore } from '@/stores/issueStore'
  import { useRouter } from 'vue-router'
  import {
    useFindingDisposition,
    emptyDispositionDialogState,
    dispositionStateFor,
    affirmDialogStateFor,
    type SnackBarState,
  } from '@/composables/useFindingDisposition'
  import { getPageDisplayName } from '@/utils/dataFlowUtils'
  import ExposureDialog from '@/components/Dialogs/DataFlow/ExposureDialog.vue'
  import DispositionDialog from '@/components/Dialogs/Exposure/DispositionDialog.vue'
  import LifecycleBadge from '@/components/Disposition/LifecycleBadge.vue'
  import AttackTechniqueDialog from '@/components/Dialogs/Mitre/AttackTechniqueDialog.vue'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'
  import IssueDialog from '@/components/Dialogs/Issues/IssueDialog.vue'

  // Props. `selectedItem` is the host element the exposures belong to — a vue-flow
  // Node/Edge (the SettingsWindow canvas selection) OR a minimal { id, data: { label } }
  // shape (e.g. a Data entity opened from DataDialog). Only `.id` (element id, used as
  // the supersede/create target) and `.data?.label` (display name) are read.
  interface Props {
    selectedItem: Node | Edge | { id: string; data?: { label?: string | null } } | null;
    exposures: Exposure[];
  }

  const props = defineProps<Props>()

  // Emits
  const emit = defineEmits<{
    'updateForm': [];
    'redirect:issue': [];
    /** Parent renders the badge using this count. */
    'update:staleCount': [count: number];
    /** Parent renders the "awaiting review" badge using this count. */
    'update:pendingCount': [count: number];
  }>()

  // Stores
  const flowStore = useFlowStore()
  const issueStore = useIssueStore()
  const router = useRouter()

  // Shared disposition surface (provenance, kind label, sort, dialog state) —
  // see useFindingDisposition. The Exposure tab and the
  // ControlDialog countermeasures sub-table consume the same helpers.
  const {
    provenanceInfo,
    isUserAuthored,
    dispositionKindLabel,
    lifecycleStatus,
    affirmReasonFor,
    partitionAndSort,
    rowClass,
    DISPOSE_ICON,
    AFFIRM_ICON,
    ERROR_MESSAGES,
  } = useFindingDisposition()

  // Data
  const exposureTableHeaders = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
    { title: 'Exploited By', key: 'exploitedBy' },
    { title: '', key: 'actions' },
  ]

  const itemsPerPage = [
    { value: 5, title: '5' },
    { value: 10, title: '10' },
    { value: 25, title: '25' },
    { value: 50, title: '50' },
    { value: -1, title: '$vuetify.dataFooter.itemsPerPageAll' },
  ]

  // Sort on tab mount only — disposing a row mid-scroll should
  // not make it jump out of the user's viewport.
  const sortedExposures = ref<Exposure[]>([])

  watch(() => props.exposures, next => {
    sortedExposures.value = partitionAndSort(next)
  }, { immediate: true })

  // Expose stale count to parent for the tab badge.
  const exposureStaleCount = computed(() =>
    props.exposures.filter(e => e.dispositionStale === true).length,
  )
  watch(exposureStaleCount, count => {
    emit('update:staleCount', count)
  }, { immediate: true })

  // Expose the pending (unreviewed) backlog count for the per-tab PendingBadge.
  const exposurePendingCount = computed(() =>
    props.exposures.filter(e => lifecycleStatus(e) === 'pending').length,
  )
  watch(exposurePendingCount, count => {
    emit('update:pendingCount', count)
  }, { immediate: true })

  // Exposures-related refs
  const showExposureDialog = ref(false)
  const exposureDialogAction = ref<'create' | 'edit'>('create')
  const exposureToEdit = ref('')
  const showAttackTechniqueDialog = ref(false)
  const attackTechniqueId = ref('')
  const showExposureDeleteDialog = ref(false)
  const exposureToDelete = ref('')

  const showIssueDialog = ref(false)
  const issueClass = ref<Class | null>(null)
  const issueExposureId = ref('')
  const issueName = ref('')
  const issueDescription = ref('')

  // Disposition dialog state (shape from useFindingDisposition).
  const dispositionDialog = ref(emptyDispositionDialogState())

  // Snackbar with optional action button (e.g. Retry on supersede partial-failure).
  const snackBar = ref<SnackBarState>({
    show: false, color: 'success', message: '', action: null,
  })

  const createExposure = () => {
    exposureDialogAction.value = 'create'
    showExposureDialog.value = true
  }

  const editExposure = (exposureId: string) => {
    exposureToEdit.value = exposureId
    exposureDialogAction.value = 'edit'
    showExposureDialog.value = true
  }

  const deleteExposure = (exposureId: string) => {
    exposureToDelete.value = exposureId
    showExposureDeleteDialog.value = true
  }

  const onExposureDelete = async () => {
    if (exposureToDelete.value) {
      try {
        const exposure = props.exposures.find(e => e.id === exposureToDelete.value)
        const deleted = await flowStore.deleteExposure({
          exposureId: exposureToDelete.value,
          // Pass the name so dt-core fires the
          // USER-copy-delete companion call that flips dispositionStale on any
          // SYSTEM exposure superseded by this USER copy.
          exposureName: exposure?.name,
        })
        if (deleted) {
          showExposureDeleteDialog.value = false
          exposureToDelete.value = ''
          emit('updateForm')
        }
      } catch (error) {
        console.error('Failed to delete exposure', error)
      }
    }
  }

  const openAttackTechniqueDialog = (techniqueId: string) => {
    attackTechniqueId.value = techniqueId
    showAttackTechniqueDialog.value = true
  }

  const onExposureCreated = () => {
    showExposureDialog.value = false
    emit('updateForm')
  }

  const onExposureUpdated = () => {
    showExposureDialog.value = false
    emit('updateForm')
  }

  const onExposureDialogClosed = () => {
    showExposureDialog.value = false
    exposureToEdit.value = ''
  }

  const onDeleteCanceled = () => {
    showExposureDeleteDialog.value = false
    exposureToDelete.value = ''
  }

  const onAttackTechniqueDialogClosed = () => {
    showAttackTechniqueDialog.value = false
    attackTechniqueId.value = ''
  }

  const onAddIssue = (data: {issueClass: Class, id: string, name: string, description: string}) => {
    issueClass.value = data.issueClass
    issueExposureId.value = data.id
    issueName.value = data.name + ' Issue on ' + (props.selectedItem?.data?.label as string)
    issueDescription.value = 'Exposure: ' + data.description
    showIssueDialog.value = true
  }

  const onCopyToIssue = (data: {id: string, name: string, description: string}) => {
    const currentRoute = router.currentRoute.value
    const returnTo = {
      name: getPageDisplayName(currentRoute.path),
      path: currentRoute.path,
      query: { ...currentRoute.query },
    }
    issueStore.setIssueDataClipboard({
      name: data.name,
      description: data.name + ' Issue on ' + (props.selectedItem?.data?.label as string) + data.description,
      // Attach the host element (props.selectedItem — the Data entity when this tab is
      // reused inside DataDialog) as well as the canvas selection, matching the create
      // path's element set. Sourcing only flowStore.selectedItem dropped the Data
      // entity from board issues raised off a Data-entity exposure.
      elementIds: [data.id, props.selectedItem?.id || '', flowStore.selectedItem?.id || '', flowStore.modelId || ''],
      returnTo,
    })
    emit('redirect:issue')
  }

  // Dispose / re-affirm action.
  const onDispose = (item: Exposure) => {
    dispositionDialog.value = dispositionStateFor(item)
  }

  const onDispositionSaved = (_result: DispositionMutationResult) => {
    dispositionDialog.value.show = false
    emit('updateForm')
  }

  const onDispositionCleared = (_result: DispositionMutationResult) => {
    dispositionDialog.value.show = false
    emit('updateForm')
  }

  const onDispositionDialogClose = () => {
    dispositionDialog.value.show = false
  }

  // One-click affirm: confirm a pending finding is a real, live risk. Awaits the
  // mutation and only refreshes on success — the row never shows `confirmed` until
  // the server attributes it, so a `success:false` can't manufacture a false
  // confirmation (it simply stays pending). Undo clears back to pending; the durable
  // "Add note…" path is the affirm-edit dialog on the now-confirmed row.
  const onAffirm = async (item: Exposure) => {
    const result = await flowStore.disposeExposure({
      exposureId: item.id,
      kind: 'AFFIRMED',
      reason: affirmReasonFor('EXPOSURE'),
    })
    if (!result.success) {
      const reason = ERROR_MESSAGES[result.errorCode ?? ''] ?? 'an unexpected error'
      snackBar.value = {
        show: true, color: 'error',
        message: `Couldn't affirm "${item.name}" (${reason}).`,
        action: null,
      }
      return
    }
    emit('updateForm')
    snackBar.value = {
      show: true,
      color: 'success',
      message: `Affirmed "${item.name}" as a live risk.`,
      timeout: 6000, // finite even though it carries an action (Undo)
      action: {
        label: 'Undo',
        handler: async () => {
          const undo = await flowStore.clearDisposition({ exposureId: item.id })
          if (undo.success) {
            emit('updateForm')
          } else {
            const reason = ERROR_MESSAGES[undo.errorCode ?? ''] ?? 'an unexpected error'
            snackBar.value = {
              show: true, color: 'error',
              message: `Couldn't undo — "${item.name}" is still affirmed (${reason}).`,
              action: null,
            }
          }
        },
      },
    }
  }

  // Affirm-edit (re-affirm / "Add note…"): opens the dialog locked to AFFIRMED so the
  // reason can be edited without converting the finding into a disposal.
  const onAffirmEdit = (item: Exposure) => {
    dispositionDialog.value = affirmDialogStateFor(item)
  }

  // A stale live row's Review re-affirms via the affirm-edit dialog when confirmed,
  // or the normal dispose dialog when it's a (stale) disposition.
  const onReview = (item: Exposure) => {
    if (lifecycleStatus(item) === 'confirmed') onAffirmEdit(item)
    else onDispose(item)
  }

  // Supersede orchestration handler.
  const onSupersede = async (item: Exposure) => {
    if (!props.selectedItem) return
    try {
      const { userCopy, systemDispositionResult } = await flowStore.supersedeExposure({
        exposureId: item.id,
        elementId: props.selectedItem.id,
        exposure: item,
      })
      if (!systemDispositionResult.success) {
        const reason = ERROR_MESSAGES[systemDispositionResult.errorCode ?? ''] ?? 'an unexpected error'
        snackBar.value = {
          show: true,
          color: 'warning',
          message: `Your editable copy was created, but marking the original as superseded failed (${reason}).`,
          action: {
            label: 'Retry',
            handler: async () => {
              const retry = await flowStore.disposeExposure({
                exposureId: item.id,
                kind: 'SUPERSEDED',
                reason: `Superseded by user-authored exposure '${userCopy.name}'`,
              })
              if (!retry.success) {
                snackBar.value = {
                  show: true, color: 'error',
                  message: "Couldn't mark the original as superseded. You can dispose it manually from the actions column.",
                  action: null,
                }
              } else {
                snackBar.value = {
                  show: true, color: 'success',
                  message: `Marked the original "${item.name}" as superseded.`,
                  action: null,
                }
                emit('updateForm')
              }
            },
          },
        }
      } else {
        snackBar.value = {
          show: true, color: 'success',
          message: `Created your editable copy of "${item.name}". Edit it from this list.`,
          action: null,
        }
      }
      emit('updateForm')
    } catch (err) {
      snackBar.value = {
        show: true, color: 'error',
        message: `Supersede failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        action: null,
      }
    }
  }
</script>

<template>
  <div>
    <v-data-table
      v-if="selectedItem"
      class="exposures-table"
      :headers="exposureTableHeaders"
      :items="sortedExposures"
      :row-props="({ item }) => ({ class: rowClass(item) })"
      items-per-page="5"
      :items-per-page-options="itemsPerPage"
    >
      <template #top>
        <div class="d-flex justify-end mt-1 mr-5">
          <v-btn
            class="mx-2 my-0"
            color="secondary"
            icon="mdi-plus"
            variant="outlined"
            @click="createExposure"
          />
        </div>
      </template>

      <template #item.name="{ item }">
        <div class="d-flex flex-column py-1">
          <div class="d-flex align-center">
            <v-tooltip v-if="provenanceInfo(item).kind !== 'none'" :text="provenanceInfo(item).tooltip" location="top">
              <template #activator="{ props: tooltipProps }">
                <v-icon
                  v-bind="tooltipProps"
                  :color="provenanceInfo(item).iconColor"
                  size="18"
                  class="mr-2"
                  :icon="provenanceInfo(item).iconName"
                />
              </template>
            </v-tooltip>
            <span class="text-capitalize" @click="editExposure(item.id)">{{ item.name?.replaceAll('_', ' ') }}</span>
          </div>
          <LifecycleBadge :item="item" finding-type="EXPOSURE" />
        </div>
      </template>
      <template #item.exploitedBy="{ item }">
        <div>
          <v-chip
            v-for="templ in item.exploitedBy || []"
            :key="templ.id"
            class="ma-1"
            small
            @click="openAttackTechniqueDialog(templ.attack_id)"
          >
            {{ templ.name + ' (' + templ.attack_id + ')' }}
          </v-chip>
        </div>
      </template>
      <template #item.actions="{ item }">
        <!-- Actions wrap into a compact 2-col grid: the triage pair (Affirm/Dispose
             or the lifecycle action) leads, then structural (supersede/edit), then
             issue — so a pending row reads as [Affirm Dispose] / [Supersede Issue],
             and fewer-action states (confirmed/disposed/USER) degrade cleanly. -->
        <div class="actions-grid">
          <!-- Lifecycle (leads). USER → delete. SYSTEM → Review (stale) |
               Affirm + Dispose (pending) | Add note (confirmed) | Edit disposition (disposed). -->
          <v-tooltip v-if="isUserAuthored(item)" text="Delete exposure" location="top">
            <template #activator="{ props: tProps }">
              <v-btn
                v-bind="tProps"
                aria-label="Delete exposure"
                icon="mdi-trash-can"
                color="error"
                variant="plain"
                @click="deleteExposure(item.id)"
              />
            </template>
          </v-tooltip>
          <v-tooltip
            v-else-if="item.dispositionStale"
            text="Model changed — review and re-affirm this disposition"
            location="top"
          >
            <template #activator="{ props: tProps }">
              <v-btn
                v-bind="tProps"
                aria-label="Review and re-affirm disposition"
                color="warning"
                variant="text"
                prepend-icon="mdi-refresh"
                @click="onReview(item)"
              >Review</v-btn>
            </template>
          </v-tooltip>
          <template v-else-if="lifecycleStatus(item) === 'pending'">
            <v-tooltip text="Affirm — confirm this is a real, live risk" location="top">
              <template #activator="{ props: tProps }">
                <v-btn
                  v-bind="tProps"
                  aria-label="Affirm exposure"
                  :icon="AFFIRM_ICON"
                  color="info"
                  variant="plain"
                  @click="onAffirm(item)"
                />
              </template>
            </v-tooltip>
            <v-tooltip text="Dispose" location="top">
              <template #activator="{ props: tProps }">
                <v-btn
                  v-bind="tProps"
                  aria-label="Dispose"
                  :icon="DISPOSE_ICON"
                  color="secondary"
                  variant="plain"
                  @click="onDispose(item)"
                />
              </template>
            </v-tooltip>
          </template>
          <v-tooltip
            v-else-if="lifecycleStatus(item) === 'confirmed'"
            text="Add a note to this confirmation"
            location="top"
          >
            <template #activator="{ props: tProps }">
              <v-btn
                v-bind="tProps"
                aria-label="Add a note to this confirmation"
                icon="mdi-note-edit-outline"
                color="tertiary"
                variant="plain"
                @click="onAffirmEdit(item)"
              />
            </template>
          </v-tooltip>
          <v-tooltip
            v-else
            :text="`Edit disposition (${dispositionKindLabel(item.dispositionKind)})`"
            location="top"
          >
            <template #activator="{ props: tProps }">
              <v-btn
                v-bind="tProps"
                aria-label="Edit disposition"
                :icon="DISPOSE_ICON"
                color="tertiary"
                variant="plain"
                @click="onDispose(item)"
              />
            </template>
          </v-tooltip>

          <!-- Structural: edit (USER) | supersede (SYSTEM). -->
          <v-tooltip v-if="isUserAuthored(item)" text="Edit exposure" location="top">
            <template #activator="{ props: tProps }">
              <v-btn
                v-bind="tProps"
                aria-label="Edit exposure"
                icon="mdi-pencil"
                variant="plain"
                @click="editExposure(item.id)"
              />
            </template>
          </v-tooltip>
          <!-- Supersede only on LIVE rows (pending/confirmed), matching ControlDialog
               and the threat-report module — a disposed finding isn't superseded. -->
          <v-tooltip
            v-else-if="lifecycleStatus(item) !== 'disposed'"
            text="Customize as an editable copy"
            location="top"
          >
            <template #activator="{ props: tProps }">
              <v-btn
                v-bind="tProps"
                aria-label="Customize as an editable copy"
                color="secondary"
                icon="mdi-content-duplicate"
                variant="plain"
                @click="onSupersede(item)"
              />
            </template>
          </v-tooltip>

          <!-- Issue (last). -->
          <IssueSelector
            :id="item.id || ''"
            :name="item.name || ''"
            :description="item.description || ''"
            @add:issue="onAddIssue"
            @copy:issue="onCopyToIssue"
          />
        </div>
      </template>
    </v-data-table>
    <v-alert v-else type="info">No item selected.</v-alert>

    <ExposureDialog
      v-if="showExposureDialog"
      :action="exposureDialogAction"
      :element-id="selectedItem?.id"
      :exposure-id="exposureToEdit ? exposureToEdit : undefined"
      :show-dialog="showExposureDialog"
      @update:exposure-created="onExposureCreated"
      @update:exposure-updated="onExposureUpdated"
      @update:show-dialog="onExposureDialogClosed"
    />
    <AttackTechniqueDialog
      v-if="showAttackTechniqueDialog"
      :attack-id="attackTechniqueId"
      :show="showAttackTechniqueDialog"
      @close="onAttackTechniqueDialogClosed"
    />
    <ConfirmDeleteDialog
      v-if="showExposureDeleteDialog"
      :message="`Are you sure you want to delete this Exposure: ${props.exposures.find(exposure => exposure.id === exposureToDelete)?.name ?? ''}?`"
      :show="showExposureDeleteDialog"
      @delete:canceled="onDeleteCanceled"
      @delete:confirmed="onExposureDelete"
    />
    <IssueDialog
      v-if="showIssueDialog"
      :element-ids="[selectedItem?.id || '', flowStore.selectedItem?.id || '', flowStore.modelId || '', issueExposureId || '']"
      :issue-class="issueClass || undefined"
      :issue-description="issueDescription"
      :issue-name="issueName"
      :show="showIssueDialog"
      @cancel:issue="showIssueDialog = false"
    />

    <!-- Disposition dialog -->
    <DispositionDialog
      v-if="dispositionDialog.show"
      :show-dialog="dispositionDialog.show"
      finding-type="EXPOSURE"
      :finding-id="dispositionDialog.findingId"
      :finding-name="dispositionDialog.findingName"
      :initial-kind="dispositionDialog.initialKind"
      :initial-reason="dispositionDialog.initialReason"
      :is-stale="dispositionDialog.isStale"
      :lock-kind="dispositionDialog.lockKind"
      :initial-dispositioned-by="dispositionDialog.initialDispositionedBy"
      :initial-dispositioned-at="dispositionDialog.initialDispositionedAt"
      @close="onDispositionDialogClose"
      @saved="onDispositionSaved"
      @cleared="onDispositionCleared"
    />

    <!-- Snackbar with optional action button (Retry on supersede partial-failure;
         Undo on affirm). An explicit timeout overrides the action ? -1 default so the
         affirm Undo snackbar still auto-dismisses. -->
    <v-snackbar
      v-model="snackBar.show"
      :color="snackBar.color"
      :timeout="snackBar.timeout ?? (snackBar.action ? -1 : 5000)"
      top
    >
      <span>{{ snackBar.message }}</span>
      <template v-if="snackBar.action" #actions>
        <v-btn variant="text" @click="snackBar.action?.handler()">{{ snackBar.action.label }}</v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<style scoped>
  .exposures-table {
    max-height: 300px;
    overflow-y: auto;
  }
  /* Yellow left border for stale dispositioned rows. */
  :deep(.row-stale) {
    border-left: 4px solid rgb(var(--v-theme-warning));
  }
  /* Row actions as a compact, right-aligned 2-column grid. Four actions (a pending
     row) form a 2×2; fewer actions degrade to 2+1 / 1 without a ragged grid. */
  .actions-grid {
    display: inline-grid;
    grid-template-columns: repeat(2, min-content);
    align-items: center;
    justify-items: center;
    float: right;
  }
</style>
