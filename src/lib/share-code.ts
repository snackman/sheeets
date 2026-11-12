const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
export const SHARE_CODE_LENGTH = 16;

/**
 * Random itinerary share code from the Web Crypto CSPRNG (unbiased: bytes
 * >= 252 are rejected so every character is equally likely).
 */
export function generateShareCode(length = SHARE_CODE_LENGTH): string {
  const limit = 256 - (256 % ALPHABET.length);
  let code = '';
  while (code.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2));
    for (const b of bytes) {
      if (b < limit && code.length < length) code += ALPHABET[b % ALPHABET.length];
    }
  }
  return code;
}

/** Postgres unique_violation, as surfaced by PostgREST. */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505';
}
