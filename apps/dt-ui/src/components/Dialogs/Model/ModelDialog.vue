<script setup lang="ts">
  import { onMounted, ref, watch } from 'vue'
  import { useModelsStore } from '@/stores/modelsStore'
  import { useRouter } from 'vue-router'
  import { Class, Control, Model, ModelScopeLocal, RECOMMENDED_COMPLIANCE_DRIVERS, platformScopeToLocal } from '@dethernety/dt-core'
  import { useIssueStore } from '@/stores/issueStore'
  import { getPageDisplayName } from '@/utils/dataFlowUtils'

  interface Props {
    show: boolean
    id: string
    showFileActions: boolean
  }

  interface SnackBar {
    show: boolean
    message: string
    color: string
  }

  const props = defineProps<Props>()
  const showModelDialog = ref(props.show)
  const modelId = ref(props.id)

  const tab = ref<string | unknown>('general')
  const router = useRouter()
  const modelsStore = useModelsStore()
  const issueStore = useIssueStore()
  const model = ref<Model | null>(null)
  const emits = defineEmits(['model:saved', 'model:open', 'model:moved', 'model:deleted', 'model:closed', 'redirect:issue'])
  const showFolderSelectDialog = ref(false)
  const deleteModelDialog = ref(false)
  const exportModelDialog = ref(false)
  const showControlDialog = ref<boolean>(false)
  const selectedControlId = ref<string | null>(null)
  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })
  const showContentSelectDialog = ref(false)
  const newName = ref(model.value?.name || '')
  const newDescription = ref(model.value?.description || '')
  const controls = ref<Control[]>([])
  const modelName = ref<string>('')

  // Model names are rendered in fixed-width furniture — the 220px browser tiles
  // and the canvas overlay beside the toggle stack — so an unbounded name
  // degrades layout rather than merely reading long. Enforced in the UI only for
  // now; the platform accepts longer, and names predating this cap (or written
  // through any non-UI path) still render, which is why the canvas title
  // truncates on top of this rather than trusting it.
  const MODEL_NAME_MAX_LENGTH = 80

  // Model-level compliance drivers (e.g. PCI-DSS, SOC2). Free-text [String!] on the
  // platform; seeded on load and round-tripped on save. The other four scope fields
  // (depth, modelingIntent, exclusions, trustAssumptions) are not edited here but must
  // be preserved — DtModel.updateModel uses REPLACE semantics on the whole scope, so
  // buildScope() carries them through unchanged (see saveModel).
  const complianceDrivers = ref<string[]>([])
  const complianceDriverItems = RECOMMENDED_COMPLIANCE_DRIVERS.map(d => d.driver)
  const complianceTierLabel: Record<number, string> = {
    1: 'Full enrichment',
    2: 'Data classification',
    3: 'Declared only',
  }
  const complianceDriverSubtitle: Record<string, string> = Object.fromEntries(
    RECOMMENDED_COMPLIANCE_DRIVERS.map(d => [d.driver, complianceTierLabel[d.tier]])
  )

  // Preserve the four non-edited scope fields and override compliance drivers. The
  // transform boundary lives in dt-core; localScopeToPlatform (inside updateModel) drops
  // empties, so an all-empty scope becomes undefined (no wipe) and a cleared list clears.
  const buildScope = (): ModelScopeLocal => ({
    ...(platformScopeToLocal(model.value ?? {}) ?? {}),
    compliance_drivers: complianceDrivers.value,
  })

  const showIssueDialog = ref(false)
  const issueClass = ref<Class | null>(null)

  const headers = [
    { title: 'Name', key: 'name' },
    { title: 'Description', key: 'description' },
    { title: 'Classes', key: 'controlClasses' },
    { title: '', key: 'actions' },
  ]
  const itemsPerPage = [
    { value: 5, title: '5' },
    { value: 10, title: '10' },
    { value: 25, title: '25' },
    { value: 50, title: '50' },
    { value: -1, title: '$vuetify.dataFooter.itemsPerPageAll' },
  ]

  const selectedControlIds = ref<string[]>([])

  const addControl = () => {
    showContentSelectDialog.value = true
  }

  // WHAT THIS DIALOG LOADED. A save sends the difference against this, never the whole of it: everything
  // here is a snapshot taken when the dialog opened, and asserting it back would revert whatever anybody
  // else changed in the meantime. It is re-pinned from the server's answer after each successful save,
  // so a second save is a difference against what is stored rather than against what was first seen.
  const seed = ref({
    name: '',
    description: '',
    complianceDrivers: [] as string[],
    controls: [] as string[],
  })

  /** Order carries no meaning in either list — a control selection and a driver list are both sets. */
  const sameMembers = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000')

  const changedFields = () => ({
    ...(newName.value !== seed.value.name && { name: newName.value }),
    ...(newDescription.value !== seed.value.description && { description: newDescription.value }),
    ...(!sameMembers(complianceDrivers.value, seed.value.complianceDrivers) && { scope: buildScope() }),
    ...(!sameMembers(selectedControlIds.value, seed.value.controls) && {
      controls: selectedControlIds.value,
      // The control write is a delta against what was there before this edit, so one person attaching a
      // control no longer detaches one somebody else attached since this dialog opened.
      baselineControls: seed.value.controls,
    }),
  })

  const pinSeed = (saved: Model) => {
    // Merge rather than replace: the update response does not carry every field the dialog reads.
    model.value = { ...(model.value ?? {}), ...saved } as Model
    const previous = seed.value
    const answer = {
      name: saved.name ?? '',
      description: saved.description ?? '',
      complianceDrivers: saved.complianceDrivers ?? [],
      controls: saved.controls?.map(control => control.id || '') ?? [],
    }

    // THE FORM MOVES WITH THE SEED. Re-pinning the seed alone leaves a field the user never touched
    // holding this dialog's load-time copy while the seed holds the server's — so the next save reads
    // an untouched field as an edit and asserts the stale value, reverting whoever wrote it. For the
    // control list it is worse than a revert: the baseline moves forward while the list does not, so
    // the delta becomes an explicit disconnect of the control somebody else just attached.
    //
    // A field the user IS editing keeps their edit. The two cases are indistinguishable from here —
    // an edit made before this save and one made while it was in flight look the same — and losing
    // typing is the worse of the two errors. The cost is that a value the platform normalises is not
    // shown back until the dialog is reopened.
    if (newName.value === previous.name) newName.value = answer.name
    if (newDescription.value === previous.description) newDescription.value = answer.description
    if (sameMembers(complianceDrivers.value, previous.complianceDrivers)) {
      complianceDrivers.value = [...answer.complianceDrivers]
    }
    if (sameMembers(selectedControlIds.value, previous.controls)) {
      selectedControlIds.value = [...answer.controls]
      // The rows, not just the ids — the Controls tab renders these objects.
      controls.value = saved.controls ?? []
    }

    seed.value = answer
  }

  /**
   * Write what the user actually changed, and nothing else.
   *
   * `modules` is deliberately absent from every payload this dialog can build: nothing in it can change
   * a model's modules, so sending them could only ever overwrite somebody else's assignment with a
   * load-time copy. The same was true of the folder until a move began naming it explicitly.
   */
  // ONE WRITE AT A TIME. Two saves from this dialog do not serialise and do not join: the mutex and
  // the deduplication key both fold the serialised variables in, and a move carries a folder the other
  // save does not — so they run concurrently, each builds its delta against a seed neither has
  // re-pinned yet, and each emits the same control `connect`. A connect compiles to a bare
  // relationship create, so the second one leaves a parallel SUPPORTS edge that nothing surfaces
  // (the reads collapse it with DISTINCT) and no later save heals.
  //
  // The template disable is the fix; this refusal is the backstop for `moveToFolder`, which is driven
  // by another dialog's event rather than by a button this one can grey out.
  const saving = ref(false)

  const save = async (extra: Record<string, unknown> = {}): Promise<boolean> => {
    if (saving.value) return false
    const edit = { ...changedFields(), ...extra }
    // Nothing to write. Reporting success is not a shortcut — it is what happened.
    if (Object.keys(edit).length === 0) return true
    saving.value = true
    try {
      const saved = await modelsStore.updateModel({ id: model.value?.id || '', ...edit })
      if (saved) pinSeed(saved)
      return Boolean(saved)
    } finally {
      saving.value = false
    }
  }

  const saveModel = async (): Promise<boolean> => {
    const ret = await save()
    if (ret) {
      controls.value = controls.value.filter(control => selectedControlIds.value.includes(control.id || ''))
      modelName.value = newName.value
    }
    return ret
  }

  // A move carries the folder AND any edit still pending on the form, because that is what pressing
  // Move used to persist and losing a half-typed name to it would be a new defect, not a fix. With a
  // clean form it is one relationship operation and nothing else.
  const moveToFolder = async (folderId: string) => {
    try {
      emits('model:moved', (await save({ folderId })) ? folderId : null)
    } catch {
      emits('model:moved', null)
    }
  }

  onMounted(() => {
    modelsStore.getModel({ modelId: modelId.value }).then(modelData => {
      model.value = modelData
      modelName.value = model.value?.name || ''
      newName.value = model.value?.name || ''
      newDescription.value = model.value?.description || ''
      selectedControlIds.value = model.value?.controls?.map(control => control.id || '') || []
      controls.value = model.value?.controls || []
      complianceDrivers.value = model.value?.complianceDrivers ?? []
      seed.value = {
        name: newName.value,
        description: newDescription.value,
        complianceDrivers: [...complianceDrivers.value],
        controls: [...selectedControlIds.value],
      }
    })
  })

  const onSubmit = async () => {
    const success = await saveModel()
    if (success) {
      emits('model:saved', true, undefined)
    } else {
      console.log('modelsStore.error', modelsStore.error)
      emits('model:saved', false, modelsStore.error)
    }
  }

  const onDeleteModel = () => {
    modelsStore.deleteModel({ modelId: modelId.value }).then(ret => {
      if (ret) {
        emits('model:deleted', true)
      } else {
        emits('model:deleted', false)
      }
    })
    deleteModelDialog.value = false
  }

  const exportModel = async () => {
    const success = await saveModel()
    if (success) {
      exportModelDialog.value = true
    }
  }

  const openModel = async (id: string) => {
    const success = await saveModel()
    if (success) {
      router.push({ path: '/dataflow', query: { id } })
    }
  }

  const onSelectControl = (selectedModels: Model[], selectedControls: Control[]) => {
    const newControls = selectedControls.filter(control => !controls.value.some(c => c.id === control.id))
    controls.value = [...controls.value, ...newControls]
    selectedControlIds.value = controls.value.map(control => control.id || '')
    saveModel().then(success => {
      emits('model:saved', success)
    })
  }

  const onAddIssue = (data: {issueClass: Class, id: string, name: string, description: string}) => {
    issueClass.value = data.issueClass
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
      name: data.name || '',
      description: data.description || '',
      elementIds: [data.id || ''],
      returnTo,
    })
    emits('redirect:issue')
  }

  watch(
    () => props.show,
    newVal => {
      showModelDialog.value = newVal
    }
  )
