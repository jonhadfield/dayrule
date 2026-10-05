import { api } from '../account/api'
import type { SyncTransport } from './engine'

/** The sync endpoints (PLAN.md §11.3). */
export const httpTransport: SyncTransport = {
  head: () => api('GET', '/sync/head'),
  pull: (since, full) =>
    api('GET', `/sync/pull?since=${since}${full ? '&full=1' : ''}`),
  push: (records) => api('POST', '/sync/push', { records }),
}
