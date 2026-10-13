import type { ConsolidatedAttributesFile, SplitModel, StructureBoundary, UnresolvedClass } from '@dethernety/dt-core'

const ATTRIBUTE_KEY = {
  BOUNDARY: 'boundaries',
  COMPONENT: 'components',
  DATA_FLOW: 'dataFlows',
  DATA: 'dataItems',
} as const

function findInStructure(boundary: StructureBoundary | undefined, id: string): { classData?: unknown } | undefined {
  if (!boundary) return undefined
  if (boundary.id === id) return boundary
  const component = boundary.components?.find((c) => c.id === id)
  if (component) return component
  for (const child of boundary.boundaries ?? []) {
    const found = findInStructure(child, id)
    if (found) return found
  }
  return undefined
}

/**
 * After a push, the model files are rewritten from the platform. For an element whose class the platform does not
 * have, the push left the platform's binding and answers as they were; writing those back would replace the class
 * the user chose with the platform's, and lose it. Instead the element keeps its local class reference and its
 * local attribute entry (or none, when it had none), so the files still say what the user chose and the next push
 * warns again. Returns how many elements kept their local class.
 *
 * `exported.attributes` must already be the merged bag; it is changed in place, as is `exported`'s structure.
 */
export function keepUnresolvedClasses(
  exported: SplitModel,
  localAttributes: ConsolidatedAttributesFile,
  unresolved: UnresolvedClass[] | undefined,
  idMapping: Map<string, string>,
): number {
  let kept = 0
  for (const u of unresolved ?? []) {
    if (!u.elementId) continue
    const platformId = idMapping.get(u.elementId) ?? u.elementId
    const element =
      u.kind === 'DATA_FLOW'
        ? exported.dataFlows.find((f) => f.id === platformId)
        : u.kind === 'DATA'
          ? exported.dataItems.find((d) => d.id === platformId)
          : findInStructure(exported.structure.defaultBoundary, platformId)
    if (!element) continue
    element.classData = u.classData as typeof element.classData

    const key = ATTRIBUTE_KEY[u.kind]
    const bag = (exported.attributes[key] ??= {})
    const local = localAttributes[key]?.[u.elementId]
    if (local) bag[platformId] = { ...local, elementId: platformId }
    else delete bag[platformId]
    kept++
  }
  return kept
}
