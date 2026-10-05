// Reminders on the client (PLAN.md §10.5): the settings, this device's
// push subscription, and keeping the server's list of reminder times in
// step with the data. The server learns only times and opaque ids.

import { create } from 'zustand'
import { api } from '../account/api'
import { isTemplate, isTrashed } from '../domain/lists'
import type { Entities } from '../domain/types'
import type { EntityStore } from '../store/store'
import { saveTitles } from './titles'

export type Channel = 'off' | 'push' | 'email' | 'both'

interface Settings {
  loaded: boolean
  channel: Channel
  /** Empty when the server can't send push. */
  vapidPublicKey: string
}

export const useReminderSettings = create<Settings>(() => ({
  loaded: false,
  channel: 'off',
  vapidPublicKey: '',
}))

export async function loadReminderSettings(): Promise<void> {
  const s = await api<{ channel: Channel; vapidPublicKey: string }>(
    'GET',
    '/reminders/settings',
  )
  useReminderSettings.setState({ loaded: true, ...s })
}

export async function setChannel(channel: Channel): Promise<void> {
  await api('PUT', '/reminders/settings', { channel })
  useReminderSettings.setState({ channel })
}

// ---------------------------------------------------------------------------
// This device's push subscription

export const pushSupported = () =>
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window

const fromB64Url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
    c.charCodeAt(0),
  )

/** Ask to show notifications and subscribe this device. */
export async function subscribeThisDevice(): Promise<void> {
  const key = useReminderSettings.getState().vapidPublicKey
  if (!pushSupported() || !key)
    throw new Error('Notifications aren’t available in this browser.')
  if ((await Notification.requestPermission()) !== 'granted') {
    throw new Error(
      'Notifications are blocked for Dayrule in this browser’s settings.',
    )
  }
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromB64Url(key),
    }))
  const json = sub.toJSON()
  await api('POST', '/push/subscriptions', {
    endpoint: json.endpoint,
    keys: json.keys,
  })
}

export async function unsubscribeThisDevice(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await api('DELETE', '/push/subscriptions', { endpoint: sub.endpoint }).catch(
    () => undefined,
  )
  await sub.unsubscribe()
}

export async function thisDeviceSubscribed(): Promise<boolean> {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) != null
}

// ---------------------------------------------------------------------------
// Registering reminder times

/** Open, untrashed to-dos with a reminder still to come. */
export function upcoming(
  e: Entities,
  now: Date,
): { todoId: string; at: string; title: string }[] {
  const out: { todoId: string; at: string; title: string }[] = []
  for (const t of Object.values(e.todos)) {
    if (
      !t.reminderAt ||
      t.status !== 'open' ||
      isTemplate(t) ||
      isTrashed(e, t)
    )
      continue
    if (new Date(t.reminderAt) <= now) continue // local time, as written
    out.push({ todoId: t.id, at: t.reminderAt, title: t.title || 'Untitled' })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at)).slice(0, 2000)
}

/**
 * Keep the server's reminder list in step: on start, after changes and
 * every ten minutes. Each reminder's id is a keyed HMAC of the to-do and
 * time, so the server can't link it to anything.
 */
export function startReminders(o: {
  userId: string
  store: EntityStore
  syncIds: (keys: string[]) => Promise<string[]>
}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last = ''
  const run = async () => {
    if (!useReminderSettings.getState().loaded) {
      await loadReminderSettings().catch(() => undefined)
    }
    const list = upcoming(o.store.entities, new Date())
    const ids = await o.syncIds(list.map((r) => `reminder/${r.todoId}/${r.at}`))
    const reminders = list.map((r, i) => ({
      id: ids[i]!,
      fireAt: new Date(r.at).toISOString(),
      localTime: r.at.slice(11, 16),
    }))
    await saveTitles(
      o.userId,
      list.map((r, i) => ({ id: ids[i]!, todoId: r.todoId, title: r.title })),
    )
    // Off: the server sends nothing anyway, and needn't learn the times.
    if (useReminderSettings.getState().channel === 'off') return
    const body = JSON.stringify(reminders)
    if (body === last) return
    await api('PUT', '/reminders', { reminders })
    last = body
  }
  const schedule = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(() => void run().catch(() => undefined), ms)
  }
  schedule(0)
  const off = o.store.subscribeChanges(() => schedule(2000))
  const offSettings = useReminderSettings.subscribe((s, prev) => {
    if (s.channel !== prev.channel) {
      last = ''
      schedule(0)
    }
  })
  const interval = setInterval(() => schedule(0), 10 * 60 * 1000)
  return () => {
    clearTimeout(timer)
    clearInterval(interval)
    off()
    offSettings()
  }
}
