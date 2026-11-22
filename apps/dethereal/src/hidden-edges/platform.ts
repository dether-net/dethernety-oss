/**
 * The hidden-edges module's candidate query, called once per run: bounded in time and size. What comes back is
 * untrusted and checked by the caller (answer.ts).
 */
import { gql } from '@apollo/client'
import type { ApolloClient } from '@apollo/client'
import { graphQLErrorCode, isValidationFailure, LOGIN_SENTENCE } from '../triage/kg.js'

/** The module's own deadline is 25 s under the platform's 30 s, so 40 s covers a slow answer. */
export const READ_LIMITS = { timeoutMs: 40_000, answerChars: 1024 * 1024 } as const

export const HIDDEN_EDGE_CANDIDATES = gql`
  query HiddenEdgeCandidates($modelId: ID!, $options: String) { hiddenEdgeCandidates(modelId: $modelId, options: $options) }
`

/** The module's answer: its JSON string, or why there is none. */
export type ModuleCall = { status: 'answer'; raw: string } | { status: 'module_not_loaded' | 'module_failed' | 'session_refused'; detail: string }

/** Call the module's candidate query once. */
export async function callModule(client: ApolloClient, modelId: string, options: string, timeoutMs: number = READ_LIMITS.timeoutMs): Promise<ModuleCall> {
  let timer: NodeJS.Timeout | undefined
  let data: unknown
  try {
    const answer = client.query({ query: HIDDEN_EDGE_CANDIDATES, variables: { modelId, options }, fetchPolicy: 'no-cache' }) as Promise<{ data?: unknown }>
    const expired = new Promise<'expired'>((resolve) => {
      timer = setTimeout(() => resolve('expired'), timeoutMs)
    })
    const r = await Promise.race([answer, expired])
    if (r === 'expired') return { status: 'module_failed', detail: 'the module did not answer in time' }
    data = r.data
  } catch (err) {
    // A schema without the field refuses the document at validation: the module is not loaded.
    if (isValidationFailure(err)) return { status: 'module_not_loaded', detail: 'the platform has no hidden-edges module: it needs a platform release that carries it' }
    if (graphQLErrorCode(err) === 'UNAUTHENTICATED') return { status: 'session_refused', detail: LOGIN_SENTENCE }
    const code = graphQLErrorCode(err)
    return { status: 'module_failed', detail: `the candidate query failed${code ? ` (${code})` : ''}` }
  } finally {
    if (timer) clearTimeout(timer)
  }
  const raw = (data as { hiddenEdgeCandidates?: unknown } | undefined)?.hiddenEdgeCandidates
  if (typeof raw !== 'string') return { status: 'module_failed', detail: 'the module returned no answer' }
  if (raw.length > READ_LIMITS.answerChars) return { status: 'module_failed', detail: 'the answer is too large' }
  return { status: 'answer', raw }
}
