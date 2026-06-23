<script setup lang="ts">
  import { computed, markRaw, nextTick, onBeforeUnmount, ref, watch } from 'vue'
  import { Class, Issue, IssueElement, Model } from '@dethernety/dt-core'
  import { useIssueStore } from '@/stores/issueStore'
  import { JsonForms } from '@jsonforms/vue'
  import { extendedVuetifyRenderers } from '@jsonforms/vue-vuetify'
  import type { UISchemaElement } from '@jsonforms/core'
  import ContentSelectDialog from '@/components/Dialogs/Browser/ContentSelectDialog.vue'
  import { LocationQueryRaw } from 'vue-router'

  interface Props {
    issue: Issue | null
    showClose: boolean
  }

  const emits = defineEmits(['cancel:issue', 'delete:issue', 'navigate:element', 'update:issue'])
  const props = defineProps<Props>()
  const tab = ref('general')
  const issue = ref<Issue>(props.issue || { id: '', name: '', description: '', type: '', category: '', attributes: '', elements: [] })
  const issueStore = useIssueStore()
  const showContentSelectDialog = ref(false)
  const returnTo = ref<{ name: string, path: string, query: LocationQueryRaw } | null>(null)

  const issueData = ref<{
    name: string
    description: string | undefined
    issueClass: Class | undefined
    type: string | undefined
    category: string | undefined
    attributes: string | undefined
    elements: IssueElement[] | undefined
    createdAt: string | undefined
    updatedAt: string | undefined
    lastSyncAt: string | undefined
    issueStatus: string
    comments: string[]
  }>({
    name: issue.value.name,
    description: issue.value.description || '',
    issueClass: issue.value.issueClass,
    type: issue.value.type || '',
    category: issue.value.category || '',
    attributes: issue.value.attributes || '',
    elements: issue.value.elementsWithExtendedInfo || undefined,
    createdAt: issue.value.createdAt || '',
    updatedAt: issue.value.updatedAt || '',
    lastSyncAt: issue.value.lastSyncAt || '',
    issueStatus: issue.value.issueStatus || 'open',
    comments: issue.value.comments || [],
  })

  const headers = [
    { title: 'Model', key: 'model_name' },
    { title: 'Element Name', key: 'name' },
    { title: 'Element Type', key: 'type' },
    { title: '', key: 'actions', sortable: false },
  ]

  const renderers = markRaw([
    ...extendedVuetifyRenderers,
  ])
  const uischema = ref<UISchemaElement | null>(null)
  const schema = ref<object | null>(null)
  const attributesData = ref<object | null>(null)
  const templateWarning = ref(false)
  const isSaving = ref(false)
  const saveError = ref(false)
  const justSaved = ref(false)
  // Plain (non-reactive) coalescing slot: a save requested while another is in
  // flight is snapshotted here at trigger time (before any server echo can reset
  // issueData) and drained by the active save loop. Never silently dropped.
  let pendingPayload: Issue | null = null
  let justSavedTimer: ReturnType<typeof setTimeout> | null = null
  const isInitializingForm = ref(false)
  const newComment = ref('')
  const initializeFormStructure = async () => {
    schema.value = null
    uischema.value = null
    templateWarning.value = false

    try {
      if (
        issue.value.issueClass &&
        typeof issue.value.issueClass.template === 'string'
      ) {
        const parsedTemplate = JSON.parse(issue.value.issueClass.template)
        uischema.value = parsedTemplate.uischema as UISchemaElement
        schema.value = parsedTemplate.schema as object
        if (!uischema.value || !schema.value) {
          throw new Error('Invalid or missing schema/uischema in the class')
        }
      } else {
        throw new Error('Invalid or missing schema/uischema in the class')
      }
    } catch (error) {
      console.error('Error initializing form structure', error)
      templateWarning.value = true
    }
  }

  const updateFormData = async () => {
    issueData.value = {
      name: issue.value.name,
      description: issue.value.description || '',
      issueClass: issue.value.issueClass,
      type: issue.value.type || '',
      category: issue.value.category || '',
      attributes: JSON.stringify(issue.value.syncedAttributes?.attributes) || '',
      elements: issue.value.elementsWithExtendedInfo || undefined,
      createdAt: issue.value.createdAt || '',
      updatedAt: issue.value.updatedAt || '',
      lastSyncAt: issue.value.lastSyncAt || '',
      issueStatus: issue.value.issueStatus || 'open',
      comments: issue.value.comments || [],
    }

    // Only update form data if form structure exists
    if (schema.value && uischema.value) {
      // Set initialization flag to prevent change event from triggering save
      isInitializingForm.value = true
      attributesData.value = issue.value.syncedAttributes?.attributes || {}
      // Use nextTick to ensure the form has processed the data change
      await nextTick()
      // Add a small delay to ensure JSON Forms has completely processed the change
      setTimeout(() => {
        isInitializingForm.value = false
      }, 100)
    }
  }

  const initializeAttributes = async () => {
    await initializeFormStructure()
    await updateFormData()
  }

  watch(
    () => props.issue,
    async (newIssue, oldIssue) => {
      const oldIssueClassId = oldIssue?.issueClass?.id
      const newIssueClassId = newIssue?.issueClass?.id

      if (newIssue) {
        issue.value = newIssue as Issue

        // Only reinitialize form structure if issue class changed
        if (oldIssueClassId !== newIssueClassId) {
          await initializeAttributes() // Full initialization
        } else {
          await updateFormData() // Just update data, preserve form state
        }
      } else {
        issue.value = { id: '', name: '', description: '', type: '', category: '', attributes: '', elements: [] }
        await initializeAttributes() // Full initialization for new/empty issue
      }
    },
    { immediate: true }
  )

  const onCancel = () => {
    if (props.showClose) {
      emits('cancel:issue')
    }
  }

  const updateAttributesData = (data: { data: object, errors: object[] }) => {
    // Capture the edit even if a save is in flight (onSave coalesces it). Still
    // guard the phantom @change JSON Forms emits while we (re)initialize the form
    // — that one must not be persisted. (JSON Forms only renders once schema/
    // uischema exist, so there's no @change during loading.)
    //
    // Known limitation (intentionally not "fixed"): isInitializingForm is cleared
    // by the ~100ms timer in updateFormData, so an attribute @change landing in
    // that window right after a post-save echo is dropped (low frequency — the
    // next change re-fires with the cumulative value). A value-dedupe rewrite
    // would remove the window but risk an equivalent write on every card open, so
    // we keep the simpler guard.
    if (isInitializingForm.value) {
      return
    }
    issueData.value.attributes = JSON.stringify(data.data)
    onSave()
  }

  const buildPayload = (): Issue => ({
    ...issue.value,
    name: issueData.value.name,
    description: issueData.value.description,
    type: issueData.value.type,
    category: issueData.value.category,
    issueClass: issueData.value.issueClass,
    elements: issueData.value.elements,
    attributes: issueData.value.attributes,
    issueStatus: issueData.value.issueStatus,
    comments: issueData.value.comments,
  })

  const armJustSavedDecay = () => {
    if (justSavedTimer) clearTimeout(justSavedTimer)
    justSavedTimer = setTimeout(() => {
      justSaved.value = false
    }, 1500)
  }

  const onSave = async () => {
    if (!issueData.value) {
      return
    }
    // A save is already running: snapshot the latest edit NOW (synchronously, before
    // the in-flight save's server echo can reset issueData) and let the active loop
    // drain it as a trailing write. This is what stops a mid-flight edit being dropped.
    if (isSaving.value) {
      pendingPayload = buildPayload()
      return
    }

    isSaving.value = true
    saveError.value = false
    justSaved.value = false
    let payload: Issue | null = buildPayload()
    try {
      while (payload) {
        pendingPayload = null
        await issueStore.updateIssue(payload)
        payload = pendingPayload // a trigger that fired mid-save left a fresh snapshot
      }
      justSaved.value = true
      armJustSavedDecay()
    } catch (error) {
      // Surface the failure instead of swallowing it. The edits remain live in the
      // form (issueData is cumulative), so the next edit or Enter retries the full
      // current state — we don't strand a stale partial snapshot or auto-hammer.
      console.error('Error saving issue', error)
      saveError.value = true
      pendingPayload = null
    } finally {
      isSaving.value = false
    }
  }

  // Drives the passive save-status indicator in the card header. Auto-save is the
  // only save model here; the indicator reports its state honestly rather than
  // asserting a permanent "Saved".
  const saveStatus = computed(() => {
    if (isSaving.value) {
      return { icon: '', color: 'foreground', text: 'Saving…', loading: true }
    }
    if (saveError.value) {
      return { icon: 'mdi-cloud-alert-outline', color: 'error', text: 'Couldn\'t save your last change — edit again to retry', loading: false }
    }
    if (justSaved.value) {
      return { icon: 'mdi-cloud-check-outline', color: 'foreground', text: 'Changes saved', loading: false }
    }
    return { icon: 'mdi-cloud-outline', color: 'foreground', text: 'Changes are saved automatically', loading: false }
  })
  // Idle announces nothing (empty) so a screen reader isn't told "saved automatically"
  // on a loop; saving/saved/failed are real state transitions worth announcing.
  const saveStatusText = computed(() =>
    (isSaving.value || saveError.value || justSaved.value) ? saveStatus.value.text : ''
  )

  onBeforeUnmount(() => {
    if (justSavedTimer) clearTimeout(justSavedTimer)
  })

  const addComment = () => {
    issueData.value.comments = [new Date().toLocaleString() + ': ' + newComment.value, ...issueData.value.comments]
    newComment.value = ''
    onSave()
  }

  const removeComment = (index: number) => {
    issueData.value.comments = issueData.value.comments.filter((_, i) => i !== index)
    onSave()
  }

  const navigateToElement = (path: string, query: LocationQueryRaw) => {
    emits('navigate:element', path, query)
  }

  const addModelToIssue = (models: Model[]) => {
    issueStore.addElementsToIssue({ issueId: issue.value.id, elementIds: models.map(model => model.id) }).then((result: number) => {
      if (result > 0) {
        emits('update:issue')
      }
    })
  }

  const removeElementFromIssue = (elementId: string) => {
    issueStore.removeElementFromIssue({ issueId: issue.value.id, elementId }).then((result: boolean) => {
      if (result) {
        emits('update:issue')
      }
    })
  }

  const onAddFromClipboard = () => {
    const clipboardData = issueStore.getIssueDataClipboard()
    if (!clipboardData) {
      return
    }
    issueData.value.comments = [new Date().toLocaleString() + ': ' + clipboardData.name + ' - ' + clipboardData.description, ...issueData.value.comments]
    onSave()
    issueStore.addElementsToIssue({ issueId: issue.value.id, elementIds: clipboardData?.elementIds || [] }).then((result: number) => {
      if (result > 0) {
        emits('update:issue')
      }
    })
    issueStore.clearIssueDataClipboard()
    returnTo.value = clipboardData.returnTo
  }
