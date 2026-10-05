// The signed-in account on this device. Holds what's needed to unlock
// offline; none of it can decrypt anything without the password.
import Dexie, { type Table } from 'dexie'
import type { WrappedB64 } from '../crypto/keyring'
import type { KdfParams } from '../crypto/primitives'

export interface Profile {
  key: 'current'
  userId: string
  email: string
  salt: string
  kdf: KdfParams
  wrappedPassword: WrappedB64
  /** "Stay unlocked on this device" (§10.4). */
  remember: boolean
  /** Passkey unlock on this device (§10.2): the AK wrapped under a PRF-derived key. */
  passkey?: { credentialId: string; salt: string; wrapped: WrappedB64 }
}

class ProfileDB extends Dexie {
  profile!: Table<Profile, string>
  constructor() {
    super('dayrule-profile')
    this.version(1).stores({ profile: 'key' })
  }
}

const db = new ProfileDB()

export const profiles = {
  get: () => db.profile.get('current'),
  save: (p: Omit<Profile, 'key'>) => db.profile.put({ key: 'current', ...p }),
  update: (patch: Partial<Omit<Profile, 'key'>>) =>
    db.profile.update('current', patch),
  clear: () => db.profile.delete('current'),
}
