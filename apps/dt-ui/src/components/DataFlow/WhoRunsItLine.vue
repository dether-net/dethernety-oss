<script setup lang="ts">
  import { computed, ref, watch } from 'vue'
  import type { Node } from '@vue-flow/core'
  import { useFlowStore } from '@/stores/flowStore'
  import { isUnavailableNotice, whoRunsItTexts, WHO_RUNS_COPY } from '@/utils/whoRunsIt'
  import type { OwnReadState, ParentReadState } from '@/utils/whoRunsIt'
  import type { OperationAttributeBag } from '@dethernety/dt-core'

  const props = defineProps<{
    item: Node
    template?: unknown
    ownState: OwnReadState
    ownBag: OperationAttributeBag
  }>()

  const flowStore = useFlowStore()

  const kind = computed(() => (props.item.type === 'BOUNDARY' ? 'boundary' : 'component'))
  const defaultBoundaryId = computed(() => flowStore.defaultBoundaryId || '')
  const parentId = computed(() => props.item.parentNode || '')
  const isRootParent = computed(() => !parentId.value || parentId.value === defaultBoundaryId.value)
  const parentBoundary = computed(() =>
    kind.value === 'component' && !isRootParent.value ? flowStore.boundaryById(parentId.value) : undefined,
  )
  const parentClassId = computed<string>(() => parentBoundary.value?.data?.classId || '')

  const parentState = ref<ParentReadState>('none')
  const parentBag = ref<OperationAttributeBag>(undefined)

  // Each read of the parent takes the next number. Only the latest one sets the state, whatever order they answer in.
  let parentRequest = 0

  watch(
    [() => props.item.id, parentId, parentClassId],
    async () => {
      const request = ++parentRequest
      parentBag.value = undefined
      if (!parentClassId.value) {
        parentState.value = 'none'
        return
      }
      parentState.value = 'loading'
      try {
        const stored = await flowStore.getAttributesFromClassRelationship({
          componentId: parentId.value,
          classId: parentClassId.value,
        })
        if (request !== parentRequest) return
        parentBag.value = (stored ?? {}) as OperationAttributeBag
        parentState.value = 'read'
      } catch (e) {
        if (request !== parentRequest) return
        console.error('Failed to read the hosting boundary\'s declaration', e)
        parentState.value = 'failed'
      }
    },
    { immediate: true },
  )

  // A boundary's zone is its own or inherited. A component has none of its own: it reads its parent's, the root's when
  // drawn directly in the model.
  const effectiveZone = computed(
    () => flowStore.effectiveZone(kind.value === 'boundary' ? props.item.id : parentId.value || defaultBoundaryId.value).zone,
  )

  const drawnComponents = computed(() => {
    if (kind.value !== 'boundary' || props.item.id === defaultBoundaryId.value) return 0
    return flowStore.nodes.filter((n) => n.parentNode === props.item.id && n.type !== 'BOUNDARY').length
  })

  const texts = computed(() =>
    whoRunsItTexts({
      kind: kind.value,
      ownState: props.ownState,
      ownBag: props.ownBag,
      effectiveZone: effectiveZone.value,
      unavailable: isUnavailableNotice(props.template),
      parent:
        parentState.value === 'none' || !parentBoundary.value
          ? undefined
          : {
            id: parentId.value,
            name: parentBoundary.value.data?.label ?? '',
            state: parentState.value,
            bag: parentBag.value,
          },
      drawnComponents: drawnComponents.value,
    }),
  )
</script>

<template>
  <v-sheet class="px-4 py-2 mb-2 text-body-2" role="note">
    <span class="font-weight-medium">{{ WHO_RUNS_COPY.label }}:</span>
    {{ texts.join('. ') }}
  </v-sheet>
</template>
