import { createHash } from 'node:crypto'

/** The sha256 of a string (UTF-8) or bytes, as lower-case hex. */
export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')
