<script setup lang="ts">
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { useRouter } from 'vue-router'
  import { useAnalysisStore } from '@/stores/analysisStore'
  import { Analysis } from '@dethernety/dt-core'
  import UserQuestionDialog from '@/components/Dialogs/Analysis/UserQuestionDialog.vue'

  interface Props {
    analysisId: string | undefined
    show: boolean
  }

  const props = defineProps<Props>()
  const emit = defineEmits(['close'])

  const router = useRouter()
  const analysisStore = useAnalysisStore()
  const analysisId = ref(props.analysisId)
  const dialog = ref(props.show)
  const analysis = ref<Analysis | null>(null)
  const fetchAnalysisFetchTimer = ref(null)
  const interrupts = ref<any[]>([])
  const providedAnswers = ref<string[]>([])
  const observable = ref<any>(null)
  const subscription = ref<any>(null)
  const analysisMessages = ref<string[]>([])
  const showUserQuestionDialog = ref<boolean>(false)
  const showUserQuestionDialogEnabled = ref<boolean>(true)

  watch(() => props.show, newVal => {
    dialog.value = newVal
  })

  watch(() => props.analysisId, newVal => {
    analysisId.value = newVal
    startFetchAnalysisFetchTimer()
  })

  onMounted(() => {
    startFetchAnalysisFetchTimer()
  })

  interface SnackBar {
    show: boolean
    message: string
    color: string
  }

  const snackBar = ref<SnackBar>({ show: false, message: '', color: '' })

  const fetchAnalysis = async (id: string | undefined) => {
    if (!id) return
    analysisStore.findAnalysis({ analysisId: id })
      .then((a: Analysis | null) => {
        if (!a) return
        analysis.value = a
        if (analysis.value) {
          if (analysisMessages.value.length === 0) {
            analysisStore.getAnalysisValues({ analysisId: id, valueKey: 'messages' })
              .then((messages: any) => {
                if (messages && messages.length > 0) {
                  analysisMessages.value = messages?.map((message: any) => message.content) || []
                }
              })
          }
          if (analysis.value.status?.status === 'idle') {
            // Graph run completed — navigate to results page
            closeDialog()
            router.push({ path: '/analysisresults', query: { id } })
            return
          }
          if (analysis.value.status?.status === 'interrupted') {
            // Populate interrupts BEFORE showing dialog to avoid accessing undefined
            if (analysis.value.status?.interrupts && typeof analysis.value.status.interrupts === 'object') {
              const keys = Object.keys(analysis.value.status.interrupts)
              if (keys.length > 0) {
                const key = keys[0]
                const arrayValue = (analysis.value.status.interrupts as Record<string, any[]>)[key]
                interrupts.value = Array.isArray(arrayValue) ? arrayValue : []
              } else {
                interrupts.value = []
              }
            }
            // Structured interrupts (e.g. scope_review) are handled by the
            // module's workspace on the results page — navigate there instead
            // of showing the generic UserQuestionDialog.
            const firstValue = interrupts.value[0]?.value
            if (firstValue && typeof firstValue === 'object' && firstValue.type) {
              closeDialog()
              router.push({ path: '/analysisresults', query: { id } })
              return
            }
            // Only show dialog if we have interrupts with valid data
            if (showUserQuestionDialogEnabled.value && interrupts.value.length > 0 && interrupts.value[0]?.value) {
              showUserQuestionDialog.value = true
            }
          }
        }
      })
  }

  const startFetchAnalysisFetchTimer = () => {
    setTimeout(() => {
      fetchAnalysis(analysisId.value).then(() => {
        subscribeAnalysisResponse(analysisId.value)
      })
    }, 1000)
    if (fetchAnalysisFetchTimer.value) {
      clearInterval(fetchAnalysisFetchTimer.value)
    }
    fetchAnalysisFetchTimer.value = setInterval(() => fetchAnalysis(analysisId.value), 5000) as unknown as null
  }

  const subscribeAnalysisResponse = (sessionId: string | undefined) => {
    if (!sessionId) return
    if (subscription.value) {
      subscription.value.unsubscribe()
    }
    observable.value = analysisStore.subscribeToStream({ sessionId })
    subscription.value = observable.value.subscribe({
      next: (data: any) => {
        if (data?.data?.streamResponse?.content) {
          const newMessage = data.data.streamResponse.content
          if (!analysisMessages.value.includes(newMessage)) {
            analysisMessages.value.push(newMessage)
          }
        }
      },
      error: (error: any) => {
        snackBar.value = {
          show: true,
          message: 'Failed to subscribe to analysis response',
          color: 'error',
        }
        console.error('error in subscribeAnalysisResponse', error)
      }
    })
  }

  onBeforeUnmount(() => {
    if (fetchAnalysisFetchTimer.value) {
      clearInterval(fetchAnalysisFetchTimer.value)
    }
    // Properly cleanup subscription to prevent memory leaks
    if (subscription.value) {
      subscription.value.unsubscribe()
    }
    showUserQuestionDialogEnabled.value = true
    showUserQuestionDialog.value = false
  })

  const closeDialog = () => {
    if (fetchAnalysisFetchTimer.value) {
      clearInterval(fetchAnalysisFetchTimer.value)
    }
    if (subscription.value) {
      subscription.value.unsubscribe()
    }
    analysisMessages.value = []
    providedAnswers.value = []
    analysis.value = null
    analysisId.value = undefined
    showUserQuestionDialog.value = false
    showUserQuestionDialogEnabled.value = true
    emit('close')
  }

  const resumeAnalysis = (answer: string) => {
    if (fetchAnalysisFetchTimer.value) {
      clearInterval(fetchAnalysisFetchTimer.value)
    }
    showUserQuestionDialogEnabled.value = true
    showUserQuestionDialog.value = false
    if (!answer) return
    analysisStore.resumeAnalysis({
      analysisId: analysisId.value as string,
      userInput: answer,
    }).then(() => {
      startFetchAnalysisFetchTimer()
    })
  }

  const onUserQuestionDialogClose = () => {
    showUserQuestionDialog.value = false
    showUserQuestionDialogEnabled.value = false
  }

