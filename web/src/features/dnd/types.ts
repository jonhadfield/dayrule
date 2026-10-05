// What drags carry and what drop targets accept.
import type { MoveTarget, Placement, When } from '../../store/commands'

/** What happens to to-dos dropped onto a target. */
export type DropAction =
  | { kind: 'move'; target: MoveTarget }
  | { kind: 'when'; when: When }
  | { kind: 'trash' }
  | { kind: 'complete' }

/** A displayed list of to-dos that can be reordered and dropped into. */
export interface Group {
  id: string
  /** Applied when to-dos arrive from another group (e.g. headings). */
  drop?: DropAction
  /** Where the Add button puts a new to-do dropped into this group. */
  place?: Placement
}

export type DragData =
  { type: 'todo'; id: string; group: Group } | { type: 'add' }

export type DropData =
  | { type: 'todo'; id: string; group: Group }
  | { type: 'group'; group: Group }
  | { type: 'sidebar'; action: DropAction; label: string }
