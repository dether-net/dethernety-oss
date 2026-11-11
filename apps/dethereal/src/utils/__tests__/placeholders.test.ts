/**
 * The value predicates the gates, lints and coverage share: what stands in for
 * an answer, what an encryption answer claims, and which twin fields disagree.
 * Honest negatives ("none", false, [], "not encrypted") are answers.
 */
import { describe, expect, it } from 'vitest'
import { isAuthFailureMode, isGateStandIn, isNotApplicable } from '../gates.js'
import { contradictions, encryptionClaim, hasMixedScriptWord, isPlaceholderToken } from '../lints.js'

const zeroWidth = String.fromCharCode(0x200b)
const fullWidthTbd = String.fromCharCode(0xff54, 0xff42, 0xff44)

describe('stand-ins as the gates judge them', () => {
  it.each([
    '?', '-', '—', 'N.A.', 'n.a.', 'N-A', 'TBC', 'tbd', 'TBD - ask ops', 'to be confirmed', 'Not specified', 'not documented',
    'unknown yet', 'Unknown (not documented)', 'pending', 'idk', zeroWidth, fullWidthTbd, '   ',
  ])('reads %j as a stand-in', (v) => {
    expect(isGateStandIn(v, 'encryption_in_transit')).toBe(true)
  })

  it.each([[['TBC']], [['unsure']], [[null]], [[42]], [['None']], [['n/a']], [['no monitoring']], [['vault-token', '']]])(
    'reads the list %j as a stand-in', (v) => {
      expect(isGateStandIn(v, 'required_credentials')).toBe(true)
    })

  it.each(['none', 'None', 'not encrypted', 'plaintext', 'TLS 1.3', 'na-east-1', 'Not enforced'])('reads %j as an answer', (v) => {
    expect(isGateStandIn(v, 'encryption_in_transit')).toBe(false)
  })

  it('keeps honest false, [] and real ids, including one that starts with "no-"', () => {
    expect(isGateStandIn(false, 'implicit_deny_enabled')).toBe(false)
    expect(isGateStandIn([], 'monitoring_tools')).toBe(false)
    expect(isGateStandIn(['no-reply-smtp', 'db-app-cred'], 'required_credentials')).toBe(false)
    expect(isPlaceholderToken('no-reply-smtp')).toBe(false)
  })

  it('takes a value the field\'s own schema lists as an answer, but never the stand-ins', () => {
    expect(isGateStandIn('PENDING', 'policy_compliance_status', { type: 'string', enum: ['PENDING', 'COMPLIANT'] })).toBe(false)
    expect(isGateStandIn('PENDING', 'policy_compliance_status', { type: 'string' })).toBe(true)
    expect(isGateStandIn(['pending'], 'states', { type: 'array', items: { enum: ['pending'] } })).toBe(false)
    expect(isGateStandIn('unknown', 'status', { type: 'string', enum: ['unknown', 'ok'] })).toBe(true)
  })

  it('leaves not-applicable to the store rule on encryption_at_rest, and reads it as a stand-in elsewhere', () => {
    expect(isGateStandIn('n/a', 'encryption_at_rest')).toBe(false)
    expect(isGateStandIn('n/a', 'authentication_type')).toBe(true)
    for (const v of ['n/a', 'N.A.', 'not applicable', 'n/a (process)']) expect(isNotApplicable(v)).toBe(true)
    for (const v of ['na-east-1', 'nas', 'name']) expect(isNotApplicable(v)).toBe(false)
  })

  it('accepts only the failure modes the protocol names', () => {
    for (const v of ['deny', 'Fallback', 'fail_open', 'FAIL-OPEN', 'fail open']) expect(isAuthFailureMode(v)).toBe(true)
    for (const v of ['unknown', 'maybe', 'deny?', 'n/a', '', null]) expect(isAuthFailureMode(v)).toBe(v === 'deny?')
  })
})

describe('encryption claims', () => {
  it.each([
    ['TLS 1.3', 'transit', 'affirms'], ['HTTPS', 'transit', 'affirms'], ['enabled', 'transit', 'affirms'], ['AES-256', 'rest', 'affirms'],
    ['not encrypted', 'transit', 'negates'], ['plaintext', 'transit', 'negates'], ['none', 'rest', 'negates'], ['TLS 1.0', 'transit', 'negates'],
    ['DES', 'rest', 'negates'], ['TBD', 'transit', 'indeterminate'], ['not_applicable', 'rest', 'indeterminate'],
    ['no TLS', 'transit', 'indeterminate'], ['TLS at the edge, plaintext behind it', 'transit', 'affirms'],
  ] as const)('%j (%s) %s', (v, kind, claim) => {
    expect(encryptionClaim(v, kind)).toBe(claim)
  })
})

