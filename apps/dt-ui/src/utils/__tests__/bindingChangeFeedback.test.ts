import { describe, it, expect } from 'vitest'
import type {
  ChangeElementBindingResult,
  ElementBindingDeltas,
  ElementBindingErrorCode,
} from '@dethernety/dt-core'
import {
  emitBindingChangeFeedback,
  formatDeltaCopy,
  FRIENDLY_ERROR_MESSAGES,
  isAllZeroDeltas,
} from '../bindingChangeFeedback'

const ZERO: ElementBindingDeltas = {
  deletedDerivedExposures: 0,
  instantiatedDerivedExposures: 0,
  preservedCustomExposures: 0,
  deletedDerivedCountermeasures: 0,
  instantiatedDerivedCountermeasures: 0,
  preservedCustomCountermeasures: 0,
}

function success(deltas: ElementBindingDeltas, kind: 'class' | 'model' | 'none' = 'class'): ChangeElementBindingResult {
  const targetBinding =
    kind === 'class'
      ? { __typename: 'ClassBinding' as const, classIds: ['cls-1'] }
      : kind === 'model'
        ? { __typename: 'RepresentedModelBinding' as const, modelId: 'mdl-1' }
        : { __typename: 'NoBinding' as const }
  return {
    success: true,
    elementId: 'elt-1',
    targetBinding,
    deltas,
    errorCode: null,
    errorMessage: null,
  }
}

function failure(code: ElementBindingErrorCode, message?: string | null): ChangeElementBindingResult {
  return {
    success: false,
    elementId: 'elt-1',
    targetBinding: { __typename: 'NoBinding' as const },
    deltas: ZERO,
    errorCode: code,
    errorMessage: message ?? null,
  }
}

describe('isAllZeroDeltas', () => {
  it('returns true when every count is 0', () => {
    expect(isAllZeroDeltas(ZERO)).toBe(true)
  })

  it('returns false when any count is non-zero', () => {
    expect(isAllZeroDeltas({ ...ZERO, preservedCustomExposures: 1 })).toBe(false)
    expect(isAllZeroDeltas({ ...ZERO, instantiatedDerivedCountermeasures: 3 })).toBe(false)
  })
})

