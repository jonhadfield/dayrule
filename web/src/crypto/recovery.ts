// Recovery phrase (§10.2): 256 random bits shown as 24 English words.
import {
  entropyToMnemonic,
  mnemonicToEntropy,
  validateMnemonic,
} from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { hkdf, KEY_BYTES, LABELS, randomBytes } from './primitives'

export function newRecoveryEntropy(): Uint8Array {
  return randomBytes(KEY_BYTES)
}

export function toPhrase(entropy: Uint8Array): string[] {
  return entropyToMnemonic(entropy, wordlist).split(' ')
}

/** Accepts any spacing or case; throws on a typo (the checksum catches it). */
export function fromPhrase(words: string): Uint8Array {
  const phrase = words.trim().toLowerCase().split(/\s+/).join(' ')
  if (!validateMnemonic(phrase, wordlist))
    throw new Error('That recovery phrase isn’t right.')
  const entropy = mnemonicToEntropy(phrase, wordlist)
  if (entropy.length !== KEY_BYTES)
    throw new Error('A recovery phrase has 24 words.')
  return entropy
}

/** The key that wraps the account key for recovery. */
export function recoveryKey(entropy: Uint8Array): Promise<Uint8Array> {
  return hkdf(entropy, LABELS.recovery)
}
