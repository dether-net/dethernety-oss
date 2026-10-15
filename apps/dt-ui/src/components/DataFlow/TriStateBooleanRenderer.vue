<!--
  TriStateBooleanRenderer.vue — a boolean attribute as three choices: Yes, No and Not answered. The stock checkbox
  shows an unanswered value but cannot return to it, so one stray click turned "unknown" into "no". Choosing Not
  answered removes the value (choosing the selected answer again changes nothing); the attribute save then sends it
  as null, which clears it on the server. Registered above the stock checkbox and toggle renderers for every boolean control.
-->
<template>
  <control-wrapper
    v-bind="controlWrapper"
    :applied-options="appliedOptions"
    :is-focused="isFocused"
    :styles="styles"
  >
    <div :aria-labelledby="labelId" class="tri-state-boolean" role="group">
      <div :id="labelId" class="tri-state-boolean__label text-body-2">{{ computedLabel }}</div>
      <v-btn-toggle
        class="tri-state-boolean__choices"
        density="compact"
        divided
        mandatory
        :disabled="!control.enabled"
        :model-value="state"
        variant="outlined"
        @update:model-value="onSelect"
      >
        <v-btn
          v-for="choice in CHOICES"
          :key="choice.value"
          :aria-pressed="state === choice.value ? 'true' : 'false'"
          :value="choice.value"
          @blur="handleBlur"
          @focus="handleFocus"
        >{{ choice.label }}</v-btn>
      </v-btn-toggle>
      <div v-if="control.description && (isFocused || persistentHint())" class="tri-state-boolean__hint text-caption">{{ control.description }}</div>
      <div v-for="(message, i) in errorMessages" :key="i" class="tri-state-boolean__error text-caption text-error">{{ message }}</div>
    </div>
  </control-wrapper>
</template>

<script lang="ts">
import { computed, defineComponent } from 'vue'
import { rendererProps, useJsonFormsControl } from '@jsonforms/vue'
import { ControlWrapper, useVuetifyControl } from '@jsonforms/vue-vuetify'
import { type TriState, triStateOf, valueOfTriState } from '@/utils/triStateBoolean'

export { triStateBooleanTester } from '@/utils/triStateBoolean'

const CHOICES: { value: TriState, label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unanswered', label: 'Not answered' },
]

export default defineComponent({
  name: 'TriStateBooleanRenderer',
  components: { ControlWrapper },
  props: {
    ...rendererProps(),
  },
  setup (props) {
    const input = useVuetifyControl(useJsonFormsControl(props as any))
    const state = computed(() => triStateOf(input.control.value.data))
    const labelId = computed(() => `${input.control.value.id}-label`)
    const errorMessages = computed(() => (input.control.value.errors ? String(input.control.value.errors).split('\n').filter(Boolean) : []))
    const onSelect = (choice: unknown) => input.handleChange(input.control.value.path, valueOfTriState(choice))
    return { ...input, CHOICES, state, labelId, errorMessages, onSelect }
  },
})
</script>

<style scoped>
.tri-state-boolean {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}
.tri-state-boolean__hint {
  opacity: 0.75;
}
</style>
