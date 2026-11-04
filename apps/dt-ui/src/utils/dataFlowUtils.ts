// useDnD.ts
import { useVueFlow } from '@vue-flow/core'
import { Ref, ref, watch } from 'vue'
import { unflattenFlatKeys } from '@dethernety/dt-core'

interface State {
  draggedType: Ref<string | null>;
  isDragOver: Ref<boolean>;
  isDragging: Ref<boolean>;
}

const state: State = {
  draggedType: ref<string | null>(null),
  isDragOver: ref<boolean>(false),
  isDragging: ref<boolean>(false),
}

interface NodeType {
    width: number;
    height: number;
    displayName: string;
    component: string;
}

export const nodeTypes: Record<string, NodeType> = {
  PROCESS: {
    width: 80,
    height: 80,
    displayName: 'Process',
    component: 'ProcessNode',
  },
  STORE: {
    width: 100,
    height: 50,
    displayName: 'Store',
    component: 'StoreNode',
  },
  EXTERNAL_ENTITY: {
    width: 90,
    height: 80,
    displayName: 'External Entity',
    component: 'ExternalEntityNode',
  },
  BOUNDARY: {
    width: 150,
    height: 150,
    displayName: 'Boundary',
    component: 'BoundaryNode',
  },
}

export function useDragAndDrop () {
  const { draggedType, isDragOver, isDragging } = state

  const { screenToFlowCoordinate } = useVueFlow()

  watch(isDragging, (dragging: boolean) => {
    document.body.style.userSelect = dragging ? 'none' : ''
  })

  function onDragStart (event: DragEvent, type: string): void {
    if (event.dataTransfer) {
      event.dataTransfer.setData('application/vueflow', type)
      event.dataTransfer.effectAllowed = 'move'
    }

    draggedType.value = type
    isDragging.value = true

    document.addEventListener('drop', onDragEnd)
  }

  function onDragOver (event: DragEvent): void {
    event.preventDefault()

    if (draggedType.value) {
      isDragOver.value = true

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move'
      }
    }
  }

  function onDragLeave (): void {
    isDragOver.value = false
  }

  function onDragEnd (): void {
    isDragging.value = false
    isDragOver.value = false
    draggedType.value = null
    document.removeEventListener('drop', onDragEnd)
  }

  /**
   * Handles the drop event and triggers the provided callback.
   *
   * @param event - The drag event.
   * @param onNodeDrop - Callback to handle the node drop.
   */
  function onDrop (event: DragEvent, onNodeDrop: (type: string, position: { x: number; y: number }) => void): void {
    event.preventDefault()

    if (!draggedType.value) return

    const position = screenToFlowCoordinate({
      x: event.clientX,
      y: event.clientY,
    })

    const nodeTypeValue = draggedType.value

    // Call the provided callback with the node type and position
    onNodeDrop(nodeTypeValue, position)

    onDragEnd()
  }

  return {
    draggedType,
    isDragOver,
    isDragging,
    onDragStart,
    onDragLeave,
    onDragOver,
    onDrop,
  }
}

export function flattenProperties (
  obj: any,
  prefix: string = '',
  result: any = {},
): any {
  // If obj is a primitive (including a string) or null, assign it directly and return.
  if (typeof obj !== 'object' || obj === null) {
    if (prefix) {
      result[prefix] = obj
    }
    return result
  }

  // Otherwise, iterate over the object's own properties.
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key]
      // Build the new key name.
      const prefixedKey = prefix ? `${prefix}.${key}` : key

      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          // For arrays, iterate over each element.
          value.forEach((item, index) => {
            // Instead of recursing directly on primitives (which would cause character-by-character flattening),
            // check if the item is not an object.
            if (typeof item !== 'object' || item === null) {
              result[`${prefixedKey}[${index}]`] = item
            } else {
              flattenProperties(item, `${prefixedKey}[${index}]`, result)
            }
          })
        } else if (Object.keys(value).length > 0) {
          // Recursively flatten non-empty objects.
          flattenProperties(value, prefixedKey, result)
        } else {
          // For empty objects, just assign the value.
          result[prefixedKey] = value
        }
      } else {
        // For non-objects (primitives), assign the value directly.
        result[prefixedKey] = value
      }
    }
  }
  return result
}

// Rebuilds flat attribute keys into nested objects, with the limits of dt-core's flat-keys.ts: a key over them (list
// index, total list entries, parts, a reserved name, keys that disagree) is left out, so opening an element can never
// build a huge list. Lists keep holes where no key fills them.
export function unflattenProperties (obj: any): any {
  return unflattenFlatKeys(obj ?? {}).value
}

export function getNewName ({ baseName, existingNames }: { baseName: string, existingNames: (string | undefined | null)[] }): string {
  if (!existingNames || !existingNames.includes(baseName)) {
    return baseName
  }

  let index = 1
  let newName = `${baseName} ${index}`
  while (existingNames.includes(newName)) {
    index++
    newName = `${baseName} ${index}`
  }
  return newName
}

export function getId () {
  return Math.random().toString(36).substring(2, 15)
}

/**
 * Get user-friendly page display name from route path
 * @param path - The route path (e.g., '/dataflow', '/browser')
 * @returns User-friendly page name (e.g., 'Data Flow', 'Browser')
 */
export function getPageDisplayName (path: string): string {
  switch (path) {
    case '/dataflow':
      return 'Data Flow'
    case '/browser':
      return 'Browser'
    case '/issues':
      return 'Issues'
    case '/analysisresults':
      return 'Analysis Results'
    default:
      // Fallback: capitalize and format the path
      return path.split('/').pop()?.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown Page'
  }
}

/**
 * The attributes to save, with every answer the user took back sent as null. The server merges a save into the
 * stored attributes (a key left out keeps its old value), and a null removes the key there, so an attribute the
 * user set back to unanswered needs an explicit null. `prior` and `next` are attribute maps in the shape the caller
 * saves (flattened, or top-level where a list is one value); a key `prior` held a value for and `next` does not is
 * sent as null.
 */
export function withClearedAttributes (
  prior: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...next }
  for (const [key, value] of Object.entries(prior ?? {})) {
    // Own keys only, so a key named like a built-in (toString, constructor) is cleared too; defineProperty keeps a
    // `__proto__` key an own key rather than setting the prototype.
    if (value !== undefined && value !== null && !Object.hasOwn(out, key)) {
      Object.defineProperty(out, key, { value: null, enumerable: true, writable: true, configurable: true })
    }
  }
  return out
}

/**
 * The attributes with every emptied entry taken out of their lists. Clearing a row of a list in the attributes form
 * leaves a hole (or undefined) in that list, which is sent as null, and the server refuses a list that holds null.
 * An emptied row is the user's "no value here", so it is dropped. An empty string stays: it is a value. Applied to
 * the whole map before a save, so a list stored earlier with a null in it heals on the next save. Top-level lists only,
 * for a caller that saves the map in its top-level shape (a flattened map holds no lists).
 */
export function withoutEmptiedListEntries (attributes: Record<string, unknown>): Record<string, unknown> {
  // Built with fromEntries, so a `__proto__` key stays an own key instead of hitting the prototype setter.
  return Object.fromEntries(Object.entries(attributes ?? {}).map(([key, value]) => [
    key,
    // filter skips holes, and the predicate drops null and undefined.
    Array.isArray(value) ? value.filter(entry => entry !== null && entry !== undefined) : value,
  ]))
}
