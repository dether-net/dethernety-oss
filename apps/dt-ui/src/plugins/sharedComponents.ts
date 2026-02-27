// src/plugins/shared-components.ts
import type { App } from 'vue'
import AnalysisFlowDialog from '@/components/Dialogs/Analysis/AnalysisFlowDialog.vue'
import IssueDialog from '@/components/Dialogs/Issues/IssueDialog.vue'
import IssueSelector from '@/components/Dialogs/General/IssueSelector.vue'

export function registerSharedComponents(app: App) {
  app.component('AnalysisFlowDialog', AnalysisFlowDialog)
  app.component('IssueDialog', IssueDialog)
  app.component('IssueSelector', IssueSelector)
}