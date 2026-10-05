// IndexedDB storage for "stay unlocked on this device" (§10.4). The
// CryptoKey is non-extractable: it can be used here but never read out.
import Dexie, { type Table } from 'dexie'
import type { DeviceStore } from './keyring'

interface Row {
  userId: string
  key: CryptoKey
  iv: Uint8Array
  blob: Uint8Array
}

class DeviceDB extends Dexie {
  keys!: Table<Row, string>
  constructor() {
    super('dayrule-device')
    this.version(1).stores({ keys: 'userId' })
  }
}

export function indexedDbDeviceStore(): DeviceStore {
  const db = new DeviceDB()
  return {
    async get(userId) {
      const row = await db.keys.get(userId)
      return row ? { key: row.key, iv: row.iv, blob: row.blob } : undefined
    },
    async put(userId, value) {
      await db.keys.put({ userId, ...value })
    },
    async delete(userId) {
      await db.keys.delete(userId)
    },
  }
}
