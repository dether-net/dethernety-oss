// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive, nextTick } from 'vue'

const mockStore = reactive<{ selectedItem: unknown; modelId: string | undefined }>({
  selectedItem: {
    id: 'n-1',
    type: 'PROCESS',
    position: { x: 0, y: 0 },
  },
  modelId: 'model-1',
})

vi.mock('@/stores/flowStore', () => ({
  useFlowStore: () => mockStore,
}))

import SettingsGeneralTab from '../SettingsGeneralTab.vue'

const stubs = {
  ClassPicker: {
    name: 'ClassPicker',
    template:
      '<div class="ClassPicker-stub">'
      + '<button class="stub-commit" @click="$emit(\'commit-request\', { classId: \'cls-new\' })">commit</button>'
      + '<button class="stub-focus" @click="$emit(\'picker:focus\')">focus</button>'
      + '<button class="stub-blur" @click="$emit(\'picker:blur\')">blur</button>'
      + '<button class="stub-sheet-open" @click="$emit(\'picker:sheet-open\')">sheet-open</button>'
      + '<button class="stub-sheet-close" @click="$emit(\'picker:sheet-close\')">sheet-close</button>'
      + '</div>',
    props: ['modelValue', 'classLabel', 'componentType', 'elementName', 'elementDescription', 'modelId', 'currentClassName', 'label'],
    emits: ['commit-request', 'picker:focus', 'picker:blur', 'picker:sheet-open', 'picker:sheet-close'],
  },
  ConfirmClassOrModelChangeDialog: {
    name: 'ConfirmClassOrModelChangeDialog',
    template:
      '<div class="confirm-dialog-stub" v-if="show">'
      + '<button class="stub-dlg-commit" @click="$emit(\'commit-and-change\')">commit-and-change</button>'
      + '<button class="stub-dlg-discard" @click="$emit(\'discard-and-change\')">discard-and-change</button>'
      + '<button class="stub-dlg-cancel" @click="$emit(\'cancel\')">cancel</button>'
      + '</div>',
    props: ['show', 'hasDirtyEdits'],
    emits: ['commit-and-change', 'discard-and-change', 'cancel'],
  },
  ContentSelectDialog: { template: '<div class="content-select-stub" />' },
  'v-card': { template: '<div class="v-card"><slot /></div>' },
  'v-container': { template: '<div class="v-container"><slot /></div>' },
  'v-row': { template: '<div class="v-row"><slot /></div>' },
  'v-col': { template: '<div class="v-col"><slot /></div>' },
  'v-text-field': {
    template:
      '<div class="v-text-field-wrapper" :class="$attrs.class">'
      + '<input class="v-text-field" :value="modelValue" @focus="$emit(\'focus\')" @blur="$emit(\'blur\')" @input="$emit(\'update:modelValue\', $event.target.value)" />'
      + '</div>',
    props: ['modelValue', 'label', 'required', 'rules', 'readonly', 'disabled'],
    emits: ['focus', 'blur', 'update:modelValue'],
  },
  'v-textarea': {
    template:
      '<textarea class="v-textarea" :value="modelValue" @blur="$emit(\'blur\')" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ['modelValue', 'label', 'rules'],
    emits: ['blur', 'update:modelValue'],
  },
  'v-btn': {
    template: '<button class="v-btn" @click="$emit(\'click\')"><slot /></button>',
    emits: ['click'],
  },
  'v-switch': {
    template:
      '<div class="v-switch"><input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" /></div>',
    props: ['modelValue', 'label'],
    emits: ['update:modelValue'],
  },
  'v-alert': { template: '<div class="v-alert"><slot /></div>' },
}

const defaultProps = {
  formData: {
    name: 'auth',
    class: '',
    model: '',
    modelName: '',
    description: '',
    category: '',
  },
  isFromClass: true,
  crownJewel: false,
  itemClass: null,
  representedModel: null,
}

const propsWithPriorClass = {
  ...defaultProps,
  formData: { ...defaultProps.formData, class: 'cls-old' },
  itemClass: { id: 'cls-old', name: 'OldAuth' } as unknown as object,
}

beforeEach(() => {
  mockStore.selectedItem = {
    id: 'n-1',
    type: 'PROCESS',
    position: { x: 0, y: 0 },
  }
  mockStore.modelId = 'model-1'
})

async function mountAndSettle(propsOverride: Record<string, unknown> = {}) {
  const wrapper = mount(SettingsGeneralTab, {
    props: { ...defaultProps, ...propsOverride },
    global: { stubs },
  })
  await nextTick()
  return wrapper
}