</script>

<template>
  <v-form @submit.prevent="onSave">
    <v-card class="elevation-0" height="450px">
      <v-card-title class="pa-0">
        <v-sheet
          class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between"
          color="primary"
          density="compact"
          variant="plain"
        >
          <div>
            <v-icon color="tertiary" size="small">mdi-alert-outline</v-icon>
            <span class="ml-2 text-body-1">Issue</span>
          </div>
          <div class="d-flex flex-row align-center">
            <!-- Passive auto-save status; never a call-to-action. Kept as type="submit"
                 so Enter-to-save still flows through the form, but tab-skipped and
                 ripple-less so it reads as a status glyph, not a button. -->
            <span class="sr-only" role="status" :aria-live="saveError ? 'assertive' : 'polite'">{{ saveStatusText }}</span>
            <v-btn
              :color="saveStatus.color"
              :loading="saveStatus.loading"
              :ripple="false"
              size="small"
              style="cursor: default"
              tabindex="-1"
              type="submit"
              variant="plain"
            >
              <v-icon v-if="saveStatus.icon" aria-hidden="true">{{ saveStatus.icon }}</v-icon>
              <v-tooltip activator="parent" location="bottom">{{ saveStatus.text }}</v-tooltip>
            </v-btn>
            <v-btn
              v-if="props.showClose"
              color="foreground"
              icon="mdi-close"
              size="medium"
              variant="text"
              @click="onCancel()"
            />
          </div>
        </v-sheet>
      </v-card-title>
      <v-card-text>
        <v-sheet class="pa-1 ma-0 text-body-1 d-flex flex-row justify-space-between" color="transparent" density="compact" variant="plain">
          <v-container fluid>
            <v-row>
              <v-col cols="3">
                <v-tabs
                  v-model="tab"
                  direction="vertical"
                >
                  <v-tab prepend-icon="mdi-cog-outline" text="General" value="general" />
                  <v-tab prepend-icon="mdi-tune-vertical" text="Attributes" value="attributes" />
                  <v-tab prepend-icon="mdi-record-circle-outline" text="Associated Elements" value="associatedElements" />
                  <v-tab prepend-icon="mdi-comment-text-outline" text="Comments" value="comments" />
                </v-tabs>
                <v-divider class="my-2" color="tertiary" />
                <v-sheet class="pa-2 ma-2 w-100 d-flex flex-column justify-start align-center" fluid>
                  <v-chip
                    class="mb-5"
                    color="tertiary"
                    size="large"
                    variant="tonal"
                  > {{ issueData.issueClass?.name }}</v-chip>
                  <div class="mr-2 px-3 d-flex flex-row justify-start align-center">
                    <div class="border-e-thin mr-2">
                      <v-btn
                        class="mr-2 rounded-lg"
                        :color="issueData.issueStatus === 'open' ? 'success' : 'error'"
                        :prepend-icon="issueData.issueStatus === 'open' ? 'mdi-checkbox-marked-circle-outline' : 'mdi-radiobox-blank'"
                        size="x-large"
                        variant="tonal"
                        @click="issueData.issueStatus = issueData.issueStatus === 'open' ? 'closed' : 'open'; onSave()"
                      >
                        <span v-if="issueData.issueStatus === 'open'" class="text-body-1">Close Issue</span>
                        <span v-else class="text-body-1">Open Issue</span>
                      </v-btn>
                    </div>
                    <v-btn
                      class="mr-2"
                      color="error"
                      icon="mdi-trash-can-outline"
                      size="x-large"
                      variant="outlined"
                      @click="emits('delete:issue')"
                    />
                  </div>
                  <v-divider class="my-2" color="tertiary" />
                  <v-btn
                    v-if="issueStore.getIssueDataClipboard()"
                    class="mt-1"
                    color="secondary"
                    prepend-icon="mdi-content-paste"
                    size="large"
                    variant="outlined"
                    @click="onAddFromClipboard"
                  >
                    <span class="text-body-1">Add from clipboard</span>
                  </v-btn>
                  <v-btn
                    v-if="returnTo"
                    class="mt-1"
                    color="secondary"
                    prepend-icon="mdi-arrow-left-circle-outline"
                    size="large"
                    variant="text"
                    @click="navigateToElement(returnTo.path, returnTo.query)"
                  >
                    <span class="text-body-1">Return to {{ returnTo.name }}</span>
                  </v-btn>
                </v-sheet>
              </v-col>
              <v-col cols="9">
                <v-tabs-window v-model="tab" class="data-window elevation-8 pa-0">
                  <v-tabs-window-item value="general">
                    <v-container class="pa-2 ma-2 w-100" fluid height="354px">
                      <v-row>
                        <v-col cols="4">
                          <v-text-field v-model="issueData.name" label="Name" required @blur="onSave" />
                          <v-text-field v-model="issueData.category" label="Category" @blur="onSave" />
                          <v-text-field v-model="issueData.type" label="Type" @blur="onSave" />
                        </v-col>
                        <v-col cols="7">
                          <div class="d-flex flex-column justify-space-between h-100">
                            <v-textarea v-model="issueData.description" class="h-100 w-100 pa-0 ma-0" label="Description" @blur="onSave" />
                          </div>
                        </v-col>
                      </v-row>
                      <v-row>
                        <v-col class="d-flex flex-row flex-wrap align-center px-10" cols="12">
                          <v-text-field v-model="issueData.createdAt" class="mx-2" disabled label="Created At" />
                          <v-text-field v-model="issueData.updatedAt" class="mx-2" disabled label="Updated At" />
                          <v-text-field v-model="issueData.lastSyncAt" class="mx-2" disabled label="Last Synced" />
                        </v-col>
                      </v-row>
                    </v-container>
                  </v-tabs-window-item>
                  <v-tabs-window-item value="attributes">
                    <json-forms
                      v-if="schema && uischema"
                      class="h-100 json-forms"
                      :data="attributesData"
                      :renderers="renderers"
                      :schema="schema"
                      :uischema="uischema"
                      @change="updateAttributesData"
                    />
                  </v-tabs-window-item>
                  <v-tabs-window-item value="associatedElements">
                    <v-container class="pa-2 ma-2 overflow-y-auto" fluid height="354px">
                      <v-row>
                        <v-col cols="12">
                          <v-data-table
                            v-model="issueData.elements"
                            :headers="headers"
                            height="238x"
                            :items="issueData.elements"
                          >
                            <template #top>
                              <div class="d-flex justify-end mt-1 mr-5">
                                <v-btn
                                  class="mx-2 my-0"
                                  color="secondary"
                                  icon="mdi-plus"
                                  variant="outlined"
                                  @click="showContentSelectDialog = true"
                                />
                              </div>
                            </template>
                            <template #item.name="{ item }">
                              <span class="text-capitalize">{{ item.name?.replaceAll('_', ' ') }}</span>
                            </template>
                            <template #item.type="{ item }">
                              <span class="text-capitalize">
                                {{ item.type?.replaceAll('_', ' ').toLowerCase() }}
                                <span v-if="item.exposed_component_name">
                                  <v-chip
                                    class="ml-0"
                                    color="quinary"
                                    size="small"
                                  >
                                    <v-icon class="mr-1" size="small">mdi-arrow-right-bold-circle-outline</v-icon>
                                    {{ item.exposed_component_name }}
                                  </v-chip>
                                </span>
                              </span>
                            </template>
                            <template #item.actions="{ item }">
                              <div class="d-flex flex-row justify-end align-center">
                                <v-btn
                                  v-if="item.element_type === 'Analysis'"
                                  class="mr-2"
                                  color="tertiary"
                                  icon="mdi-chart-box-outline"
                                  variant="text"
                                  @click="item.id && navigateToElement('/analysisresults', { id: item.id })"
                                />
                                <v-btn
                                  v-if="item.element_type"
                                  class="mr-2"
                                  color="secondary"
                                  icon="mdi-vector-polyline"
                                  variant="text"
                                  @click="item.model_id && navigateToElement('/dataflow', { id: item.model_id })"
                                />
                                <v-btn
                                  class="mr-2"
                                  color="quinary"
                                  icon="mdi-link-variant-off"
                                  variant="text"
                                  @click="removeElementFromIssue(item.id)"
                                />
                              </div>
                            </template>
                          </v-data-table>
                        </v-col>
                      </v-row>
                    </v-container>
                  </v-tabs-window-item>
                  <v-tabs-window-item value="comments">
                    <v-container class="pa-2 ma-2 overflow-y-auto" fluid height="354px">
                      <v-row>
                        <v-col cols="12">
                          <div class="d-flex flex-row justify-end align-center">
                            <v-textarea
                              v-model="newComment"
                              class="mr-1 mb-0"
                              label="Comments"
                              rows="2"
                            />
                            <v-btn
                              class="ml-3 mr-3 mt-0"
                              color="secondary"
                              icon="mdi-send-outline"
                              size="large"
                              variant="outlined"
                              @click="addComment"
                            />
                          </div>
                          <v-list class="mt-2">
                            <v-list-item v-for="(comment, index) in issueData.comments" :key="comment">
                              <v-list-item-title class="text-body-1 border-b-thin pb-1">
                                <div class="d-flex flex-row justify-space-between align-center">
                                  <span class="text-body-1 text-wrap">{{ comment }}</span>
                                  <v-btn
                                    class="mt-1 ml-1"
                                    color="error"
                                    icon="mdi-trash-can-outline"
                                    size="small"
                                    variant="text"
                                    @click="removeComment(index)"
                                  />
                                </div>
                              </v-list-item-title>
                            </v-list-item>
                          </v-list>
                        </v-col>
                      </v-row>
                    </v-container>
                  </v-tabs-window-item>
                </v-tabs-window>
              </v-col>
            </v-row>
          </v-container>
        </v-sheet>
      </v-card-text>
    </v-card>
    <ContentSelectDialog
      v-if="showContentSelectDialog"
      content-type="Model"
      select-type="multiple"
      :show="showContentSelectDialog"
      @close="showContentSelectDialog = false"
      @select="addModelToIssue"
    />
  </v-form>
</template>

<style scoped>
  .json-forms :deep(.v-col) {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }

  .json-forms :deep(.v-window) {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
    width: 100% !important;
  }

  .json-forms :deep(.v-col) {
    max-height: 200px;
    overflow-y: auto;
  }

  .json-forms {
    height: 370px !important;
    overflow-y: auto;
  }

  .json-forms :deep(.v-toolbar__content) {
    height: 55px !important;
  }

  /* Visually-hidden live region for screen-reader save-status announcements. */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
