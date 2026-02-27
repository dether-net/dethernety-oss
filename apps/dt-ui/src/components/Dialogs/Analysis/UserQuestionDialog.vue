<script setup lang="ts">

  interface Props {
    show: boolean;
    question: string;
    interrupts: any[];
  }

  interface Question {
    question: string
    options?: string[]
    answer_type: string
  }

  const props = defineProps<Props>()
  const showDialog = ref(props.show)
  const providedAnswers = ref<string[]>([])
  const interrupts = ref(props.interrupts)
  const selectedOptions = ref<string[][]>([])

  const emit = defineEmits(['resumeAnalysis', 'close'])

  watch(() => props.show, newVal => {
    showDialog.value = newVal
  })

  const closeDialog = () => {
    showDialog.value = false
    selectedOptions.value = []
    providedAnswers.value = []
    emit('close')
  }

  const parseQuestion = (value: string): Question | undefined => {
    try {
      return JSON.parse(value)
    } catch (error) {
      console.error(error)
    }
  }

  const selectAllOptions = (index: number) => {
    selectedOptions.value[index] = parseQuestion(interrupts.value[index].value)?.options || []
  }

  const selectNoneOptions = (index: number) => {
    selectedOptions.value[index] = []
  }

  const resumeAnalysis = (answerType: string | undefined, index: number) => {
    if (!answerType) return
    if (answerType === 'multiple') {
      providedAnswers.value[index] = selectedOptions.value[index].join(', ')
    }
    emit('resumeAnalysis', providedAnswers.value[index])
  }

</script>

<template>
  <v-dialog
    v-model="showDialog"
    class="rounded-lg"
    height="50vh"
    width="50vw"
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
            <span class="ml-2 text-body-1">Question</span>
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
        <v-container
          class="mt-5 pa-5 rounded-lg elevation-11 border-thin"
        >
          <v-row>
            <v-col cols="12">
              <v-card
                v-for="(interrupt, index) in interrupts"
                :key="interrupt.id"
              >
                <v-card-title>
                  <v-icon
                    class="mr-2"
                    color="primary"
                    icon="mdi-forum-outline"
                    size="x-large"
                  />
                  <div class="question-container">
                    <span class="text-h6 text-wrap">
                      {{ parseQuestion(interrupt.value)?.question }}
                    </span>
                  </div>
                </v-card-title>
                <v-card-text>
                  <div
                    v-if="parseQuestion(interrupt.value)?.answer_type === 'single'"
                  >
                    <v-radio-group
                      v-model="providedAnswers[index]"
                    >
                      <v-radio
                        v-for="option in parseQuestion(interrupt.value)?.options"
                        :key="option"
                        :label="option"
                        :value="option"
                      />
                    </v-radio-group>
                  </div>
                  <div
                    v-if="parseQuestion(interrupt.value)?.answer_type === 'multiple'"
                  >
                    <v-select
                      v-model="selectedOptions[index]"
                      chips
                      :items="parseQuestion(interrupt.value)?.options"
                      label="Select"
                      multiple
                    />
                  </div>
                  <div
                    v-if="parseQuestion(interrupt.value)?.answer_type === 'text'"
                  >
                    <v-textarea
                      v-model="providedAnswers[index]"
                      label="Answer"
                      rows="3"
                    />
                  </div>
                </v-card-text>
                <v-card-actions class="pa-5 opacity-90">
                  <v-btn
                    v-if="parseQuestion(interrupt.value)?.answer_type === 'multiple'"
                    class="ma-2"
                    color="success"
                    icon="mdi-check-all"
                    size="x-large"
                    variant="outlined"
                    @click="selectAllOptions(index)"
                  />
                  <v-btn
                    v-if="parseQuestion(interrupt.value)?.answer_type === 'multiple'"
                    class="mr-2 my-2"
                    color="warning"
                    icon="mdi-close-box"
                    size="x-large"
                    variant="outlined"
                    @click="selectNoneOptions(index)"
                  />
                  <v-spacer />
                  <v-btn
                    class="mr-5 my-2"
                    color="secondary"
                    icon="mdi-play"
                    size="x-large"
                    variant="outlined"
                    @click="resumeAnalysis(parseQuestion(interrupt.value)?.answer_type, index)"
                  />
                </v-card-actions>
              </v-card>
            </v-col>
          </v-row>
        </v-container>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>

.question-container {
  width: 100%;
  word-break: break-word;
  white-space: normal;
}

</style>
