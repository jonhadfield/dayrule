// Reminder titles for notifications (PLAN.md §10.5). The server only ever
// sends an opaque id, so the service worker looks the title up here. Each
// title is encrypted with this device's "stay unlocked" key (a
// non-extractable AES-GCM key, §10.4), so titles exist only on devices
// that stay unlocked, and only as ciphertext at rest.
//
// Used by both the app and the service worker: IndexedDB and WebCrypto
// only, no libraries.

const DB = 'dayrule-reminder-titles'
const STORE = 'titles'
const AAD = 'dayrule/reminder-title/v1'

interface Row {
  id: string
  userId: string
  todoId: string
  iv: Uint8Array
  data: ArrayBuffer
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}

function openTitles(): Promise<IDBDatabase> {
  const r = indexedDB.open(DB, 1)
  r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' })
  return req(r)
}

/** The device key from "stay unlocked" (crypto/device-store.ts), if any. */
async function deviceKey(userId: string): Promise<CryptoKey | undefined> {
  let db: IDBDatabase
  try {
    db = await req(indexedDB.open('dayrule-device'))
  } catch {
    return undefined
  }
  try {
    if (!db.objectStoreNames.contains('keys')) return undefined
    const row = (await req(
      db.transaction('keys').objectStore('keys').get(userId),
    )) as { key: CryptoKey } | undefined
    return row?.key
  } finally {
    db.close()
  }
}

const aad = (id: string) => new TextEncoder().encode(`${AAD}|${id}`)

/** Replace the stored titles; stores none if the device doesn't stay unlocked. */
export async function saveTitles(
  userId: string,
  items: { id: string; todoId: string; title: string }[],
): Promise<void> {
  const key = await deviceKey(userId)
  const rows: Row[] = []
  if (key) {
    for (const it of items) {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const data = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad(it.id) },
        key,
        new TextEncoder().encode(it.title),
      )
      rows.push({ id: it.id, userId, todoId: it.todoId, iv, data })
    }
  }
  const db = await openTitles()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    store.clear()
    for (const r of rows) store.put(r)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

/** A reminder's title and to-do, if this device can read it. */
export async function readTitle(
  id: string,
): Promise<{ title: string; todoId: string } | undefined> {
  const db = await openTitles()
  let row: Row | undefined
  try {
    row = (await req(db.transaction(STORE).objectStore(STORE).get(id))) as
      Row | undefined
  } finally {
    db.close()
  }
  if (!row) return undefined
  const key = await deviceKey(row.userId)
  if (!key) return undefined
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: row.iv as BufferSource, additionalData: aad(id) },
      key,
      row.data,
    )
    return { title: new TextDecoder().decode(plain), todoId: row.todoId }
  } catch {
    return undefined
  }
}
