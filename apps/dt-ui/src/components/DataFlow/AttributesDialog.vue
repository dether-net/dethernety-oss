<script setup lang="ts">
  import { ref, watch } from 'vue'
  import { Class } from '@dethernety/dt-core'
  import { useRouter } from 'vue-router'
  import { useIssueStore } from '@/stores/issueStore'
  import { getPageDisplayName } from '@/utils/dataFlowUtils'
  import { useFlowStore } from '@/stores/flowStore'
  import type { UISchemaElement } from '@jsonforms/core'

  interface Props {
    itemId: string | null;
    itemName: string | null;
    itemClass: Class | null;
    show: boolean;
    attributesData?: object;
    attributesSchema?: object | null;
    attributesUiSchema?: UISchemaElement | null;
    attributesLoading?: boolean;
    attributesTemplateWarning?: boolean;
  }

  interface Guide {
    option_name: string
    option_description: string
    how_to_obtain: {
      type: string
      instruction: string
      command: string
      file_path: string
      navigation: string
      expected_output: string
    }[]
    value_type: string
    typical_values: string[]
    security_impact: string
  }

  const props = withDefaults(defineProps<Props>(), {
    attributesData: () => ({}),
    attributesSchema: null,
    attributesUiSchema: null,
    attributesLoading: false,
    attributesTemplateWarning: false,
    itemId: null,
    itemName: null,
    itemClass: null,
  })

  const emit = defineEmits(['close', 'redirect:issue', 'attributes:changed'])
  const showAttributesDialog = ref(props.show)
  const guide = ref<Guide[] | null>(props.itemClass?.guide as Guide[] | null)
  const issueClass = ref<Class | null>(null)
  const showIssueDialog = ref(false)
  const router = useRouter()
  const issueStore = useIssueStore()
  const flowStore = useFlowStore()
  const issueName = ref<string>('')
  const issueDescription = ref<string>('')
  const filteredGuide = ref<Guide[] | null>(null)

  const filteredGuideInfo = (eventData: any) => {
    const keyWords = eventData.variableKeys
    // Filter the guide only if it is not null or undefined
    if (guide.value) {
      filteredGuide.value = guide.value.filter((item: Guide) => keyWords.includes(item.option_name))
    } else {
      filteredGuide.value = null
    }
  }

  // Panel opened handler

  const handlePanelClosed = (eventData: any) => {
    filteredGuide.value = null
  }

  const onAttributesChanged = (data: object) => {
    // Simply emit the change to parent - no local processing
    emit('attributes:changed', data)
  }

  const closeDialog = () => {
    showAttributesDialog.value = false
    emit('close')
  }

  const onAddIssue = (data:{issueClass: Class, id: string, name: string, description: string}) => {
    issueClass.value = data.issueClass
    issueName.value = data.name + ' Issue on ' + (props.itemName as string)
    issueDescription.value = data.description
    showIssueDialog.value = true
  }

  const onCopyToIssue = (data:{id: string, name: string, description: string}) => {
    // Get current route information dynamically
    const currentRoute = router.currentRoute.value
    const returnTo = {
      name: getPageDisplayName(currentRoute.path),
      path: currentRoute.path,
      query: { ...currentRoute.query },
    }

    issueStore.setIssueDataClipboard(
      {
        name: data.name + ' Issue on ' + (props.itemName as string),
        description: data.description,
        elementIds: [props.itemId || '', flowStore.selectedItem?.id || '', flowStore.modelId || ''],
        returnTo,
      }
    )
    emit('redirect:issue')
  }

  const onIssueDialogClosed = () => {
    showIssueDialog.value = false
    issueClass.value = null
  }

  const onIssueAdded = () => {
    showIssueDialog.value = false
    issueClass.value = null
  }

  watch(() => props.show, newVal => {
    showAttributesDialog.value = newVal
  })

  watch(() => props.itemClass, newVal => {
    if (newVal) {
      guide.value = newVal.guide as Guide[]
    } else {
      guide.value = null
    }
  })
</script>

