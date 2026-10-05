import { Hlc } from '../domain/hlc'
import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import * as cmd from '../store/commands'
import { createEntityStore, type Clock } from '../store/store'
import { openIndexedDB } from './indexeddb'

let dbCount = 0
const freshName = () => `dayrule-test-${++dbCount}`

function clock(): Clock {
  let n = 0
  let t = new Date(2026, 9, 4, 9).getTime()
  return {
    now: () => new Date((t += 1000)),
    newId: () => `id-${++n}`,
    hlc: new Hlc('test', () => t),
  }
}

describe('IndexedDB persistence', () => {
  it('round-trips everything a store does, including undo and settings', async () => {
    const name = freshName()
    const db = openIndexedDB(name)
    const s = createEntityStore(undefined, clock())
    s.subscribeChanges((changes) => void db.apply(changes))

    const p = s.run('p', (d, env) => cmd.createProject(d, env, { title: 'P' }))
    s.run('t', (d, env) =>
      cmd.createTodo(d, env, {
        title: 'kept',
        placement: { list: 'project', projectId: p.id },
      }),
    )
    s.run('t', (d, env) =>
      cmd.createTodo(d, env, { title: 'undone', placement: { list: 'inbox' } }),
    )
    s.undo()
    s.run('mode', (d) => cmd.setDoneMode(d, 'daily'))

    await db.apply([]) // wait for queued writes
    db.close()

    const reopened = openIndexedDB(name)
    expect(await reopened.load()).toEqual(s.entities)
    reopened.close()
  })

  it('deletes rows removed by emptying the trash', async () => {
    const name = freshName()
    const db = openIndexedDB(name)
    const s = createEntityStore(undefined, clock())
    s.subscribeChanges((changes) => void db.apply(changes))

    const t = s.run('t', (d, env) =>
      cmd.createTodo(d, env, { placement: { list: 'inbox' } }),
    )
    s.run('trash', (d, env) => cmd.trashItems(d, env, [t.id]))
    s.run('empty', (d) => cmd.emptyTrash(d))

    await db.apply([]) // wait for queued writes
    expect((await db.load()).todos).toEqual({})
    db.close()
  })

  it('loads an empty store on first run', async () => {
    const db = openIndexedDB(freshName())
    const e = await db.load()
    expect(e.todos).toEqual({})
    expect(e.settings.moveToDone).toBe('immediately')
    db.close()
  })
})
