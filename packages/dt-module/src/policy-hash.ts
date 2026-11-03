/**
 * The `policyHash` a class reports: which policy source an evaluation of the class compiles.
 *
 * One computation, shared by everything that produces or checks the value — a file-backed module
 * reporting its classes, a publisher serving the hashes of a remote module's classes, and a
 * knowledge graph recording the policy its rules were derived from. Two copies would drift on a
 * detail such as trailing whitespace, and a hash that differs by a newline marks every element
 * evaluated under the unchanged policy as stale.
 *
 * Pure: `node:crypto` only, so a consumer that needs the hash takes no other dependency with it.
 */
import { createHash } from 'node:crypto';

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex');

/**
 * Names the computation below wherever its values travel without it — a served set of a module's hashes says which
 * computation produced them, so a reader can refuse a set it does not know how to compare.
 */
export const POLICY_HASH_ALGORITHM = 'policy-source-sha256/1';

/** `policyHash` of a class with no policy, or an empty one: the hash of the empty source. */
export const NO_POLICY_HASH = sha256Hex('');

/**
 * The Rego source a stored policy holds. Plain source is returned as given; a base64-encoded one is decoded when
 * what it decodes to is source; anything else (a policy opening with a comment, say) is returned as given too.
 */
export function decodePolicySource(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith('package ')) return value;
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf-8');
    if (decoded.trim().startsWith('package ')) return decoded;
  } catch { /* not base64 */ }
  return value;
}

/**
 * The `policyHash` of a `policies.rego` file's text: the sha256 hex of its decoded source, read with surrounding
 * whitespace trimmed. An empty file hashes to {@link NO_POLICY_HASH}.
 */
export function policySourceHash(fileText: string): string {
  return sha256Hex(decodePolicySource(fileText.trim()) ?? '');
}
