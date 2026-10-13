/**
 * An optional numeric setting as a number: undefined when it is unset, empty or blank, so the default applies.
 * The environment validation and the services that read the setting share it: a blank value the validation leaves
 * unset reaches ConfigService.get as the raw string, and must read as unset there too, not as 0.
 */
export function optionalNumber(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'number') return raw;
  return String(raw).trim() === '' ? undefined : Number(raw);
}
