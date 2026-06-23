<script setup lang="ts">
  import { onMounted, ref, watch } from 'vue'
  import { Class, Issue } from '@dethernety/dt-core'
  import { useIssueStore } from '@/stores/issueStore'
  import ConfirmDeleteDialog from '@/components/Dialogs/General/ConfirmDeleteDialog.vue'
  import { onBeforeRouteLeave, useRouter } from 'vue-router'
  import IssueCard from '@/components/Dialogs/Issues/IssueCard.vue'

  interface Props {
    show: boolean
    issueClass?: Class
    issue?: Issue
    elementIds?: string[]
    issueName?: string
    issueDescription?: string
  }

  const issueStore = useIssueStore()
  const router = useRouter()
  const props = defineProps<Props>()
  const showDialog = ref(props.show)
  const issueClass = ref<Class | null>(props.issueClass ?? null)
  const issue = ref<Issue | null>(props.issue ?? null)
  const showConfirmDeleteDialog = ref(false)
  const emits = defineEmits(['cancel:issue', 'issue:added'])

  watch(() => props.show, newVal => {
    showDialog.value = newVal
  })

  watch(() => props.issueClass, newVal => {
    issueClass.value = newVal ?? null
  })

  watch(() => props.issue, newVal => {
    issue.value = newVal ?? null
  })

  const onCancel = () => {
    emits('cancel:issue')
  }

  const updateIssue = async (issueId: string) => {
    issueStore.fetchIssues({ issueId }).then(() => {
      issue.value = issueStore.getIssueById(issueId)
    })
  }

  const createIssue = async () => {
    if (!issueClass.value) {
      return
    }
    const newIssue: Issue = {
      name: props.issueName || `New ${issueClass.value?.name} Issue`,
      issueClass: issueClass.value,
      id: '',
      description: props.issueDescription || '',
      type: issueClass.value?.type || '',
      category: issueClass.value?.category || '',
      createdAt: '',
      updatedAt: '',
      attributes: '',
      elements: [],
    }
    issueStore.createIssue(newIssue).then(async result => {
      if (result) {
        // The issue exists now; show it regardless of the element-link outcome.
        issue.value = result
        // Signal a real creation so callers can distinguish created-then-closed from
        // cancelled (the dialog stays open afterwards for editing; consumers that
        // don't care simply ignore this event).
        emits('issue:added', result)
        if (props.elementIds) {
          // Linking elements is best-effort: a failure here (e.g. a slow/erroring
          // attach mutation) must not leave the created issue without a card or
          // raise an unhandled rejection — surface the issue and warn instead.
          issueStore.addElementsToIssue({ issueId: result.id, elementIds: props.elementIds })
            .then(() => updateIssue(result.id))
            .catch(err => console.warn('Issue created, but linking its elements failed:', err))
        }
      }
    }).catch(err => console.error('Error creating issue:', err))
  }

  const deleteIssue = async () => {
    issueStore.deleteIssue(issue.value?.id ?? '').then(() => {
      onCancel()
    })
  }

  const navigateToElement = (elementType: string, elementId: string) => {
    if (elementType === 'Model') {
      router.push({ path: '/dataflow', query: { id: elementId } })
    } else if (elementType === 'Analysis') {
      router.push({ path: '/analysisresults', query: { id: elementId } })
    }
  }

  onBeforeRouteLeave(() => {
    issueStore.resetIssue()
  })

  onMounted(() => {
    if (!issue.value && issueClass.value) {
      createIssue()
    } else {
      onCancel()
    }
  })
</script>

<template>
  <v-dialog
    v-model="showDialog"
    max-width="1500px"
    @click:outside="onCancel"
    @keydown.esc="onCancel"
  >
    <IssueCard
      v-if="showDialog && issue"
      :issue="issue"
      :show-close="true"
      @cancel:issue="onCancel"
      @delete:issue="showConfirmDeleteDialog = true"
      @navigate:element="navigateToElement"
      @update:issue="updateIssue(issue?.id)"
    />
  </v-dialog>
  <ConfirmDeleteDialog
    :message="`Are you sure you want to delete this issue?`"
    :show="showConfirmDeleteDialog"
    @delete:canceled="showConfirmDeleteDialog = false"
    @delete:confirmed="deleteIssue"
  />
</template>
