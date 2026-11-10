/**
 * The synthetic fixture's key carries every optional fixture feature (the module, the planted instruction, the
 * shared credential, a canary in every secret file). Tests that read those features use this type.
 */
import type { ExpectedKey } from '../key.js'

export interface FullKey extends ExpectedKey {
  module: NonNullable<ExpectedKey['module']>
  injection: NonNullable<ExpectedKey['injection']>
  credentials: { aliases: ExpectedKey['credentials']['aliases']; shared: NonNullable<ExpectedKey['credentials']['shared']> }
  secret_files: Array<ExpectedKey['secret_files'][number] & { canary: string }>
}