describe('SettingsGeneralTab — commit-request flow (no prior class)', () => {
  it('no dialog, formData.class updated, class-change-commit emitted', async () => {
    const wrapper = await mountAndSettle()
    await wrapper.find('.stub-commit').trigger('click')
    await nextTick()
    expect(wrapper.find('.confirm-dialog-stub').exists()).toBe(false)
    const formDataEvents = wrapper.emitted('update:formData')
    expect(formDataEvents).toBeTruthy()
    expect((formDataEvents!.at(-1)![0] as { class: string }).class).toBe('cls-new')
    expect(wrapper.emitted('class-change-commit')).toBeTruthy()
  })
})

describe('SettingsGeneralTab — commit-request flow (prior class, dialog gated)', () => {
  it('opens dialog without yet writing formData.class', async () => {
    const wrapper = await mountAndSettle(propsWithPriorClass)
    await wrapper.find('.stub-commit').trigger('click')
    await nextTick()
    expect(wrapper.find('.confirm-dialog-stub').exists()).toBe(true)
    expect(wrapper.emitted('update:formData')).toBeFalsy()
    expect(wrapper.emitted('class-change-commit')).toBeFalsy()
  })

  it('commit-and-change applies pending class and emits class-change-commit', async () => {
    const wrapper = await mountAndSettle(propsWithPriorClass)
    await wrapper.find('.stub-commit').trigger('click')
    await wrapper.find('.stub-dlg-commit').trigger('click')
    await nextTick()
    const formDataEvents = wrapper.emitted('update:formData')
    expect(formDataEvents).toBeTruthy()
    expect((formDataEvents!.at(-1)![0] as { class: string }).class).toBe('cls-new')
    expect(wrapper.emitted('class-change-commit')).toBeTruthy()
    expect(wrapper.find('.confirm-dialog-stub').exists()).toBe(false)
  })

  it('cancel discards pending class; no formData write; no class-change-commit', async () => {
    const wrapper = await mountAndSettle(propsWithPriorClass)
    await wrapper.find('.stub-commit').trigger('click')
    await wrapper.find('.stub-dlg-cancel').trigger('click')
    await nextTick()
    expect(wrapper.emitted('update:formData')).toBeFalsy()
    expect(wrapper.emitted('class-change-commit')).toBeFalsy()
    expect(wrapper.emitted('class-change-cancel')).toBeTruthy()
  })
})

describe('SettingsGeneralTab — save-on-blur suppression', () => {
  it('picker:focus + name blur → saveItem NOT emitted; picker:blur → exactly one saveItem (coalesced)', async () => {
    const wrapper = await mountAndSettle()
    await wrapper.find('.stub-focus').trigger('click')
    await wrapper.find('input.v-text-field').trigger('blur')
    await nextTick()
    expect(wrapper.emitted('saveItem')).toBeFalsy()

    await wrapper.find('.stub-blur').trigger('click')
    await nextTick()
    const events = wrapper.emitted('saveItem')
    expect(events).toBeTruthy()
    expect(events!.length).toBe(1)
  })

  it('sheet-open + name blur + sheet-close → exactly one saveItem (coalesced)', async () => {
    const wrapper = await mountAndSettle()
    await wrapper.find('.stub-sheet-open').trigger('click')
    await wrapper.find('input.v-text-field').trigger('blur')
    await nextTick()
    expect(wrapper.emitted('saveItem')).toBeFalsy()

    await wrapper.find('.stub-sheet-close').trigger('click')
    await nextTick()
    const events = wrapper.emitted('saveItem')
    expect(events).toBeTruthy()
    expect(events!.length).toBe(1)
  })

  it('blur with no picker active fires saveItem immediately', async () => {
    const wrapper = await mountAndSettle()
    await wrapper.find('input.v-text-field').trigger('blur')
    await nextTick()
    const events = wrapper.emitted('saveItem')
    expect(events).toBeTruthy()
    expect(events!.length).toBe(1)
  })

  it('multiple blurs during suppression coalesce into one saveItem on release', async () => {
    const wrapper = await mountAndSettle()
    await wrapper.find('.stub-focus').trigger('click')
    await wrapper.find('input.v-text-field').trigger('blur')
    await wrapper.find('.v-textarea').trigger('blur')
    await nextTick()
    expect(wrapper.emitted('saveItem')).toBeFalsy()
    await wrapper.find('.stub-blur').trigger('click')
    await nextTick()
    const events = wrapper.emitted('saveItem')
    expect(events).toBeTruthy()
    expect(events!.length).toBe(1)
  })
})

