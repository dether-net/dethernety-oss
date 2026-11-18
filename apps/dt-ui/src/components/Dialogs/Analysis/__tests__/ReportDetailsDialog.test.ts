// @vitest-environment happy-dom
/**
 * The Report details dialog: it loads the analysis's details, offers another analysis's details as a suggestion it
 * never applies on its own, saves only what changed with the analysis id it was opened for, mirrors the server's rules
 * for custom fields and the total size, shows the server's refusal, counts characters as the server does, and cannot
 * save twice at once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { saveErrorMessage } from '@/utils/reportDetailsInput'

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
    props: ['modelValue', 'counterValue', 'disabled', 'errorMessages'],
    emits: ['update:modelValue', 'update:focused'],
    template:
      '<div><input class="field" :value="modelValue" :disabled="disabled" ' +
      '@input="$emit(\'update:modelValue\', $event.target.value)" @blur="$emit(\'update:focused\', false)" />' +
      '<span class="count">{{ counterValue ? counterValue(modelValue) : "" }}</span>' +
      '<span class="error">{{ errorMessages ?? "" }}</span></div>',
  },
}

const SHIELD = String.fromCodePoint(0x1f6e1)

type Wrapper = ReturnType<typeof mount>

const open = async (analysisId = 'an-1') => {
  const wrapper = mount(ReportDetailsDialog, { props: { analysisId }, global: { stubs } })
  await flushPromises()
  return wrapper
}
const button = (wrapper: Wrapper, text: string) => wrapper.findAll('button').find((b) => b.text() === text)
const saveButton = (wrapper: Wrapper) => button(wrapper, 'Save')!
const addButton = (wrapper: Wrapper) => wrapper.find('.report-details-add')
const input = (wrapper: Wrapper, cls: string) => wrapper.find(`.report-details-${cls} input`)
const valueOf = (wrapper: Wrapper, cls: string) => (input(wrapper, cls).element as HTMLInputElement).value
const type = async (wrapper: Wrapper, cls: string, value: string) => {
  await input(wrapper, cls).setValue(value)
}
const rows = (wrapper: Wrapper) => wrapper.findAll('.report-details-row')
const typeRow = async (wrapper: Wrapper, index: number, label: string, value: string) => {
  const row = rows(wrapper)[index]
  await row.find('.report-details-label input').setValue(label)
  await row.find('.report-details-value input').setValue(value)
}
const addRow = async (wrapper: Wrapper, label: string, value: string) => {
  await addButton(wrapper).trigger('click')
  await typeRow(wrapper, rows(wrapper).length - 1, label, value)
}
const leaveRow = async (wrapper: Wrapper, index: number) => {
  await rows(wrapper)[index].find('.report-details-label input').trigger('blur')
}
const saveAndSettle = async (wrapper: Wrapper) => {
  await saveButton(wrapper).trigger('click')
  await flushPromises()
}

enableAutoUnmount(afterEach)

describe('ReportDetailsDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.getReportDetails.mockResolvedValue({ client: 'Example Ltd' })
    api.suggestReportDetails.mockResolvedValue(null)
    api.setReportDetails.mockResolvedValue({})
  })

  it('loads the details of the analysis it was opened for', async () => {
    api.getReportDetails.mockResolvedValue({
      client: 'Example Ltd',
      author: 'A. Analyst',
      project: 'P',
      customFields: [{ label: 'Ref', value: 'ES-114' }],
    })
    const wrapper = await open('an-7')
    expect(api.getReportDetails).toHaveBeenCalledWith('an-7')
    expect(valueOf(wrapper, 'client')).toBe('Example Ltd')
    expect(valueOf(wrapper, 'author')).toBe('A. Analyst')
    expect(valueOf(wrapper, 'project')).toBe('P')
    expect(rows(wrapper)).toHaveLength(1)
    expect((rows(wrapper)[0].find('.report-details-label input').element as HTMLInputElement).value).toBe('Ref')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
  })

  describe('the suggestion', () => {
    it('is offered on an empty form, summarised, and fills every field only when chosen', async () => {
      api.getReportDetails.mockResolvedValue({})
      api.suggestReportDetails.mockResolvedValue({
        client: 'Earlier Client',
        author: 'A. Analyst',
        customFields: [
          { label: 'Ref', value: 'ES-114' },
          { label: 'Class', value: 'Confidential' },
        ],
      })
      const wrapper = await open()
      expect(wrapper.find('.report-details-suggestion-summary').text()).toBe('Earlier Client · author · 2 custom fields')
      expect(api.setReportDetails).not.toHaveBeenCalled()
      await button(wrapper, 'Use these details')!.trigger('click')
      expect(valueOf(wrapper, 'client')).toBe('Earlier Client')
      expect(valueOf(wrapper, 'author')).toBe('A. Analyst')
      expect(valueOf(wrapper, 'project')).toBe('')
      expect(rows(wrapper)).toHaveLength(2)
      expect(wrapper.find('.report-details-suggestion').exists()).toBe(false)
      expect(api.setReportDetails).not.toHaveBeenCalled()
    })

    it('is summarised without a client when the other analysis has none', async () => {
      api.getReportDetails.mockResolvedValue({})
      api.suggestReportDetails.mockResolvedValue({ project: 'P', customFields: [{ label: 'Ref', value: 'x' }] })
      const wrapper = await open()
      expect(wrapper.find('.report-details-suggestion-summary').text()).toBe('project · 1 custom field')
    })

    it('is not offered once anything is filled, a custom field included', async () => {
      api.suggestReportDetails.mockResolvedValue({ client: 'Earlier Client' })
      const withClient = await open()
      expect(withClient.find('.report-details-suggestion').exists()).toBe(false)

      api.getReportDetails.mockResolvedValue({})
      const blank = await open()
      expect(blank.find('.report-details-suggestion').exists()).toBe(true)
      await addRow(blank, 'Ref', 'x')
      expect(blank.find('.report-details-suggestion').exists()).toBe(false)
    })

    it('is not offered when the other analysis holds nothing but its timestamp', async () => {
      api.getReportDetails.mockResolvedValue({})
      api.suggestReportDetails.mockResolvedValue({ updated: '2026-01-01T00:00:00.000Z' })
      const wrapper = await open()
      expect(wrapper.find('.report-details-suggestion').exists()).toBe(false)
    })
  })

  describe('saving', () => {
    it('saves only the changed key, trimmed, with the analysis id it was opened for, then closes', async () => {
      const wrapper = await open('an-1')
      await wrapper.setProps({ analysisId: 'an-2' })
      await type(wrapper, 'author', '  A. Analyst  ')
      await saveAndSettle(wrapper)
      expect(api.setReportDetails).toHaveBeenCalledWith('an-1', { author: 'A. Analyst' })
      expect(wrapper.emitted('saved')).toHaveLength(1)
      expect(wrapper.emitted('closed')).toHaveLength(1)
    })

    it('sends null for a field emptied', async () => {
      const wrapper = await open()
      await type(wrapper, 'client', '   ')
      await saveAndSettle(wrapper)
      expect(api.setReportDetails).toHaveBeenCalledWith('an-1', { client: null })
    })

    it('sends a changed list whole, dropping fully empty rows, and null once it is empty', async () => {
      api.getReportDetails.mockResolvedValue({ customFields: [{ label: 'Ref', value: 'ES-114' }] })
      const wrapper = await open()
      await addRow(wrapper, ' Class ', ' Confidential ')
      await addButton(wrapper).trigger('click')
      await saveAndSettle(wrapper)
      expect(api.setReportDetails).toHaveBeenCalledWith('an-1', {
        customFields: [
          { label: 'Ref', value: 'ES-114' },
          { label: 'Class', value: 'Confidential' },
        ],
      })

      api.setReportDetails.mockClear()
      const again = await open()
      await again.find('.report-details-remove').trigger('click')
      await saveAndSettle(again)
      expect(api.setReportDetails).toHaveBeenCalledWith('an-1', { customFields: null })
    })

    it('counts a row left empty, or holding only spaces, as no change', async () => {
      const wrapper = await open()
      await addRow(wrapper, '  ', ' ')
      await leaveRow(wrapper, 0)
      expect(rows(wrapper)[0].findAll('.error').map((e) => e.text())).toEqual(['', ''])
      expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it('saves on Enter in a named field', async () => {
      const wrapper = await open()
      await type(wrapper, 'project', 'P')
      await input(wrapper, 'project').trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(api.setReportDetails).toHaveBeenCalledWith('an-1', { project: 'P' })
    })

    it('shows the server\'s refusal by its code, and stays open', async () => {
      api.setReportDetails.mockRejectedValue({ errors: [{ extensions: { code: 'REPORT_DETAILS_FIELD_CHARACTERS' } }] })
      const wrapper = await open()
      await addRow(wrapper, 'Ref', 'Bad')
      await saveAndSettle(wrapper)
      expect(wrapper.find('.alert').text()).toContain('A custom field contains a character a report cannot print')
      expect(wrapper.emitted('closed')).toBeUndefined()
    })

    it.each([
      ['REPORT_DETAILS_AUTHOR_TOO_LONG', 'The author is longer than 120 characters.'],
      ['REPORT_DETAILS_PROJECT_CHARACTERS', 'The project contains a character'],
      ['REPORT_DETAILS_FIELD_INCOMPLETE', 'Every custom field needs a value and a label'],
      ['REPORT_DETAILS_FIELD_DUPLICATE', 'Two custom fields have the same label.'],
      ['REPORT_DETAILS_TOO_MANY_FIELDS', 'At most 10 custom fields.'],
      ['REPORT_DETAILS_FIELD_TOO_LONG', 'longer than 40 characters'],
    ])('names the refusal %s', (code, text) => {
      expect(saveErrorMessage({ errors: [{ extensions: { code } }] })).toContain(text)
    })

    it('cannot save twice at once, from the button or from Enter in a field', async () => {
      let finish!: () => void
      api.setReportDetails.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ client: 'X' }) }))
      const wrapper = await open()
      await type(wrapper, 'client', 'X')
      await saveButton(wrapper).trigger('click')
      expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
      // Enter reaches save() whatever the button's state: the guard in save() is what stops it.
      await input(wrapper, 'client').trigger('keydown', { key: 'Enter' })
      finish()
      await flushPromises()
      expect(api.setReportDetails).toHaveBeenCalledTimes(1)
    })
  })

  describe('custom fields', () => {
    it('adds and removes rows, at most 10', async () => {
      api.getReportDetails.mockResolvedValue({})
      const wrapper = await open()
      for (let i = 0; i < 10; i++) await addRow(wrapper, `F${i}`, 'v')
      expect(rows(wrapper)).toHaveLength(10)
      expect(addButton(wrapper).attributes('disabled')).toBeDefined()
      await addButton(wrapper).trigger('click')
      expect(rows(wrapper)).toHaveLength(10)
      await rows(wrapper)[0].find('.report-details-remove').trigger('click')
      expect(rows(wrapper)).toHaveLength(9)
      expect(addButton(wrapper).attributes('disabled')).toBeUndefined()
      expect(rows(wrapper)[0].find('.report-details-remove').attributes('aria-label')).toBe('Remove field 1')
    })

    it.each([
      ['a label without a value', 'Ref', '', 'Add a value'],
      ['a value without a label', '', 'x', 'Add a label'],
      ['a label of a Hangul filler only', '\u3164', 'x', 'A label needs a letter or digit.'],
      ['a label of a blank braille cell only', '\u2800', 'x', 'A label needs a letter or digit.'],
      ['a label of a soft hyphen only', String.fromCodePoint(0xad), 'x', 'A label needs a letter or digit.'],
      ['a label of a halfwidth Hangul filler only', String.fromCodePoint(0xffa0), 'x', 'A label needs a letter or digit.'],
    ])('refuses %s inline once the row is left, and before saving', async (_name, label, value, message) => {
      api.getReportDetails.mockResolvedValue({})
      const wrapper = await open()
      await addRow(wrapper, label, value)
      expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
      expect(rows(wrapper)[0].text()).not.toContain(message)
      await leaveRow(wrapper, 0)
      expect(rows(wrapper)[0].text()).toContain(message)
      expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it.each([
      ['in case', 'Ref', 'REF'],
      ['by a soft hyphen', 'Engagement', 'Engage\u00adment'],
      ['in composition', 'Café', 'Cafe\u0301'],
      ['by the kind of space', 'Client ref', 'Client\u00a0ref'],
    ])('refuses two labels that differ only %s, on the later row', async (_name, a, b) => {
      api.getReportDetails.mockResolvedValue({})
      const wrapper = await open()
      await addRow(wrapper, a, '1')
      await addRow(wrapper, b, '2')
      await leaveRow(wrapper, 0)
      await leaveRow(wrapper, 1)
      expect(rows(wrapper)[0].text()).not.toContain('Another field has this label.')
      expect(rows(wrapper)[1].text()).toContain('Another field has this label.')
      expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it('counts a label and a value in code points: 40 and 120 pass, one more does not', async () => {
      api.getReportDetails.mockResolvedValue({})
      const wrapper = await open()
      await addRow(wrapper, `A${SHIELD.repeat(39)}`, SHIELD.repeat(120))
      expect(rows(wrapper)[0].findAll('.count').map((c) => c.text())).toEqual(['40', '120'])
      expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
      await typeRow(wrapper, 0, `A${SHIELD.repeat(40)}`, SHIELD.repeat(120))
      expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
      await typeRow(wrapper, 0, `A${SHIELD.repeat(39)}`, SHIELD.repeat(121))
      expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
    })

    it('refuses details over the server\'s total size before saving, though every field is within its limit', async () => {
      api.getReportDetails.mockResolvedValue({})
      const wrapper = await open()
      await type(wrapper, 'client', 'é'.repeat(120))
      await type(wrapper, 'author', 'é'.repeat(120))
      await type(wrapper, 'project', 'é'.repeat(120))
      for (let i = 0; i < 10; i++) await addRow(wrapper, `${i}`.padEnd(40, 'é'), 'é'.repeat(120))
      expect(wrapper.find('.report-details-total').exists()).toBe(true)
      expect(saveButton(wrapper).attributes('disabled')).toBeDefined()

      await type(wrapper, 'project', '')
      await rows(wrapper)[9].find('.report-details-remove').trigger('click')
      expect(wrapper.find('.report-details-total').exists()).toBe(false)
      expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
    })
  })

  it('counts characters as the server does: 120 pass, 121 do not, and an emoji counts once', async () => {
    const wrapper = await open()
    await type(wrapper, 'client', SHIELD.repeat(120))
    expect(wrapper.find('.report-details-client .count').text()).toBe('120')
    expect(saveButton(wrapper).attributes('disabled')).toBeUndefined()
    await type(wrapper, 'client', SHIELD.repeat(121))
    expect(wrapper.find('.report-details-client .count').text()).toBe('121')
    expect(saveButton(wrapper).attributes('disabled')).toBeDefined()
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
    await type(wrapper, 'client', 'X')
    await saveButton(wrapper).trigger('click')
    await button(wrapper, 'Cancel')!.trigger('click')
    expect(wrapper.emitted('closed')).toBeUndefined()
    refuse()
    await flushPromises()
    expect(wrapper.find('.alert').text()).toContain('not bound to a model element')
    expect(wrapper.emitted('closed')).toBeUndefined()
  })
})
