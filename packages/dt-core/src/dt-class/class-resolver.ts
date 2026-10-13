import { Module, Class } from '../interfaces/core-types-interface.js'

/** The element kinds a model file binds to a class. */
export type ResolvableClassKind = 'COMPONENT' | 'BOUNDARY' | 'DATA_FLOW' | 'DATA'

/**
 * The class an element's file names, resolved on this platform, or why it could not be: `unresolved` names the class
 * reference that was not found; `warning` is import's message, which adds what import does with the element.
 */
export type ClassResolution =
  | { id: string; warning?: undefined; unresolved?: undefined }
  | { id: null; warning: string; unresolved: string }

const CLASSES_OF: Record<ResolvableClassKind, (m: Module) => Class[] | undefined> = {
  COMPONENT: (m) => m.componentClasses,
  BOUNDARY: (m) => m.securityBoundaryClasses,
  DATA_FLOW: (m) => m.dataFlowClasses,
  DATA: (m) => m.dataClasses,
}

/**
 * Finds the platform class a model file's `classData` names, the same way for import and update: by id, then by
 * module id and class name, then by module name and class name. The module catalogue is fetched once per resolver.
 */
export class ClassResolver {
  private modules: Module[] | null = null
  private loadFailed = false

  constructor(private readonly loadModules: () => Promise<Module[]>) {}

  /** The module catalogue, fetched once. Empty when it could not be fetched (see catalogAvailable). */
  catalog = async (): Promise<Module[]> => {
    if (this.modules === null) {
      try {
        this.modules = await this.loadModules()
      } catch {
        // Unavailable for this run: cache empty so the catalogue is not asked again per element.
        this.modules = []
        this.loadFailed = true
      }
    }
    return this.modules
  }

  /** False when the catalogue could not be fetched, so an unresolved class says nothing about the platform. */
  catalogAvailable = async (): Promise<boolean> => {
    await this.catalog()
    return !this.loadFailed
  }

  resolve = async (classData: any, kind: ResolvableClassKind): Promise<ClassResolution> => {
    const label = kind.toLowerCase()
    try {
      const modules = await this.catalog()
      const classesOf = CLASSES_OF[kind]
      if (classData.id && modules.some((m) => classesOf(m)?.some((c) => c.id === classData.id))) {
        return { id: classData.id }
      }
      const byName = (module: Module | undefined) => (module ? classesOf(module)?.find((c) => c.name === classData.name) : undefined)
      if (classData.module?.id && classData.name) {
        const found = byName(modules.find((m) => m.id === classData.module.id))
        if (found) return { id: found.id }
      }
      if (classData.module?.name && classData.name) {
        const found = byName(modules.find((m) => m.name === classData.module.name))
        if (found) return { id: found.id }
      }
      // An export's class id may no longer exist here (a migrated id), and the name tiers need `module`.
      const idHint = classData.id ? `id=${classData.id}` : 'id=<missing>'
      const nameHint = classData.name ? `name=${classData.name}` : 'name=<missing>'
      const moduleHint = classData.module ? `module=${classData.module.name || classData.module.id}` : 'module=<missing from export>'
      const unresolved = `Could not resolve ${label} class (${idHint}, ${nameHint}, ${moduleHint})`
      return { id: null, unresolved, warning: `${unresolved}; instance will be created without an IS_INSTANCE_OF edge.` }
    } catch (error) {
      const unresolved = `Could not resolve ${label} class ${classData.name || classData.id}: ${error}`
      return { id: null, unresolved, warning: unresolved }
    }
  }
}
