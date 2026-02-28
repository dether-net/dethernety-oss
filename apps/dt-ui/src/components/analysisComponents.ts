import ReportText from '@/components/AnalysisResults/BasicThreatAnalysis/ReportComponents/ReportText.vue'
import ReportScopeComponents from '@/components/AnalysisResults/BasicThreatAnalysis/ReportComponents/ReportScopeComponents.vue'
import AttackTechniquesByCriticality from '@/components/AnalysisResults/BasicThreatAnalysis/ReportComponents/AttackTechniquesByCriticality.vue'
import MitigationRecommendationsByCriticality from '@/components/AnalysisResults/BasicThreatAnalysis/ReportComponents/MitigationRecommendationsByCriticality.vue'
import ComponentAnalysisStatistics from '@/components/AnalysisResults/BasicThreatAnalysis/ReportComponents/ComponentAnalysisStatistics.vue'
import ComponentInfo from '@/components/AnalysisResults/BasicThreatAnalysis/ReportComponents/ComponentInfo.vue'
import ComponentAttackTechniques from '@/components/AnalysisResults/BasicThreatAnalysis/ReportComponents/ComponentAttackTechniques.vue'
import ComponentSummary from '@/components/AnalysisResults/BasicThreatAnalysis/ReportComponents/ComponentSummary.vue'
import ComponentAnalysisSummary from '@/components/AnalysisResults/BasicThreatAnalysis/ReportComponents/ComponentAnalysisSummary.vue'

export const reportComponents: Record<string, any> = {
  components: ReportScopeComponents,
  attack_techniques_by_criticality: AttackTechniquesByCriticality,
  mitigation_recommendations_by_criticality: MitigationRecommendationsByCriticality,
  component_analysis_statistics: ComponentAnalysisStatistics,
  attack_techniques: ComponentAttackTechniques,
  summary_and_additional_comments: ComponentSummary,
  component: ComponentInfo,
  component_analysis_summary: ComponentAnalysisSummary,
  default: ReportText,
}
