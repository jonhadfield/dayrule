import type { ChangeSource } from '../store/store'
// Local persistence (PLAN.md §9). M1 stores plaintext; M3 replaces this
// with an implementation that stores only ciphertext, behind the same
// interface.

import type { Entities } from '../domain/types'
import type { Change } from '../store/draft'

export interface Persistence {
  /** Everything stored on this device. */
  load(): Promise<Entities>
  /**
   * Persist the changes from one command, atomically. Only `local` changes
   * are queued to be pushed by sync.
   */
  apply(
    changes: readonly Change[],
    meta?: { source: ChangeSource },
  ): Promise<void>
  close(): void
}
