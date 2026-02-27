<script setup lang="ts">
  import { ref, markRaw } from 'vue'
  import { JsonForms } from '@jsonforms/vue'
  import { extendedVuetifyRenderers } from '@jsonforms/vue-vuetify'
  import type { UISchemaElement } from '@jsonforms/core'
  import { Module } from '@dethernety/dt-core'

  interface Props {
    module: Module
  }

  const props = defineProps<Props>()
  const emits = defineEmits(['save:module', 'reset:module'])

  const schema = ref<object | null>(null)
  const uischema = ref<UISchemaElement | null>(null)
  const renderers = markRaw([
    ...extendedVuetifyRenderers,
  ])
  const attributesData = ref({})
  const attributesDataString = ref<string>('')

  const parsedTemplate = async () => {
    try {
      if (props.module.template) {
        const parsedTemplate = await JSON.parse(props.module.template) as {
          schema: object
          uischema: UISchemaElement
        }
        schema.value = parsedTemplate.schema
        uischema.value = parsedTemplate.uischema
      }
    } catch (error) {
      console.error('Error parsing template', error)
    }
    return null
  }

  watch(
    () => props.module.template,
    () => { parsedTemplate() }
  )

  watch(
    () => props.module.attributes,
    () => {
      attributesData.value = JSON.parse(props.module.attributes || '{}')
    }
  )

  onMounted(() => {
    parsedTemplate().then(() => {
      attributesData.value = JSON.parse(props.module.attributes || '{}')
    })
  })

  const onSave = () => {
    if (attributesDataString.value === '') {
      return
    }
    emits('save:module', props.module.id, attributesDataString.value)
  }

  const onReset = () => {
    emits('reset:module', props.module.id)
  }

  const updateAttributesData = (data: { data: object, errors: object[] }) => {
    if (data.errors.length > 0) {
      attributesDataString.value = ''
      return
    }
    attributesDataString.value= JSON.stringify(data.data)
  }

</script>

<template>
  <v-card class="elevation-0" >
    <v-card-title class="pa-0">
      <v-sheet
        class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between"
        color="primary"
        density="compact"
        variant="plain"
      >
        <div>
          <v-icon color="tertiary" size="small">mdi-toy-brick-outline</v-icon>
          <span class="ml-2 text-body-1">Module: {{ module.name }}</span>
        </div>
      </v-sheet>

    </v-card-title>
    <v-card-text>
      <json-forms
        v-if="schema && uischema"
        :data="attributesData"
        :renderers="renderers"
        :schema="schema"
        :uischema="uischema"
        @change="updateAttributesData"
      />
    </v-card-text>
    <v-card-actions>
      <v-spacer />
      <v-btn
        class="mr-1 mb-5"
        color="quinary"
        icon="mdi-refresh"
        size="x-large"
        variant="outlined"
        @click="onReset"
      />
      <v-btn
        class="mr-5 mb-5"
        color="secondary"
        icon="mdi-content-save-outline"
        size="x-large"
        variant="outlined"
        @click="onSave"
      />
    </v-card-actions>
  </v-card>
</template>