describe('twin fields that disagree', () => {
  it('flags only a clear contradiction', () => {
    expect(contradictions({ encrypted_at_rest: false, encryption_at_rest: 'AES-256' })).toEqual(['encrypted_at_rest/encryption_at_rest'])
    expect(contradictions({ encrypted_at_rest: true, encryption_at_rest: 'none' })).toEqual(['encrypted_at_rest/encryption_at_rest'])
    expect(contradictions({ tls_only_transport: true, encryption_in_transit: 'plaintext' })).toEqual(['tls_only_transport/encryption_in_transit'])
    expect(contradictions({ authentication_required: true, authentication_type: 'none' })).toEqual(['authentication_required/authentication_type'])
  })

  it('stays quiet on consistent or narrower pairs', () => {
    expect(contradictions({ encrypted_at_rest: false, encryption_at_rest: 'none' })).toEqual([])
    expect(contradictions({ encrypted_at_rest: false, encryption_at_rest: 'not_applicable' })).toEqual([])
    expect(contradictions({ encrypted_at_rest: false, encryption_at_rest: 'TBD' })).toEqual([])
    expect(contradictions({ flow_tls_encrypted: false, encryption_in_transit: 'disabled' })).toEqual([])
    // Mutual TLS or TLS-only not enforced, while TLS is offered.
    expect(contradictions({ service_to_service_mtls_enforced: false, encryption_in_transit: 'TLS 1.2' })).toEqual([])
    expect(contradictions({ tls_only_transport: false, encryption_in_transit: 'TLS 1.3' })).toEqual([])
    expect(contradictions({ authentication_required: false, authentication_type: 'oauth_token' })).toEqual([])
  })
})

describe('spellings that hide a placeholder', () => {
  const cp = (...codes: number[]) => String.fromCodePoint(...codes)
  const CGJ = cp(0x034f)
  const VS1 = cp(0xfe00)
  const HANGUL_FILLER = cp(0x3164)
  const BRAILLE_BLANK = cp(0x2800)
  const TAG_T = cp(0xe0074)
  const cyrillicO = cp(0x043e)

  it.each([
    ['CGJ inside TBD', `T${CGJ}BD`],
    ['a variation selector inside unknown', `unk${VS1}nown`],
    ['a Hangul filler inside TBD', `TB${HANGUL_FILLER}D`],
    ['a braille blank inside TBC', `TB${BRAILLE_BLANK}C`],
    ['an astral tag character inside TBD', `TB${TAG_T}D`],
    ['a Cyrillic o in unknown', `unkn${cyrillicO}wn`],
    ['an all-Cyrillic TBA', cp(0x0422, 0x0412, 0x0410)],
    ['small capitals', cp(0x1d1c, 0x0274, 0x1d0b, 0x0274, 0x1d0f, 0x1d21, 0x0274)],
    ['a spaced n / a', 'n / a'],
    ['n_a', 'n_a'],
    ['n, an em dash, a', `n${cp(0x2014)}a`],
  ])('reads %s as a stand-in', (_, v) => {
    expect(isGateStandIn(v, 'authentication_type')).toBe(true)
  })

  it('reads a Greek-lettered NONE as none: an answer on its own, a placeholder in a list', () => {
    const greekNone = cp(0x039d, 0x039f, 0x039d, 0x0395)
    expect(isGateStandIn(greekNone, 'authentication_type')).toBe(false)
    expect(isGateStandIn([greekNone], 'monitoring_tools')).toBe(true)
    expect(encryptionClaim(greekNone)).toBe('negates')
  })

  it('keeps honest values in other scripts, and units, as answers', () => {
    const russian = `PostgreSQL ${cp(0x043d, 0x0430)} ${cp(0x0432, 0x044b, 0x0434, 0x0435, 0x043b, 0x0435, 0x043d, 0x043d, 0x043e, 0x043c)} ${cp(0x0441, 0x0435, 0x0440, 0x0432, 0x0435, 0x0440, 0x0435)}`
    const greekCompany = `${cp(0x0391, 0x03b8, 0x03b7, 0x03bd, 0x03ac)} Cloud`
    for (const v of [`50${cp(0x00b5)}s`, russian, greekCompany, 'none', 'TLS 1.3']) expect(isGateStandIn(v, 'authentication_type')).toBe(false)
  })

  it('flags a word that mixes scripts, and not a sentence that only uses two', () => {
    expect(hasMixedScriptWord(`unkn${cyrillicO}wn`)).toBe(true)
    expect(hasMixedScriptWord([`Data${cp(0x0434)}og`])).toBe(true)
    expect(hasMixedScriptWord(`PostgreSQL ${cp(0x043d, 0x0430)} ${cp(0x0441, 0x0435, 0x0440, 0x0432, 0x0435, 0x0440, 0x0435)}`)).toBe(false)
    expect(hasMixedScriptWord(`50${cp(0x00b5)}s`)).toBe(false)
  })
})
