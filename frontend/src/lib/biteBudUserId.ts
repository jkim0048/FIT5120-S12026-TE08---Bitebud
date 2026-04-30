const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** Cryptographically random 3-character uppercase alphanumeric id. */
export function generateBiteBudUserId(): string {
  const buf = new Uint32Array(3)
  crypto.getRandomValues(buf)
  let out = ''
  for (let i = 0; i < 3; i++) {
    out += CHARSET[buf[i]! % CHARSET.length]!
  }
  return out
}
