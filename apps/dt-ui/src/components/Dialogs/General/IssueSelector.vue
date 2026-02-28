<script setup lang="ts">
  import { Class } from '@dethernety/dt-core'
  import { useIssueStore } from '@/stores/issueStore'

  interface Props {
    id: string
    name: string
    description: string
    size?: string
    variant?: 'flat' | 'text' | 'elevated' | 'tonal' | 'outlined' | 'plain'
  }

  const props = defineProps<Props>()

  const issueStore = useIssueStore()
  const emits = defineEmits(['add:issue', 'copy:issue'])

  const onAddIssue = (cls: Class) => {
    const data: {issueClass: Class, id: string, name: string, description: string} = {
      issueClass: cls,
      id: props.id,
      name: props.name.charAt(0).toUpperCase() + props.name.replaceAll('_', ' ').slice(1),
      description:  props.description
    }
    emits('add:issue', data)
  }

  const onCopyToIssue = () => {
    const data: {id: string, name: string, description: string} = {
      id: props.id,
      name: props.name.charAt(0).toUpperCase() + props.name.replaceAll('_', ' ').slice(1),
      description: props.description
    }
    emits('copy:issue', data)
  }

</script>

<template>
  <v-speed-dial
    id="add-issue"
    key="add-issue"
    location="bottom end"
    transition="scroll-y-reverse-transition"
  >
    <template #activator="{ props: activatorProps }">
      <v-fab
        v-bind="activatorProps"
        class="ma-0 pa-0"
        color="quaternary"
        elevation="12"
        icon="mdi-alert-plus-outline"
        :variant="variant ?? 'plain'"
        :size="size"
      />
    </template>
    <v-sheet
      key="add-to-issue-sheet"
      class="d-flex flex-column align-center justify-center pa-2 elevation-12"
      color="foreground"
    >
      <v-btn
        key="add-to-issue"
        class="issue-class-btn w-100"
        color="secondary"
        elevation="12"
        size="large"
        variant="plain"
        @click="onCopyToIssue()"
      >
        <span class="text-color">
          Add to Issue
        </span>
      </v-btn>
      <v-divider class="my-3" />
      <v-btn
        v-for="cls in issueStore.issueClasses"
        :key="cls.id"
        class="issue-class-btn mb-1 w-100"
        color="secondary"
        elevation="12"
        size="large"
        variant="plain"
        @click="onAddIssue(cls)"
      >
        <span class="text-color">
          {{ cls.name }}
        </span>
      </v-btn>
    </v-sheet>
  </v-speed-dial>
</template>