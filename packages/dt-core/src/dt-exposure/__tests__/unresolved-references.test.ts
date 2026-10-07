/**
 * The read-only `unresolvedReferences` marker reaches clients: every document that
 * returns an Exposure or a Countermeasure node selects it.
 */
import { describe, it, expect } from 'vitest'

import { GET_EXPOSURES, GET_EXPOSURE, ADD_EXPOSURE, UPDATE_EXPOSURE } from '../dt-exposure-gql.js'
import {
  GET_COUNTERMEASURE,
  CREATE_COUNTERMEASURE,
  UPDATE_COUNTERMEASURE,
  GET_COUNTERMEASURES_FROM_CONTROL,
} from '../../dt-countermeasure/dt-countermeasure-gql.js'

describe('unresolvedReferences selection', () => {
  it.each(
    Object.entries({
      GET_EXPOSURES,
      GET_EXPOSURE,
      ADD_EXPOSURE,
      UPDATE_EXPOSURE,
      GET_COUNTERMEASURE,
      CREATE_COUNTERMEASURE,
      UPDATE_COUNTERMEASURE,
      GET_COUNTERMEASURES_FROM_CONTROL,
    }),
  )('%s selects it', (_name, doc) => {
    expect(doc.loc!.source.body).toMatch(/\bunresolvedReferences\b/)
  })
})
