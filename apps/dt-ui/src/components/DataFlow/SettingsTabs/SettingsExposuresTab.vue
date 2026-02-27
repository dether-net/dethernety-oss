<script setup lang="ts">
  import { ref } from 'vue'
  import type { Edge, Node } from '@vue-flow/core'
  import { Class, Exposure } from '@dethernety/dt-core'
  import { useFlowStore } from '@/stores/flowStore'
  import { useIssueStore } from '@/stores/issueStore'
  import { useRouter } from 'vue-router'
  import { getPageDisplayName } from '@/utils/dataFlowUtils'
  import ExposureDialog from '@/components/Dialogs/DataFlow/ExposureDialog.vue'
  import AttackTechniqueDialog from '@/components/Dialogs/Mitre/AttackTechniqueDialog.vue'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'
  import IssueDialog from '@/components/Dialogs/Issues/IssueDialog.vue'

  // Props
  interface Props {
    selectedItem: Node | Edge | null;
    exposures: Exposure[];
  }

  const props = defineProps<Props>()

  // Emits
  const emit = defineEmits<{
    'updateForm': [];
    'redirect:issue': [];
  }>()

  // Stores
  const flowStore = useFlowStore()
  const issueStore = useIssueStore()
  const router = useRouter()

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
        const deleted = await flowStore.deleteExposure({ exposureId: exposureToDelete.value })
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
    // Get current route information dynamically
    const currentRoute = router.currentRoute.value
    const returnTo = {
      name: getPageDisplayName(currentRoute.path),
      path: currentRoute.path,
      query: { ...currentRoute.query },
    }

    issueStore.setIssueDataClipboard({
      name: data.name,
      description: data.name + ' Issue on ' + (props.selectedItem?.data?.label as string) + data.description,
      elementIds: [data.id, flowStore.selectedItem?.id || '', flowStore.modelId || ''],
      returnTo,
    })
    emit('redirect:issue')
  }

  const onIssueAdded = () => {
    showIssueDialog.value = false
    issueClass.value = null
    issueExposureId.value = ''
  }

</script>

<template>
  <div>
    <v-data-table
      v-if="selectedItem"
      class="exposures-table"
      :headers="exposureTableHeaders"
      :items="props.exposures"
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
        <span class="text-capitalize" @click="editExposure(item.id)">{{ item.name.replaceAll('_', ' ') }}</span>
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
        <div class="d-flex flex-column justify-end">
          <IssueSelector
            :id="item.id || ''"
            :name="item.name || ''"
            :description="item.description || ''"
            @add:issue="onAddIssue"
            @copy:issue="onCopyToIssue"
          />
          <v-btn
            class="mt-1"
            color="primary"
            icon="mdi-pencil"
            variant="plain"
            @click="editExposure(item.id)"
          />
          <v-btn
            class="mt-1"
            color="error"
            icon="mdi-trash-can"
            variant="plain"
            @click="deleteExposure(item.id)"
          />
        </div>
      </template>
    </v-data-table>
    <v-alert v-else dismissible type="info">No item selected.</v-alert>

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
      @issue:added="onIssueAdded"
    />
  </div>
</template>

<style scoped>
  .exposures-table {
    max-height: 300px;
    overflow-y: auto;
  }
</style>