describe('SettingsGeneralTab — confirm dialog gates save-on-blur (UX review B2)', () => {
  it('save does not fire while the confirm dialog is open', async () => {
    const wrapper = await mountAndSettle(propsWithPriorClass)
    // Type in name (blur not yet)
    await wrapper.find('input.v-text-field').trigger('blur')
    await nextTick()
    // Save fired (no picker active yet) — get baseline
    const baselineEvents = wrapper.emitted('saveItem')?.length ?? 0

    // Commit-request → opens confirm dialog
    await wrapper.find('.stub-commit').trigger('click')
    await nextTick()
    expect(wrapper.find('.confirm-dialog-stub').exists()).toBe(true)

    // Blur the name field while dialog is open — save must NOT fire
    await wrapper.find('input.v-text-field').trigger('blur')
    await nextTick()
    expect((wrapper.emitted('saveItem')?.length ?? 0)).toBe(baselineEvents)

    // Resolve the dialog with commit — child does NOT flush its own queue;
    // the parent's class-change-commit handler owns the save via onSubmit
    // (verified independently in SettingsWindow). From the child's perspective
    // in isolation, no additional saveItem is emitted on the commit path.
    await wrapper.find('.stub-dlg-commit').trigger('click')
    await nextTick()
    expect((wrapper.emitted('saveItem')?.length ?? 0)).toBe(baselineEvents)
  })

  it('cancel path still flushes queued blurs (child retains ownership)', async () => {
    const wrapper = await mountAndSettle(propsWithPriorClass)
    // Baseline blur to establish save count
    await wrapper.find('input.v-text-field').trigger('blur')
    await nextTick()
    const baselineEvents = wrapper.emitted('saveItem')?.length ?? 0

    // Open dialog
    await wrapper.find('.stub-commit').trigger('click')
    await nextTick()

    // Blur during dialog open — queued
    await wrapper.find('input.v-text-field').trigger('blur')
    await nextTick()
    expect((wrapper.emitted('saveItem')?.length ?? 0)).toBe(baselineEvents)

    // Cancel the dialog — queued blur flushes (child retains ownership on cancel path)
    await wrapper.find('.stub-dlg-cancel').trigger('click')
    await nextTick()
    expect((wrapper.emitted('saveItem')?.length ?? 0)).toBe(baselineEvents + 1)
    expect(wrapper.emitted('class-change-commit')).toBeFalsy()
    expect(wrapper.emitted('class-change-cancel')).toBeTruthy()
  })
})

describe('SettingsGeneralTab — isFromClass toggle memory', () => {
  it('remembers last picked class across off→on toggle', async () => {
    const wrapper = await mountAndSettle({
      formData: { ...defaultProps.formData, class: 'cls-1' },
      isFromClass: true,
    })
    // toggle off
    await wrapper.setProps({ isFromClass: false, formData: { ...defaultProps.formData, class: '' } })
    await nextTick()
    // toggle back on with class cleared
    await wrapper.setProps({ isFromClass: true, formData: { ...defaultProps.formData, class: '' } })
    await nextTick()
    const formDataEvents = wrapper.emitted('update:formData')
    expect(formDataEvents).toBeTruthy()
    const restored = (formDataEvents!.at(-1)![0] as { class: string }).class
    expect(restored).toBe('cls-1')
  })
})

describe('SettingsGeneralTab — crownJewel toggle', () => {
  // The crown button is the only <v-btn> rendered in this config (the open-model
  // button needs !isFromClass + a model; the default props have isFromClass: true).
  // It only renders for components (componentType !== null) — the mock store's
  // selectedItem is a PROCESS, so it shows.
  it('emits update:crownJewel(true) when marking a non-crown component', async () => {
    const wrapper = await mountAndSettle({ crownJewel: false })
    await wrapper.find('.v-btn').trigger('click')
    expect(wrapper.emitted('update:crownJewel')).toEqual([[true]])
  })

  it('emits update:crownJewel(false) when unmarking an existing crown jewel', async () => {
    const wrapper = await mountAndSettle({ crownJewel: true })
    await wrapper.find('.v-btn').trigger('click')
    expect(wrapper.emitted('update:crownJewel')).toEqual([[false]])
  })
})