</script>

<template>
  <!-- eslint-disable vue/v-on-event-hyphenation -->
  <v-dialog
    v-model="dialog"
    class="rounded-lg"
    height="85vh"
    width="90vw"
    @click:outside="closeDialog"
    @keydown.esc="closeDialog"
    @update:model-value="closeDialog"
  >
    <v-card class="pa-0 ma-0 rounded-lg">
      <v-card-title class="pa-0">
        <v-sheet class="pa-2 ma-0 text-body-1 d-flex flex-row justify-space-between" color="primary" density="compact" variant="plain">
          <div>
            <v-icon
              class="mr-2"
              color="tertiary"
              icon="mdi-forum-outline"
              size="small"
            />
            <span class="ml-2 text-body-1">Analysis Flow</span>
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
      <v-card-text class="overflow-y-auto">
        <v-container class="mt-5 pa-5 rounded-lg elevation-11 border-thin">
          <v-row>
            <v-col cols="12">
              <v-card>
                <v-card-title class="d-flex justify-space-between">
                  <div>
                    <v-icon
                      class="mr-2"
                      color="primary"
                      icon="mdi-message-text-outline"
                      size="x-large"
                    />
                    <span class="text-h6">Analysis Responses</span>
                  </div>
                  <div class="d-flex justify-end pa-0 ma-0">
                    <v-icon
                      v-if="analysis?.status?.status === 'interrupted'"
                      class="mr-2"
                      color="amber"
                      icon="mdi-forum-outline"
                      @click="showUserQuestionDialog = true; showUserQuestionDialogEnabled = true"
                    />
                    <v-icon
                      v-else-if="['idle'].includes(analysis?.status?.status || '')"
                      class="mr-2"
                      color="primary"
                      icon="mdi-clock-outline"
                    />
                    <v-progress-circular
                      v-else-if="['busy', 'running'].includes(analysis?.status?.status || '')"
                      class="ma-1 mt-2 run-analysis-button-progress"
                      color="amber"
                      indeterminate
                      :size="30"
                    />
                    <v-icon
                      v-else-if="analysis?.status?.status"
                      class="mr-2"
                      color="error"
                      icon="mdi-alert-circle-outline"
                    />
                  </div>
                </v-card-title>
                <v-card-text v-if="analysisMessages.length > 0">
                  <div v-for="(message, index) in [...analysisMessages].reverse()" :key="index" class="my-3">
                    <v-sheet class="d-flex align-center pa-3">
                      <v-icon
                        v-if="index === 0"
                        class="mr-2"
                        color="red"
                        icon="mdi-play"
                        size="x-small"
                      />
                      <p :class="index === 0 ? 'text-white' : 'text-grey'">{{ message }}</p>
                    </v-sheet>
                  </div>
                </v-card-text>
                <v-card-text v-else>
                  <p class="text-center">Waiting for analysis responses...</p>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </v-container>
      </v-card-text>
    </v-card>
  </v-dialog>
  <v-snackbar v-model="snackBar.show" :color="snackBar.color" timeout="5000" top>
    {{ snackBar.message }}
  </v-snackbar>
  <UserQuestionDialog
    v-if="showUserQuestionDialog && interrupts.length > 0 && interrupts[0]?.value"
    :interrupts="interrupts"
    :question="interrupts[0].value"
    :show="showUserQuestionDialog"
    @close="onUserQuestionDialogClose"
    @resumeAnalysis="resumeAnalysis"
  />
</template>

<style scoped>
.text-white {
  color: white;
}

.text-grey {
  color: grey;
}
</style>
