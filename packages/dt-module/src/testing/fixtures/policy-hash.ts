/**
 * The policy hash golden: one `policies.rego` text and the `policyHash` it must produce.
 *
 * Every producer of a class's `policyHash` asserts this pair — the file-backed module, a publisher
 * serving a remote module's hashes, a knowledge-graph build — so a producer that drifts from the
 * shared helper fails in its own test rather than as a silent mismatch in a deployment. The text
 * ends in `}\n`, as committed policy files do, so a producer that hashes it untrimmed fails here.
 *
 * Exported names are `POLICY_HASH_*` prefixed: this file is re-exported with `export *`, where a
 * name collision resolves to nothing rather than to an error.
 */

/** A policy as a committed `policies.rego` holds it, trailing newline included. */
export const POLICY_HASH_GOLDEN_POLICY = [
  'package acme.compute.virtual_machine',
  '',
  '_def_unauthenticated_management := {',
  '\t"name": "Unauthenticated management interface",',
  '\t"description": "The instance accepts management traffic without authentication.",',
  '\t"type": "misconfiguration",',
  '\t"category": "access_control",',
  '\t"criticality": "high",',
  '\t"score": 8.1,',
  '\t"attack_vector": "NETWORK",',
  '}',
  '',
  'exposures contains _def_unauthenticated_management if {',
  '\tinput.authentication_enabled == false',
  '}',
  '',
].join('\n');

/** The `policyHash` of {@link POLICY_HASH_GOLDEN_POLICY}: sha256 hex of the text with surrounding whitespace trimmed. */
export const POLICY_HASH_GOLDEN_HEX = '6fd60f7ef3c641061cd6cb3fc36261610093f10418432c5e8690dd479f503bc8';