describe('emitBindingChangeFeedback', () => {
  it('returns null when result is null (network failure / temp queue)', () => {
    expect(emitBindingChangeFeedback(null, { kind: 'exposures' })).toBeNull()
  })

  it('returns a neutral confirmation when the deltas are all zero (identity short-circuit, UX F5)', () => {
    expect(emitBindingChangeFeedback(success(ZERO), { kind: 'exposures' })).toEqual({
      show: true,
      color: 'success',
      kind: 'identity',
      message: 'No changes to apply.',
    })
  })

  const errorCodes: ElementBindingErrorCode[] = [
    'VALIDATION_ERROR',
    'ELEMENT_NOT_FOUND',
    'CLASS_NOT_FOUND',
    'MODEL_NOT_FOUND',
    'ORPHAN_CLASS_REFUSED',
    'REPRESENTED_MODEL_NOT_ALLOWED',
    'MODULE_ERROR',
    'DATABASE_ERROR',
  ]

  it.each(errorCodes)('returns error toast for errorCode %s with sanitised message', (code) => {
    const out = emitBindingChangeFeedback(failure(code, 'sanitised reason'), { kind: 'exposures' })
    expect(out).toEqual({ show: true, color: 'error', kind: 'error', message: 'sanitised reason' })
  })

  it('falls back to the friendly map when errorMessage is null', () => {
    const out = emitBindingChangeFeedback(failure('DATABASE_ERROR', null), { kind: 'exposures' })
    expect(out).toEqual({
      show: true,
      color: 'error',
      kind: 'error',
      message: FRIENDLY_ERROR_MESSAGES.DATABASE_ERROR,
    })
  })

  it.each(errorCodes)(
    'renders the friendly fallback for errorCode %s when errorMessage is null',
    (code) => {
      const out = emitBindingChangeFeedback(failure(code, null), { kind: 'exposures' })
      expect(out).toEqual({
        show: true,
        color: 'error',
        kind: 'error',
        message: FRIENDLY_ERROR_MESSAGES[code],
      })
      // Friendly messages must read as natural sentences: end with `.` and
      // avoid the literal error code in the rendered string.
      expect(FRIENDLY_ERROR_MESSAGES[code]).toMatch(/\.$/)
      expect(FRIENDLY_ERROR_MESSAGES[code]).not.toContain(code)
    },
  )

  it('sets kind="delta" on a non-identity success result', () => {
    const out = emitBindingChangeFeedback(
      success({ ...ZERO, deletedDerivedExposures: 1, instantiatedDerivedExposures: 1 }),
      { kind: 'exposures' },
    )
    expect(out?.kind).toBe('delta')
  })

  it('renders the class→class delta receipt for exposures (pluralisation)', () => {
    const deltas: ElementBindingDeltas = {
      ...ZERO,
      deletedDerivedExposures: 3,
      instantiatedDerivedExposures: 5,
      preservedCustomExposures: 2,
    }
    const out = emitBindingChangeFeedback(success(deltas), { kind: 'exposures' })
    expect(out).toEqual({
      show: true,
      color: 'success',
      kind: 'delta',
      message: 'Class changed. 3 auto-generated exposures replaced by 5 new. 2 exposures of yours kept.',
    })
  })

  it('singularises at N=1 (UX F2)', () => {
    const deltas: ElementBindingDeltas = {
      ...ZERO,
      deletedDerivedExposures: 1,
      instantiatedDerivedExposures: 2,
      preservedCustomExposures: 1,
    }
    const out = emitBindingChangeFeedback(success(deltas), { kind: 'exposures' })
    expect(out?.message).toBe(
      'Class changed. 1 auto-generated exposure replaced by 2 new. 1 exposure of yours kept.',
    )
  })

  it('renders the class→class delta receipt for countermeasures (Control)', () => {
    const deltas: ElementBindingDeltas = {
      ...ZERO,
      deletedDerivedCountermeasures: 1,
      instantiatedDerivedCountermeasures: 4,
      preservedCustomCountermeasures: 0,
    }
    const out = emitBindingChangeFeedback(success(deltas), { kind: 'countermeasures' })
    expect(out?.message).toBe(
      'Class changed. 1 auto-generated countermeasure replaced by 4 new. 0 countermeasures of yours kept.',
    )
  })

  it('renders the class→representedModel copy with model name', () => {
    const deltas: ElementBindingDeltas = {
      ...ZERO,
      deletedDerivedExposures: 7,
      preservedCustomExposures: 1,
    }
    const out = emitBindingChangeFeedback(success(deltas, 'model'), {
      kind: 'exposures',
      modelName: 'Payment Service',
      transition: 'class-to-model',
    })
    expect(out?.message).toBe(
      'Class removed; this element is now linked to the Payment Service model. 7 auto-generated exposures deleted; 1 exposure of yours kept.',
    )
  })

  it('renders the representedModel→none copy when no findings preserved', () => {
    const out = emitBindingChangeFeedback(success({ ...ZERO, deletedDerivedExposures: 1 }, 'none'), {
      kind: 'exposures',
      transition: 'model-removed',
    })
    expect(out?.message).toBe('Model link removed. This element no longer represents any model.')
  })

  it('renders the representedModel→none copy with preserved-count callout when non-zero (UX F4)', () => {
    const out = emitBindingChangeFeedback(
      success({ ...ZERO, deletedDerivedExposures: 1, preservedCustomExposures: 3 }, 'none'),
      { kind: 'exposures', transition: 'model-removed' },
    )
    expect(out?.message).toBe('Model link removed. 3 exposures of yours kept.')
  })
})

describe('formatDeltaCopy direct callers', () => {
  it('honours the countermeasures kind even when called directly', () => {
    expect(
      formatDeltaCopy(
        { ...ZERO, deletedDerivedCountermeasures: 2, instantiatedDerivedCountermeasures: 1 },
        { kind: 'countermeasures' },
      ),
    ).toContain('countermeasures')
  })
})
