/**
 * Which data classes suggest that a data item is a credential.
 *
 * This is a hint, never an answer: `validate_model_json` reports the items it matches as `credential_hints` and the
 * enrichment workflow proposes `is_credential: true` for the user to confirm. Nothing sets the field from here.
 *
 * Two rules, one place:
 *   - the credential data classes of the bundled general module, by id (stable across deployments) and by name;
 *   - a generic rule over any bound class name, so a credential class from any other module is recognised without
 *     being listed here.
 */

/** The general module's credential data classes. */
export const CREDENTIAL_DATA_CLASSES = [
  { id: 'a6406f69-a0ec-48c9-a9dd-27b3c03bbda8', name: 'User Credentials' },
  { id: '2bc04479-7e0c-43f2-88b5-9fe788860642', name: 'Authentication Tokens' },
] as const

/** Words in a data class name that mark credential material. */
export const CREDENTIAL_CLASS_NAME_PATTERN =
  /\b(credentials?|tokens?|secrets?|passwords?|passphrases?|private keys?|api keys?|certificates?|kubeconfig)\b/i

export type CredentialHintReason = 'class-id' | 'class-name'

/** Why a bound class suggests a credential, or undefined when it does not. */
export function credentialClassHint(classData?: { id?: string | null; name?: string | null } | null): CredentialHintReason | undefined {
  if (!classData) return undefined
  if (classData.id && CREDENTIAL_DATA_CLASSES.some(c => c.id === classData.id)) return 'class-id'
  if (classData.name && (CREDENTIAL_DATA_CLASSES.some(c => c.name === classData.name) || CREDENTIAL_CLASS_NAME_PATTERN.test(classData.name))) {
    return 'class-name'
  }
  return undefined
}
