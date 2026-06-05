// vue-shim.js
const runtime = window.__HOST_DEPENDENCIES__?.__VUE__
if (!runtime) {
  throw new Error('[module] Host Vue runtime not found on window.__HOST_DEPENDENCIES__.__VUE__')
}

export default runtime

// Explicit named re-exports (cover common Vue 3 runtime-dom APIs and SFC-compiler helpers)
export const {
  // reactivity & utilities
  ref,
  shallowRef,
  reactive,
  readonly,
  shallowReactive,
  shallowReadonly,
  computed,
  watch,
  watchEffect,
  toRef,
  toRefs,
  unref,
  isRef,
  isReactive,
  isReadonly,
  toRaw,
  markRaw,
  // lifecycle
  onMounted,
  onUnmounted,
  onBeforeMount,
  onBeforeUnmount,
  onUpdated,
  onBeforeUpdate,
  onErrorCaptured,
  onActivated,
  onDeactivated,
  onServerPrefetch,
  // app/context
  provide,
  inject,
  getCurrentInstance,
  nextTick,
  effectScope,
  useCssVars,
  // component helpers
  defineComponent,
  defineAsyncComponent,
  h,
  // vnode & render helpers used by the SFC compiler
  openBlock,
  createBlock,
  createVNode,
  createElementVNode,
  createElementBlock,
  createBaseVNode,
  createTextVNode,
  createCommentVNode,
  createStaticVNode,
  withCtx,
  withDirectives,
  withModifiers,
  withKeys,
  renderList,
  renderSlot,
  createSlots,
  normalizeClass,
  normalizeStyle,
  normalizeProps,
  guardReactiveProps,
  mergeProps,
  toDisplayString,
  resolveComponent,
  resolveDirective,
  isVNode,
  // built-in components/constants
  Fragment,
  Text,
  Comment,
  Teleport,
  Suspense,
  Transition,
  TransitionGroup,
  // v-model helpers that the compiler may emit
  vModelText,
  vModelCheckbox,
  vModelSelect,
  vModelDynamic,
  // composition helpers
  useAttrs,
  useSlots,
} = runtime

export const resolveDynamicComponent = runtime.resolveDynamicComponent
