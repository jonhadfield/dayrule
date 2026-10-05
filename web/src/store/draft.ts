// A draft over the entity store that records every change, so a command's
// effect can be applied, undone and redone exactly (PLAN.md §7.1).

import type { Entities, Settings } from '../domain/types'

export type Collection = Exclude<keyof Entities, 'settings'>
export type EntityOf<C extends Collection> = Entities[C][string]

export type Change =
  | {
      kind: 'entity'
      collection: Collection
      id: string
      /** HLC stamp of this change (set by the store; tombstones use it). */
      hlc?: string
      /** Undefined when the entity was created. */
      before?: EntityOf<Collection>
      /** Undefined when the entity was deleted. */
      after?: EntityOf<Collection>
    }
  | { kind: 'settings'; before: Settings; after: Settings; hlc?: string }

export class Draft {
  private readonly touched = new Map<string, Change & { kind: 'entity' }>()
  private settingsChange: (Change & { kind: 'settings' }) | undefined

  private readonly base: Entities

  constructor(base: Entities) {
    this.base = base
  }

  get<C extends Collection>(
    collection: C,
    id: string,
  ): EntityOf<C> | undefined {
    const change = this.touched.get(`${collection}/${id}`)
    if (change) return change.after as EntityOf<C> | undefined
    return this.base[collection][id] as EntityOf<C> | undefined
  }

  /** All live entities of a collection, including this draft's edits. */
  all<C extends Collection>(collection: C): EntityOf<C>[] {
    const out = new Map<string, EntityOf<C>>()
    for (const [id, e] of Object.entries(this.base[collection])) {
      out.set(id, e as EntityOf<C>)
    }
    for (const c of this.touched.values()) {
      if (c.collection !== collection) continue
      if (c.after) out.set(c.id, c.after as EntityOf<C>)
      else out.delete(c.id)
    }
    return [...out.values()]
  }

  put<C extends Collection>(collection: C, entity: EntityOf<C>): void {
    this.record(collection, entity.id, entity)
  }

  remove(collection: Collection, id: string): void {
    this.record(collection, id, undefined)
  }

  get settings(): Settings {
    return this.settingsChange?.after ?? this.base.settings
  }

  set settings(next: Settings) {
    this.settingsChange = {
      kind: 'settings',
      before: this.settingsChange?.before ?? this.base.settings,
      after: next,
    }
  }

  /** Net changes, ignoring entities that ended up unchanged. */
  changes(): Change[] {
    const out: Change[] = [...this.touched.values()].filter(
      (c) => c.before !== c.after,
    )
    if (this.settingsChange) out.push(this.settingsChange)
    return out
  }

  private record(
    collection: Collection,
    id: string,
    after: EntityOf<Collection> | undefined,
  ): void {
    const key = `${collection}/${id}`
    const existing = this.touched.get(key)
    this.touched.set(key, {
      kind: 'entity',
      collection,
      id,
      before: existing ? existing.before : this.base[collection][id],
      after,
    })
  }
}

/** Apply changes forwards (do/redo) or backwards (undo), immutably. */
export function applyChanges(
  base: Entities,
  changes: readonly Change[],
  direction: 'forward' | 'backward',
): Entities {
  const next: Entities = { ...base }
  const copied = new Set<Collection>()
  const ordered = direction === 'forward' ? changes : [...changes].reverse()

  for (const c of ordered) {
    if (c.kind === 'settings') {
      next.settings = direction === 'forward' ? c.after : c.before
      continue
    }
    if (!copied.has(c.collection)) {
      ;(next as Record<Collection, unknown>)[c.collection] = {
        ...base[c.collection],
      }
      copied.add(c.collection)
    }
    const target = next[c.collection] as Record<string, unknown>
    const value = direction === 'forward' ? c.after : c.before
    if (value === undefined) delete target[c.id]
    else target[c.id] = value
  }
  return next
}
