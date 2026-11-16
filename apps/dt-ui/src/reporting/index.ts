import { createBrandSource, defaultBrandDeps, type Brand, type BrandDeps } from './brand'
import { renderModelDiagram, type DiagramOptions, type DiagramResult, type ModelGraph } from './diagram'
import { download, type ReportFileName } from './download'
import { escapeHtml } from './escape'
import { buildReport, type ReportInput } from './frame'
import { getReportDetails, type ReportDetails } from './reportDetails'
import { currentUser } from './user'

// The types a module author codes against.
export type { Brand } from './brand'
export type { DiagramOptions, DiagramResult, ModelGraph } from './diagram'
export type { ReportFileName } from './download'
export type { FrameStrings, ReportFacts, ReportInput, ReportSection } from './frame'
export type { ReportDetails } from './reportDetails'

/**
 * The report kit modules use to build an export: `window.__HOST_DEPENDENCIES__.reporting`, and the same object from
 * `useHostContext().reporting`. `version` is raised only when a member is added, never to change one, so a module checks
 * `kit.version >= n` for the members it needs and falls back to its own export when the kit is missing or older.
 */
export interface ReportingKit {
  version: 1
  /** Text for HTML content or a quoted attribute; use it for every value a module puts in its section markup. */
  escapeHtml(text: unknown): string
  /** The signed-in user's display name; null when unknown or when only an opaque id is known. */
  currentUser(): { displayName: string } | null
  /** The installation's brand, read once per page load; null when unbranded. */
  brand(): Promise<Brand | null>
  /** The analysis's report details, read-only: they are set in the host's Report details dialog. */
  reportDetails: { get(analysisId: string): Promise<ReportDetails | null> }
  /**
   * The model's diagram from the graph a report stored when it was generated (never the live model): `figure` is ready
   * to put into a section. Null for an empty graph or one with a coordinate that is not a finite number.
   */
  renderModelDiagram(graph: ModelGraph, opts?: DiagramOptions): DiagramResult | null
  /**
   * The complete report as one self-contained HTML document. The frame escapes everything it prints itself; a
   * section's `html` and the module's `css` go in as given, so the module escapes its own values (`escapeHtml`).
   */
  buildReport(input: ReportInput): string
  /** Saves the report as one self-contained HTML file named `<kind>[-<variant>]-<stamp>.html`. */
  download(report: string, name: ReportFileName): void
}

export function createReportingKit(brandDeps: BrandDeps = defaultBrandDeps): ReportingKit {
  const brand = createBrandSource(brandDeps)
  return Object.freeze({
    version: 1 as const,
    escapeHtml,
    currentUser,
    brand,
    reportDetails: Object.freeze({ get: getReportDetails }),
    renderModelDiagram,
    buildReport,
    download,
  })
}

let kit: ReportingKit | null = null

/** The page's one kit. Creating it starts reading the brand, so an export later resolves it from cache. */
export function getReportingKit(): ReportingKit {
  if (!kit) {
    kit = createReportingKit()
    void kit.brand()
  }
  return kit
}
