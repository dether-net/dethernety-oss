// useDnD.ts
import { useVueFlow } from '@vue-flow/core'
import { Ref, ref, watch } from 'vue'

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

// Function to unflatten properties and reconstruct nested objects
export function unflattenProperties (obj: any): any {
  const result: any = {}

  // Iterate over each flat key in the object.
  for (const flatKey in obj) {
    if (!obj.hasOwnProperty(flatKey)) continue
    const value = obj[flatKey]

    // Use a regex to extract both property names and array indices.
    // This regex matches either a sequence of characters that are not a dot or square bracket,
    // or matches a number inside square brackets.
    // eslint-disable-next-line no-useless-escape
    const regex = /([^\.\[\]]+)|\[(\d+)\]/g
    const keys: (string | number)[] = []
    let match
    while ((match = regex.exec(flatKey)) !== null) {
      if (match[1] !== undefined) {
        if (match[1] === '__proto__' || match[1] === 'constructor' || match[1] === 'prototype') {
          continue
        }
        keys.push(match[1])
      } else if (match[2] !== undefined) {
        keys.push(Number(match[2])) // Convert array index to a number.
      }
    }

    // Now rebuild the nested structure from the keys.
    let current = result
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]

      // If we're at the last key, assign the value.
      if (i === keys.length - 1) {
        current[k] = value
      } else {
        // Decide whether the next key is a number (an array index) or a property.
        const nextKey = keys[i + 1]

        if (typeof nextKey === 'number') {
          // The next key is a number, so we need an array at the current position.
          if (!Array.isArray(current[k])) {
            current[k] = []
          }
        } else {
          // Otherwise, we need an object.
          if (typeof current[k] !== 'object' || current[k] === null) {
            current[k] = {}
          }
        }
        // Move deeper into the nested structure.
        current = current[k]
      }
    }
  }
  return result
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
