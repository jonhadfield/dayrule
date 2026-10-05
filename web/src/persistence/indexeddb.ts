// Plaintext IndexedDB persistence for M1, via Dexie.

import Dexie, { type Table } from 'dexie'
import { emptyEntities, type Entities, type Settings } from '../domain/types'
import type { Collection } from '../store/draft'
import type { Persistence } from './persistence'

const COLLECTIONS = [
  'areas',
  'projects',
  'headings',
  'todos',
  'checklistItems',
  'tags',
] as const satisfies readonly Collection[]

interface Meta {
  key: 'settings'
  value: Settings
}

class StuffDB extends Dexie {
  areas!: Table<Entities['areas'][string], string>
  projects!: Table<Entities['projects'][string], string>
  headings!: Table<Entities['headings'][string], string>
  todos!: Table<Entities['todos'][string], string>
  checklistItems!: Table<Entities['checklistItems'][string], string>
  tags!: Table<Entities['tags'][string], string>
  meta!: Table<Meta, string>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      areas: 'id',
      projects: 'id',
      headings: 'id',
      todos: 'id',
      checklistItems: 'id',
      tags: 'id',
      meta: 'key',
    })
  }
}

export function openIndexedDB(name = 'dayrule-local'): Persistence {
  const db = new StuffDB(name)
  // Writes are chained so commands land in the order they ran.
  let queue: Promise<void> = Promise.resolve()

  return {
    async load() {
      const e = emptyEntities()
      await db.transaction('r', [...COLLECTIONS, 'meta'], async () => {
        for (const c of COLLECTIONS) {
          const rows = await db.table(c).toArray()
          const target = e[c] as Record<string, unknown>
          for (const row of rows as { id: string }[]) target[row.id] = row
        }
        const settings = await db.meta.get('settings')
        if (settings) e.settings = settings.value
      })
      return e
    },

    apply(changes) {
      const run = async () => {
        await db.transaction('rw', [...COLLECTIONS, 'meta'], async () => {
          for (const c of changes) {
            if (c.kind === 'settings') {
              await db.meta.put({ key: 'settings', value: c.after })
            } else if (c.after) {
              await db.table(c.collection).put(c.after)
            } else {
              await db.table(c.collection).delete(c.id)
            }
          }
        })
      }
      queue = queue.then(run, run)
      return queue
    },

    close() {
      db.close()
    },
  }
}
