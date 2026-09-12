import { generateMnemonic, validateMnemonic } from "bip39"
import bcrypt from "bcryptjs"

// Normalize a user-typed phrase: lowercase, collapse whitespace
export function normalizePhrase(phrase: string): string {
  return phrase.toLowerCase().trim().replace(/\s+/g, " ")
}

export function newRecoveryPhrase(): string {
  return generateMnemonic() // 12-word BIP39 phrase
}

export function isValidPhrase(phrase: string): boolean {
  const n = normalizePhrase(phrase)
  return n.split(" ").length === 12 && validateMnemonic(n)
}

export async function hashPhrase(phrase: string): Promise<string> {
  return bcrypt.hash(normalizePhrase(phrase), 10)
}

export async function verifyPhrase(phrase: string, hash: string): Promise<boolean> {
  return bcrypt.compare(normalizePhrase(phrase), hash)
}

// Update payload for storing a new phrase hash. First-time generation must
// NOT bump sessionVersion — there is no old phrase to revoke, and bumping it
// would sign the user out of the very session that generated it. Replacing an
// existing phrase invalidates all sessions as before.
export function recoveryPhraseUpdateData(hash: string, replacing: boolean) {
  return {
    recoveryPhraseHash: hash,
    ...(replacing ? { sessionVersion: { increment: 1 as const } } : {}),
  }
}
