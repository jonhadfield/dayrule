import Dexie from 'dexie'
import { keyring } from '../crypto/client'
import { startSync } from '../sync/controller'
import { startReminders } from '../reminders/reminders'
import { httpTransport } from '../sync/transport'
import { openEncryptedDB, type RecordCipher } from '../persistence/encrypted'
import { openIndexedDB } from '../persistence/indexeddb'
import { createEntityStore, type EntityStore } from '../store/store'

/** Name of the pre-encryption (M1/M2) plaintext database. */
const PLAINTEXT_DB = 'dayrule-local'

const workerCipher: RecordCipher = {
  encrypt: (items) => keyring().encrypt(items),
  decrypt: (items) => keyring().decrypt(items),
}

/**
 * Load this account's data (decrypted in the worker), keep it persisted as
 * ciphertext and start syncing it. Data from before accounts existed is
 * imported once, then the plaintext copy is deleted.
 */
export async function bootstrap(
  userId: string,
): Promise<{ store: EntityStore; stop: () => void }> {
  // Ask the browser not to evict our data under storage pressure (§15).
  void navigator.storage?.persist?.()

  const db = openEncryptedDB(userId, workerCipher)
  if ((await db.isEmpty()) && (await Dexie.exists(PLAINTEXT_DB))) {
    const plain = openIndexedDB(PLAINTEXT_DB)
    const old = await plain.load()
    plain.close()
    await db.replaceAll(old)
    await Dexie.delete(PLAINTEXT_DB)
  }

  const store = createEntityStore()
  store.hydrate(await db.load())
  store.subscribeChanges((changes, meta) => {
    // Another tab has already saved what it relays.
    if (meta.source === 'tab') return
    db.apply(changes, meta).catch((err: unknown) => {
      console.error('failed to save changes', err)
    })
  })
  const stop = startSync({
    userId,
    store,
    db,
    crypto: {
      syncIds: (keys) => keyring().syncIds(keys),
      encrypt: (items) => keyring().encrypt(items),
      decrypt: (items) => keyring().decrypt(items),
    },
    net: httpTransport,
  })
  const stopReminders = startReminders({
    userId,
    store,
    syncIds: (keys) => keyring().syncIds(keys),
  })
  return {
    store,
    stop: () => {
      stop()
      stopReminders()
    },
  }
}
