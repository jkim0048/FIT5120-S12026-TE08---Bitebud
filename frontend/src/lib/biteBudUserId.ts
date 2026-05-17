const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

/** Cryptographically random 3-character uppercase alphanumeric id. */
export function generateBiteBudUserId(): string {
  const USER_ID_LENGTH = 3
  const randomValues = new Uint32Array(USER_ID_LENGTH)
  crypto.getRandomValues(randomValues)
  let userId = ''
  for (let charIndex = 0; charIndex < USER_ID_LENGTH; charIndex++) {
    userId += CHARSET[randomValues[charIndex]! % CHARSET.length]!
  }
  return userId
}
