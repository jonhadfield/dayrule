/// <reference lib="webworker" />
// The service worker (PLAN.md §10.7, §10.5): offline app shell, the
// update flow, and reminder notifications. Bundled into one file by
// vite-plugin-pwa (injectManifest); no importScripts, which the CSP's
// Trusted Types would block.

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { readTitle } from '../src/reminders/titles'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: (string | { url: string; revision: string | null })[]
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//],
  }),
)

// The app's "Reload" button (src/app/pwa.ts).
self.addEventListener('message', (e) => {
  if ((e.data as { type?: string } | null)?.type === 'SKIP_WAITING')
    void self.skipWaiting()
})

// A reminder: the push carries only an opaque id and the time.
self.addEventListener('push', (e) => {
  const msg = (e.data?.json() ?? {}) as { id?: string; time?: string }
  e.waitUntil(
    (async () => {
      const found = msg.id
        ? await readTitle(msg.id).catch(() => undefined)
        : undefined
      await self.registration.showNotification(
        found?.title ?? 'You have a reminder',
        {
          body: found
            ? `Reminder · ${msg.time ?? ''}`.trim()
            : `Open Dayrule to see your ${msg.time ?? ''} reminder.`.replace(
                '  ',
                ' ',
              ),
          tag: msg.id ?? 'dayrule-reminder',
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          data: { todoId: found?.todoId },
        },
      )
    })(),
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      const open = windows[0]
      if (open) return void (await open.focus())
      await self.clients.openWindow('/today')
    })(),
  )
})
