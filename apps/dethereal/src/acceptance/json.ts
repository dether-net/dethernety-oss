/** A plain JSON object (not null, not an array). */
export const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)
