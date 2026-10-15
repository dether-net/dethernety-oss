// @vitest-environment happy-dom

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { reactive } from 'vue'

/**
 * The import dialog reads the chosen archive before it can offer a name to import it under. Until that read is done
 * there is no name, so Import must wait: clicking it early read the archive again and then refused with "Please give
 * the model a name", which says nothing about what was actually happening.
 */

let releaseModels: (models: Array<{ name: string }>) => void = () => {}
const getModels = vi.fn(() => new Promise<Array<{ name: string }>>((resolve) => { releaseModels = resolve }))
const importSplitModel = vi.fn()

vi.mock('@/plugins/apolloComposable', () => ({ useApolloClient: () => ({ client: {} }) }))
vi.mock('@dethernety/dt-core', () => ({
  DtImportSplit: class { importSplitModel = importSplitModel },
  DtModel: class { getModels = getModels },
}))
vi.mock('@/stores/folderStore', () => ({ useFolderStore: () => reactive({ selectedFolder: { id: 'f1' } }) }))
vi.mock('@/stores/modelsStore', () => ({ useModelsStore: () => reactive({ fetchModels: vi.fn() }) }))
vi.mock('@/utils/modelZipUtils', () => ({
  zipToSplitModel: () => ({ manifest: { model: { name: 'Payments' } } }),
}))

import ImportModelDialog from '../ImportModelDialog.vue'

// happy-dom's FileReader never finishes reading a File. This one finishes when the test says so.
let finishRead: () => void = () => {}
class HeldFileReader {
  result: ArrayBuffer | null = null
  error: Error | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  readAsArrayBuffer () {
    finishRead = () => {
      this.result = new ArrayBuffer(1)
      this.onload?.()
    }
  }
}
vi.stubGlobal('FileReader', HeldFileReader)

const importButton = (w: ReturnType<typeof mount>) => w.find('v-btn[aria-label="Import"]')

/** Choose a file through the hidden input, the way the Select File button does. */
const chooseFile = async (w: ReturnType<typeof mount>) => {
  const input = w.find('input[type=file]')
  Object.defineProperty(input.element, 'files', { value: [new File([new Uint8Array([1])], 'payments.zip')], configurable: true })
  await input.trigger('change')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Import waits for the chosen archive to be read', () => {
  it('is disabled while the archive is read, and enabled with the suggested name once it is', async () => {
    const w = mount(ImportModelDialog, { props: { show: true }, shallow: true, global: { stubs: { teleport: true } } })
    await chooseFile(w)

    // The file itself is still being read: no name yet.
    expect(importButton(w).attributes('disabled')).toBe('true')

    finishRead()
    await vi.waitFor(() => expect(getModels).toHaveBeenCalled())
    // The folder's models are still being listed: the name is still empty.
    expect(importButton(w).attributes('disabled')).toBe('true')

    releaseModels([{ name: 'Payments' }])
    await flushPromises()

    expect((w.vm as any).modelName).toBe('Payments (2)')
    expect((w.vm as any).nameHint).toContain('This folder already has a model named “Payments”')
    expect(importButton(w).attributes('disabled')).toBe('false')
  })

  it('says when the folder could not be checked for the same name, and is enabled again', async () => {
    getModels.mockRejectedValueOnce(new Error('down'))
    const w = mount(ImportModelDialog, { props: { show: true }, shallow: true, global: { stubs: { teleport: true } } })
    await chooseFile(w)
    finishRead()
    await vi.waitFor(() => expect(getModels).toHaveBeenCalled())
    await flushPromises()

    expect((w.vm as any).readingArchive).toBe(false)
    expect((w.vm as any).modelName).toBe('Payments')
    // The folder could not be checked, so the dialog says the name may already be in use.
    expect((w.vm as any).nameHint).toContain("Couldn't check this folder for a model of the same name")
    expect(w.find('v-text-field').attributes('hint')).toContain("Couldn't check this folder")
  })
})