</script>

<template>
  <!-- eslint-disable vue/no-lone-template -->
  <!-- eslint-disable vue/attribute-hyphenation -->
  <v-dialog
    v-model="showModelDialog"
    attach="body"
    class="pa-0 ma-0"
    max-width="75vw"
    @click:outside="emits('model:closed')"
    @keydown.esc="emits('model:closed')"
  >
    <v-card
      class="pa-0 ma-0 rounded-lg"
    >
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon color="tertiary" size="small">mdi-vector-polyline</v-icon>
            <span class="ml-2 text-body-1">Model: {{ modelName }}</span>
          </div>
          <v-btn
            color="foreground"
            icon="mdi-close"
            size="medium"
            variant="text"
            @click="emits('model:closed')"
          />
        </v-sheet>
      </v-card-title>
      <v-card-text>
        <v-form @submit.prevent="onSubmit">
          <v-card class="model-card elevation-8 mb-4 border-thin rounded-lg">
            <v-container class="w-100">
              <!-- Tabs -->
              <v-row>
                <v-tabs v-model="tab" color="primary">
                  <v-tab prepend-icon="mdi-cog-outline" value="general">General</v-tab>
                  <v-tab prepend-icon="mdi-shield-sword-outline" value="controls">Controls</v-tab>
                </v-tabs>
              </v-row>

              <!-- Tab Contents -->
              <v-row>
                <v-tabs-window v-model="tab" class="model-tab w-100">
                  <!-- General Tab -->
                  <v-tabs-window-item value="general">
                    <v-container>
                      <v-row>
                        <v-col cols="12">
                          <v-text-field
                            v-model="newName"
                            counter
                            label="Name"
                            :maxlength="MODEL_NAME_MAX_LENGTH"
                          />
                        </v-col>
                      </v-row>
                      <v-row>
                        <v-col cols="12">
                          <v-textarea v-model="newDescription" label="Description" rows="6" />
                        </v-col>
                      </v-row>
                      <v-row>
                        <v-col cols="12">
                          <v-combobox
                            v-model="complianceDrivers"
                            chips
                            closable-chips
                            hint="Pick a recommended framework or type your own (e.g. PCI-DSS, SOC2)"
                            :items="complianceDriverItems"
                            label="Compliance drivers"
                            multiple
                          >
                            <template #chip="{ props: chipProps }">
                              <v-chip v-bind="chipProps" size="small" />
                            </template>
                            <template #item="{ props: itemProps, item }">
                              <v-list-item v-bind="itemProps" :subtitle="complianceDriverSubtitle[item.title]" />
                            </template>
                          </v-combobox>
                        </v-col>
                      </v-row>
                    </v-container>
                  </v-tabs-window-item>

                  <!-- Controls Tab -->
                  <v-tabs-window-item class="pt-1" value="controls">
                    <v-data-table
                      v-model="selectedControlIds"
                      :headers="headers"
                      item-key="id"
                      :items="controls"
                      items-per-page="5"
                      :items-per-page-options="itemsPerPage"
                      show-select
                    >
                      <!-- Search Bar -->
                      <template #top>
                        <div class="d-flex justify-end mb-6">
                          <v-btn
                            class="mx-3 my-0"
                            color="secondary"
                            icon="mdi-shield-plus-outline"
                            size="x-large"
                            variant="outlined"
                            @click="addControl"
                          />
                        </div>
                      </template>

                      <!-- Classes Column with Chips -->
                      <template #item.controlClasses="{ item }">
                        <div>
                          <v-chip
                            v-for="cls in item.controlClasses || []"
                            :key="cls.id"
                            class="ma-1"
                            small
                          >
                            {{ cls.name }}
                          </v-chip>
                        </div>
                      </template>
                      <template #item.actions="{ item }">
                        <v-btn
                          class="ma-1"
                          color="primary"
                          icon="mdi-pencil"
                          variant="plain"
                          @click="selectedControlId = item.id || null; showControlDialog = true"
                        />
                      </template>
                    </v-data-table>
                  </v-tabs-window-item>
                </v-tabs-window>
              </v-row>
            </v-container>
            <v-card-actions class="ma-0 pa-0 d-flex flex-row justify-space-between">
              <div class="d-flex flex-row align-center justify-space-between">
                <v-card class="ma-0 pa-0 elevation-0 border-e-thin">
                  <v-card-title class="d-flex flex-row align-center justify-center">
                    <span class="ml-2 text-body-1">Add Issue</span>
                  </v-card-title>
                  <v-card-text class="d-flex flex-row align-center justify-center">
                    <IssueSelector
                      :id="modelId || ''"
                      :name="modelName || ''"
                      :description="newDescription || ''"
                      size="x-large"
                      variant="outlined"
                      @copy:issue="onCopyToIssue"
                      @add:issue="onAddIssue"
                    />
                  </v-card-text>
                </v-card>
                <v-card class="ma-0 pa-0 elevation-0 border-e-thin">
                  <v-card-title>
                    <span class="ml-2 text-body-1" />
                  </v-card-title>
                  <v-card-text>
                    <!-- Every control that can start a write is disabled while one is in flight. Two
                         overlapping saves from this dialog neither serialise nor join, and each would
                         emit the same control connect — leaving a parallel edge nothing surfaces. -->
                    <v-btn
                      class="ma-3"
                      color="success"
                      :disabled="saving"
                      icon="mdi-content-save-outline"
                      :loading="saving"
                      size="x-large"
                      type="submit"
                      variant="outlined"
                    />
                    <template v-if="showFileActions">
                      <v-btn
                        class="ma-3"
                        color="secondary"
                        :disabled="saving"
                        icon="mdi-download-outline"
                        size="x-large"
                        variant="outlined"
                        @click="exportModel()"
                      />
                      <v-btn
                        class="ma-3"
                        color="secondary"
                        :disabled="saving"
                        icon="mdi-file-move-outline"
                        size="x-large"
                        variant="outlined"
                        @click="showFolderSelectDialog = true"
                      />
                      <v-btn
                        class="ma-3"
                        color="error"
                        :disabled="saving"
                        icon="mdi-trash-can-outline"
                        size="x-large"
                        variant="outlined"
                        @click="deleteModelDialog = true"
                      />
                    </template>
                  </v-card-text>
                </v-card>
              </div>
              <v-card class="ma-0 pa-0 elevation-0">
                <v-card-title>
                  <span class="ml-2 text-body-1" />
                </v-card-title>
                <v-card-text>
                  <v-btn
                    v-if="showFileActions"
                    class="ma-3"
                    color="secondary"
                    :disabled="saving"
                    icon="mdi-vector-polyline-edit"
                    size="x-large"
                    variant="outlined"
                    @click="modelId && openModel(modelId)"
                  />
                </v-card-text>
              </v-card>
            </v-card-actions>
          </v-card>
        </v-form>

        <ConfirmDeleteModelDialog
          v-if="deleteModelDialog"
          :model-name="model?.name || ''"
          :show="deleteModelDialog"
          @delete:canceled="deleteModelDialog = false"
          @delete:confirmed="onDeleteModel"
        />

        <ExportModelDialog
          v-if="exportModelDialog"
          :modelId="modelId || ''"
          :show="exportModelDialog"
          @update:show="exportModelDialog = false"
        />

        <template>
          <FolderSelectDialog
            v-if="showFolderSelectDialog"
            :show="showFolderSelectDialog"
            @close="showFolderSelectDialog = false"
            @move="moveToFolder"
          />
        </template>

        <ControlDialog
          v-if="showControlDialog && selectedControlId !== null"
          :id="selectedControlId ?? ''"
          :show="showControlDialog && selectedControlId !== null"
          :show-file-actions="false"
          @control:closed="showControlDialog = false; selectedControlId = null"
        />

        <ContentSelectDialog
          v-if="showContentSelectDialog"
          content-type="Control"
          enable-create
          select-type="multiple"
          :show="showContentSelectDialog"
          @close="showContentSelectDialog = false"
          @select="onSelectControl"
        />
        <IssueDialog
          v-if="showIssueDialog"
          :element-ids="[modelId || '']"
          :issue-class="issueClass || undefined"
          :show="showIssueDialog"
          @cancel:issue="showIssueDialog = false"
          @issue:added="onAddIssue"
        />

        <v-snackbar v-model="snackBar.show" :color="snackBar.color" timeout="5000" top>
          {{ snackBar.message }}
        </v-snackbar>
      </v-card-text>
    </v-card>
  </v-dialog>

</template>

<style scoped>
.model-tab {
  height: 400px;
  overflow-y: auto;
}

.issue-class-btn {
  border-width: 1px;
  border-style: solid;
  border-color: rgba(var(--v-theme-secondary), 1);
  background-color: rgba(var(--v-theme-primary), 1);
  .text-color {
    color: rgba(var(--v-theme-tertiary), 1);
  }
}
</style>
