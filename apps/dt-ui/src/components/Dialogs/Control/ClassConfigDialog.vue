<script setup lang="ts">
  import { ref } from 'vue'
  import { useControlsStore } from '@/stores/controlsStore'
  import { JsonForms } from '@jsonforms/vue'
  import type { UISchemaElement } from '@jsonforms/core'
  import { extendedVuetifyRenderers } from '@jsonforms/vue-vuetify'
  import { flattenProperties, unflattenProperties } from '@/utils/dataFlowUtils'

  interface Props {
    show: boolean
    classid: string
    id: string
  }

  const props = defineProps<Props>()
  const emits = defineEmits(['cancel', 'submit'])
  const showDialog = ref(props.show)
  const attributesData = ref({})
  const name = ref('')
  const schema = ref<object | null>(null)
  const uischema = ref<UISchemaElement | null>(null)
  const controlsStore = useControlsStore()
  const renderers = markRaw([
    ...extendedVuetifyRenderers,
  ])

  watch(
    () => props.show,
    newVal => {
      showDialog.value = newVal
    }
  )

  controlsStore.getClass({ classId: props.classid }).then(cls => {
    console.log(props.classid)
    console.log(cls)
    if (cls) {
      if (cls.name) {
        name.value = cls.name
      }
      if (
        cls.template &&
        typeof cls.template.schema === 'object' &&
        typeof cls.template.uischema === 'object'
      ) {
        schema.value = cls.template.schema
        uischema.value = cls.template.uischema as UISchemaElement
        controlsStore.getAttributesFromClassRelationship({
          classId: props.classid,
          componentId: props.id,
        }).then(attributes => {
          if (attributes) {
            attributesData.value = unflattenProperties(attributes)
          }
        })
      }
    }
  })

  const onSubmit = () => {
    const flattenedAttributes = flattenProperties(attributesData.value)
    emits('submit', flattenedAttributes)
  }

  const onCancel = () => {
    emits('cancel')
  }

</script>

<template>
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <v-dialog
    v-model="showDialog"
    max-width="1100px"
    @afterLeave="onCancel"
    @keydown.esc="onCancel"
  >
    <v-form @submit.prevent="onSubmit">
      <v-card>
        <v-card-title class="pa-0">
          <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
            <div>
              <v-icon color="tertiary" size="small">mdi-cog-outline</v-icon>
              <span class="ml-2 text-body-1">{{ name }} Configuration</span>
            </div>
            <v-btn
              color="foreground"
              icon="mdi-close"
              size="medium"
              variant="text"
              @click="onCancel"
            />
          </v-sheet>
        </v-card-title>
        <v-card-text class="pa-0 ma-3 rounded-lg elevation-11 border-thin">
          <v-container class="data-window">
            <v-row class="h-100" no-gutters>
              <v-col class="pa-0" cols="12">
                <v-window>
                  <json-forms
                    v-if="schema && uischema"
                    class="h-100 json-forms"
                    :data="attributesData"
                    :renderers="renderers"
                    :schema="schema"
                    :uischema="uischema"
                    @change="($event: any) => (attributesData = $event.data)"
                  />
                </v-window>
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>
        <v-card-actions class="pr-6 py-3 pb-5 ma-0">
          <v-btn
            class="my-0 pa-0"
            color="secondary"
            icon="mdi-content-save-all-outline"
            size="x-large"
            type="submit"
            variant="outlined"
          />

        </v-card-actions>
      </v-card>
    </v-form>
  </v-dialog>
</template>

<style scoped>
  .data-window {
    height: 300pt;
    overflow-y: auto;
  }

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
    max-height: 170px;
    overflow-y: auto;
  }

  .json-forms {
    max-height: 340px;
    overflow-y: auto;
  }

  .controls-table {
    max-height: 300px;
    overflow-y: auto;
  }

  .json-forms :deep(.v-toolbar__content) {
    height: 55px !important;
  }

  .json-forms :deep(.v-field__input) {
    width: 700px;
  }
  .json-forms :deep(.v-row) {
    width: 900px !important;
  }

</style>
