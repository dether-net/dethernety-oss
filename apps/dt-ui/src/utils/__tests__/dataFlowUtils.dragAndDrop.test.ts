// @vitest-environment happy-dom

import { describe, it, expect, vi, afterEach } from 'vitest'

// The palette's drag state ends with the drag, dropped or not.

vi.mock('@vue-flow/core', () => ({ useVueFlow: () => ({ screenToFlowCoordinate: (p: unknown) => p }) }))

import { useDragAndDrop } from '../dataFlowUtils'

const start = () => {
  const dnd = useDragAndDrop()
  dnd.onDragStart(new Event('dragstart') as DragEvent, 'PROCESS')
  return dnd
}

describe('useDragAndDrop', () => {
  // The state is module-level, shared by every caller: end any drag a test left on, and clear what it set.
  afterEach(() => {
    document.dispatchEvent(new Event('dragend'))
    useDragAndDrop().draggedType.value = null
  })

  it('holds the dragged type until the drop', () => {
    const dnd = start()
    expect(dnd.draggedType.value).toBe('PROCESS')
    document.dispatchEvent(new Event('drop'))
    expect(dnd.draggedType.value).toBeNull()
  })

  it('lets go of it when the drag ends without a drop', () => {
    const dnd = start()
    document.dispatchEvent(new Event('dragend'))
    expect(dnd.draggedType.value).toBeNull()
    expect(dnd.isDragOver.value).toBe(false)
  })

  it('stops listening once the drag is over', () => {
    const dnd = start()
    document.dispatchEvent(new Event('dragend'))
    dnd.draggedType.value = 'STORE'
    document.dispatchEvent(new Event('drop'))
    expect(dnd.draggedType.value).toBe('STORE')
  })
})