<template>
  <v-dialog
    v-model="showAttributesDialog"
    class="rounded-lg"
    height="85vh"
    width="90vw"
    @click:outside="closeDialog"
    @keydown.esc="closeDialog"
    @update:model-value="closeDialog"
  >
    <v-card class="overflow-hidden pa-0 ma-0 rounded-lg opacity-90">
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon
              class="mr-2"
              color="tertiary"
              icon="mdi-tune-vertical"
              size="small"
            />
            <span class="ml-2 text-body-1">Attributes of {{ props.itemName }}</span>
          </div>
          <v-btn
            color="foreground"
            icon="mdi-close"
            size="medium"
            variant="text"
            @click="closeDialog"
          />
        </v-sheet>
      </v-card-title>
      <v-card-text>
        <v-container class="mt-2 mb-5 px-5 rounded-lg elevation-0 border-thin border-opacity-100 border-primary" height="100%" fluid>
          <v-row>
            <v-col cols="8">
              <v-card class="elevation-0 d-flex flex-column">
                <v-card-title class="d-flex justify-space-between flex-shrink-0">
                  <div>
                    <v-icon
                      class="mr-2"
                      color="tertiary"
                      icon="mdi-tune-vertical"
                      size="x-large"
                    />
                    <span class="text-h6">Attributes</span>
                  </div>
                </v-card-title>
                <v-card-text class="flex-grow-1 d-flex flex-column pa-0">
                  <v-row class="ma-0 flex-grow-1">
                    <v-col cols="12" class="pa-0 d-flex flex-column">
                      <v-sheet class="overflow-y-auto flex-grow-1 pa-4" style="max-height: calc(85vh - 200px);">
                        <AttributesForm
                          v-if="props.itemId && props.itemClass && !props.attributesLoading"
                          class="json-forms"
                          :item-id="props.itemId"
                          :item-class="props.itemClass"
                          :attributes-data="props.attributesData"
                          :schema="props.attributesSchema"
                          :uischema="props.attributesUiSchema"
                          :is-loading="props.attributesLoading"
                          :template-warning="props.attributesTemplateWarning"
                          @attributes:changed="onAttributesChanged"
                          @form:panel-opened="filteredGuideInfo"
                          @form:info-clicked="filteredGuideInfo"
                          @form:panel-closed="handlePanelClosed"
                        />
                        <v-progress-circular
                          v-else-if="props.attributesLoading"
                          class="ma-4"
                          color="primary"
                          indeterminate
                        />
                        <v-alert v-else-if="!props.itemId" type="info">
                          No item selected.
                        </v-alert>
                        <v-alert v-else-if="!props.itemClass" type="info">
                          No class information available for this item.
                        </v-alert>
                        <v-alert v-else-if="props.attributesTemplateWarning" type="warning">
                          Form could not be rendered due to missing or invalid schema.
                        </v-alert>
                      </v-sheet>
                    </v-col>
                  </v-row>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="4">
              <v-card class="elevation-0">
                <v-card-title class="d-flex justify-space-between">
                  <div>
                    <v-icon
                      class="mr-2"
                      color="tertiary"
                      icon="mdi-book-open-variant-outline"
                      size="x-large"
                    />
                    <span class="text-h6">Guide</span>
                  </div>
                </v-card-title>
                <v-card-text class="flex-grow-1 d-flex flex-column pa-0">
                  <v-sheet class="overflow-y-auto flex-grow-1 pa-1" style="max-height: calc(85vh - 200px);">
                    <v-card
                      class="elevation-0"
                      v-for="item in filteredGuide"
                      :key="item.option_name"
                    >
                      <v-card-title>
                        <v-sheet class="elevation-0 w-100 pa-1 rounded-md d-flex flex-row justify-start align-center" color="primary">
                          <div>
                            <IssueSelector
                              :id="item.option_name || ''"
                              :name="item.option_name || ''"
                              :description="item.option_description || ''"
                              @add:issue="onAddIssue"
                              @copy:issue="onCopyToIssue"
                            />
                            <span class="ml-2 text-body-1 text-capitalize text-wrap">{{ item.option_name.replaceAll('_', ' ') }}</span>
                          </div>
                        </v-sheet>
                      </v-card-title>
                      <v-card-text>
                        <span class="text-caption">{{ item.option_description }}</span><br>
                        <span class="text-caption"><strong>Value Type:</strong> {{ item.value_type }}</span><br>
                        <span class="text-caption"><strong>Security Impact:</strong> {{ item.security_impact }}</span>
                        <v-divider class="my-2" />
                        <v-expansion-panels class="elevation-0">
                          <v-expansion-panel v-for="howToObtain in item.how_to_obtain" :key="howToObtain.type" class="elevation-0">
                            <v-expansion-panel-title
                              class="text-caption text-capitalize border-thin border-secondary rounded-lg elevation-2 my-1"
                              height="20px"
                              static
                            >
                              <span class="text-caption text-capitalize">{{ howToObtain.type.replaceAll('_', ' ') }}</span>
                            </v-expansion-panel-title>
                            <v-expansion-panel-text class="elevation-0">
                              <v-sheet class="text-caption elevation-0">
                                <div v-if="howToObtain.instruction">
                                  <span class="text-caption"><strong>Instruction:</strong></span><br>
                                  <span class="text-caption">{{ howToObtain.instruction }}</span><br><br>
                                </div>
                                <div v-if="howToObtain.command">
                                  <span class="text-caption"><strong>Command:</strong></span><br>
                                  <span class="text-caption text-code">{{ howToObtain.command }}</span><br><br>
                                </div>
                                <div v-if="howToObtain.file_path">
                                  <span class="text-caption"><strong>File Path:</strong></span><br>
                                  <span class="text-caption">{{ howToObtain.file_path }}</span><br><br>
                                </div>
                                <div v-if="howToObtain.navigation">
                                  <span class="text-caption"><strong>Navigation:</strong></span><br>
                                  <span class="text-caption">{{ howToObtain.navigation }}</span><br><br>
                                </div>
                                <div v-if="howToObtain.expected_output">
                                  <span class="text-caption"><strong>Expected Output:</strong></span><br>
                                  <span class="text-caption">{{ howToObtain.expected_output }}</span><br>
                                </div>
                              </v-sheet>
                            </v-expansion-panel-text>
                          </v-expansion-panel>
                        </v-expansion-panels>
                      </v-card-text>
                    </v-card>
                  </v-sheet>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </v-container>
      </v-card-text>
    </v-card>
  </v-dialog>
  <IssueDialog
    v-if="showIssueDialog"
    :element-ids="[ props.itemId || '', flowStore.selectedItem?.id || '', flowStore.modelId || '']"
    :issue-class="issueClass || undefined"
    :issue-name="issueName || undefined"
    :issue-description="issueDescription || undefined"
    :show="showIssueDialog"
    @cancel:issue="onIssueDialogClosed"
    @issue:added="onIssueAdded"
  />
</template>

<style scoped>
  .content-window {
    border-color: rgba(var(--v-theme-quinary), 1);
  }
  .text-code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.875rem;
    color: rgba(var(--v-theme-quinary), 1);
  }
</style>