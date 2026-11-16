// @vitest-environment happy-dom
/**
 * The Report details dialog: it loads the analysis's client, offers another analysis's client as a suggestion it never
 * applies on its own, saves with the analysis id it was opened for, shows the server's refusal, counts characters as
 * the server does, and cannot save twice at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  getReportDetails: vi.fn(),
  suggestReportDetails: vi.fn(),
  setReportDetails: vi.fn(),
}))
vi.mock('@/reporting/reportDetails', () => api)

import ReportDetailsDialog from '../ReportDetailsDialog.vue'

const stubs = {
  // The browser's Back closes a dialog through its v-model alone.
  'v-dialog': {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<div class="dialog"><button class="back" @click="$emit(\'update:modelValue\', false)">back</button><slot /></div>',
  },
  'v-card': { template: '<div><slot /></div>' },
  'v-card-title': { template: '<div><slot /></div>' },
  'v-card-text': { template: '<div><slot /></div>' },
  'v-card-actions': { template: '<div><slot /></div>' },
  'v-sheet': { template: '<div><slot /></div>' },
  'v-icon': true,
  'v-spacer': true,
  'v-alert': { props: ['text'], template: '<div class="alert">{{ text }}</div>' },
  'v-btn': {
    props: ['disabled'],
    emits: ['click'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  'v-text-field': {
    props: ['modelValue', 'counterValue', 'disabled'],
    emits: ['update:modelValue'],
    template:
      '<div><input class="field" :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)" />' +
      '<span class="count">{{ counterValue ? counterValue(modelValue) : "" }}</span></div>',
  },
}

const SHIELD = String.fromCodePoint(0x1f6e1)

const open = async (analysisId = 'an-1') => {
  const wrapper = mount(ReportDetailsDialog, { props: { analysisId }, global: { stubs } })
  await flushPromises()
  return wrapper
}
const saveButton = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('button').find((b) => b.text() === 'Save')!
const typeClient = async (wrapper: ReturnType<typeof mount>, value: string) => {
  await wrapper.find('input.field').setValue(value)
}

enableAutoUnmount(afterEach)

describe('ReportDetailsDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.getReportDetails.mockResolvedValue({ client: 'Example Ltd' })
    api.suggestReportDetails.mockResolvedValue(null)
    api.setReportDetails.mockImplementation(async (_id: string, client: string | null) => (client ? { client } : {}))
  })

  it('loads the client of the analysis it was opened for', async () => {
    const wrapper = await open('an-7')
    expect(api.getReportDetails).toHaveBeenCalledWith('an-7')
    expect((wrapper.find('input.field').element as HTMLInputElement).value).toBe('Example Ltd')
  })

  it('offers a suggestion when the field is empty, and only fills the field when it is chosen', async () => {
    api.getReportDetails.mockResolvedValue({})
    api.suggestReportDetails.mockResolvedValue({ client: 'Earlier Client' })
    const wrapper = await open()
    const suggestion = wrapper.findAll('button').find((b) => b.text() === 'Earlier Client')!
    expect(suggestion.exists()).toBe(true)
    expect(api.setReportDetails).not.toHaveBeenCalled()
    await suggestion.trigger('click')
    expect((wrapper.find('input.field').element as HTMLInputElement).value).toBe('Earlier Client')
    expect(api.setReportDetails).not.toHaveBeenCalled()
  })

  it('offers no suggestion once the field holds a client', async () => {
    api.suggestReportDetails.mockResolvedValue({ client: 'Earlier Client' })
    const wrapper = await open()
    expect(wrapper.text()).not.toContain('Earlier Client')
  })

  it('saves the trimmed client with the analysis id it was opened for, then closes', async () => {
    const wrapper = await open('an-1')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    await wrapper.setProps({ analysisId: 'an-2' })
    await typeClient(wrapper, '  New Client  ')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(api.setReportDetails).toHaveBeenCalledWith('an-1', 'New Client')
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('closed')).toHaveLength(1)
  })

  it('clears the client when the field is emptied', async () => {
    const wrapper = await open()
    await typeClient(wrapper, '   ')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(api.setReportDetails).toHaveBeenCalledWith('an-1', null)
  })

  it('shows the server\'s refusal by its code, and stays open', async () => {
    api.setReportDetails.mockRejectedValue({ errors: [{ extensions: { code: 'REPORT_DETAILS_CLIENT_CHARACTERS' } }] })
    const wrapper = await open()
    await typeClient(wrapper, 'Bad Client')
    await saveButton(wrapper).trigger('click')
    await flushPromises()
    expect(wrapper.find('.alert').text()).toContain('a character a report cannot print')
    expect(wrapper.emitted('closed')).toBeUndefined()
  })

  it('counts characters as the server does: 120 pass, 121 do not, and an emoji counts once', async () => {
    const wrapper = await open()
    await typeClient(wrapper, SHIELD.repeat(120))
    expect(wrapper.find('.count').text()).toBe('120')
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
    await typeClient(wrapper, SHIELD.repeat(121))
    expect(wrapper.find('.count').text()).toBe('121')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
  })

  it('cannot save twice at once, from the button or from Enter in the field', async () => {
    let finish!: () => void
    api.setReportDetails.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ client: 'X' }) }))
    const wrapper = await open()
    await typeClient(wrapper, 'X')
    await saveButton(wrapper).trigger('click')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    // Enter reaches save() whatever the button's state: the guard in save() is what stops it.
    await wrapper.find('input.field').trigger('keydown', { key: 'Enter' })
    finish()
    await flushPromises()
    expect(api.setReportDetails).toHaveBeenCalledTimes(1)
  })

  it('tells the page it closed, however it closes, the browser\'s Back included', async () => {
    const wrapper = await open()
    await wrapper.find('button.back').trigger('click')
    expect(wrapper.emitted('closed')).toHaveLength(1)
  })

  it('stays open while a save is in flight, so a refusal can still show', async () => {
    let refuse!: () => void
    api.setReportDetails.mockImplementation(
      () => new Promise((_resolve, reject) => { refuse = () => reject({ errors: [{ extensions: { code: 'ANALYSIS_NOT_BOUND' } }] }) }),
    )
    const wrapper = await open()
    await typeClient(wrapper, 'X')
    await saveButton(wrapper).trigger('click')
    await wrapper.findAll('button').find((b) => b.text() === 'Cancel')!.trigger('click')
    expect(wrapper.emitted('closed')).toBeUndefined()
    refuse()
    await flushPromises()
    expect(wrapper.find('.alert').text()).toContain('not bound to a model element')
    expect(wrapper.emitted('closed')).toBeUndefined()
  })
})
