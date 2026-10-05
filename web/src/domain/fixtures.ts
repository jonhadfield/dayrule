// Builders for domain tests.
import { keyAfterLast } from './order'
import {
  emptyEntities,
  type Area,
  type Entities,
  type Heading,
  type Project,
  type Tag,
  type Todo,
} from './types'

let n = 0
const nextId = (prefix: string) => `${prefix}-${String(++n).padStart(4, '0')}`
const ts = '2026-10-01T09:00:00.000Z'

export class World {
  e: Entities = emptyEntities()

  private orderIn(keys: string[]): string {
    return keyAfterLast(keys)
  }

  area(p: Partial<Area> = {}): Area {
    const a: Area = {
      type: 'area',
      id: nextId('area'),
      createdAt: ts,
      updatedAt: ts,
      title: 'Area',
      order: this.orderIn(Object.values(this.e.areas).map((x) => x.order)),
      tagIds: [],
      ...p,
    }
    this.e.areas[a.id] = a
    return a
  }

  project(p: Partial<Project> = {}): Project {
    const pr: Project = {
      type: 'project',
      id: nextId('proj'),
      createdAt: ts,
      updatedAt: ts,
      title: 'Project',
      notes: '',
      status: 'open',
      start: 'ready',
      tonight: false,
      tagIds: [],
      order: this.orderIn(Object.values(this.e.projects).map((x) => x.order)),
      ...p,
    }
    this.e.projects[pr.id] = pr
    return pr
  }

  heading(p: Partial<Heading> & { projectId: string }): Heading {
    const h: Heading = {
      type: 'heading',
      id: nextId('head'),
      createdAt: ts,
      updatedAt: ts,
      title: 'Heading',
      archived: false,
      order: this.orderIn(Object.values(this.e.headings).map((x) => x.order)),
      ...p,
    }
    this.e.headings[h.id] = h
    return h
  }

  todo(p: Partial<Todo> = {}): Todo {
    const t: Todo = {
      type: 'todo',
      id: nextId('todo'),
      createdAt: ts,
      updatedAt: ts,
      title: 'To-do',
      notes: '',
      status: 'open',
      start: 'inbox',
      tonight: false,
      tagIds: [],
      order: this.orderIn(Object.values(this.e.todos).map((x) => x.order)),
      ...p,
    }
    this.e.todos[t.id] = t
    return t
  }

  tag(p: Partial<Tag> = {}): Tag {
    const t: Tag = {
      type: 'tag',
      id: nextId('tag'),
      createdAt: ts,
      updatedAt: ts,
      title: 'Tag',
      order: this.orderIn(Object.values(this.e.tags).map((x) => x.order)),
      ...p,
    }
    this.e.tags[t.id] = t
    return t
  }
}
