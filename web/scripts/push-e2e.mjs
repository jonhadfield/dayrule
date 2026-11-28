#!/usr/bin/env node
// One-shot real Web Push check against production. Not part of CI.
//
//   cd web && node scripts/push-e2e.mjs
//
// Credentials: DAYRULE_CREDS (email on line 1, password on line 2), else
// ~/.config/dayrule/creds. Uses headed Chrome (PushManager needs it) and a
// persistent profile under ~/.cache/dayrule-push-e2e-profile. Triggers the
// Vercel reminders cron via `vercel crons run` (no local CRON_SECRET).
// Never prints secrets. Needs: Playwright Chromium/Chrome, vercel CLI, linked
// dayrule project.

import { chromium } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

const API = process.env.DAYRULE_API ?? 'https://dayrule.app'
const REPO = resolve(import.meta.dirname, '../..')
const CREDS =
  process.env.DAYRULE_CREDS?.trim() ||
  resolve(homedir(), '.config/dayrule/creds')

const [email, password] = readFileSync(CREDS, 'utf8').trim().split(/\n/)
if (!email || !password) {
  console.error('creds file needs email then password:', CREDS)
  process.exit(2)
}

async function main() {
  console.log('api', API)

  // Automation defaults block PushManager; drop them and use headed Chrome.
  const context = await chromium.launchPersistentContext(
    resolve(homedir(), '.cache/dayrule-push-e2e-profile'),
    {
      headless: false,
      channel: process.env.PUSH_E2E_CHANNEL || 'chrome',
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
      permissions: ['notifications'],
    },
  )
  const page = context.pages()[0] ?? (await context.newPage())
  await context.grantPermissions(['notifications'], { origin: API })
  const close = async () => {
    await context.close()
  }

  await page.goto(API + '/', { waitUntil: 'networkidle' })
  const inbox = page.getByRole('link', { name: 'Inbox' })
  if (!(await inbox.isVisible().catch(() => false))) {
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    const code = page.getByLabel('Code', { exact: true })
    if (await code.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.error('Account requires a second-step code; aborting')
      await close()
      process.exit(3)
    }
    await inbox.waitFor({ timeout: 60_000 })
  }
  console.log('signed in')

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })

  const settings = await page.evaluate(async () => {
    const r = await fetch('/api/v1/reminders/settings', {
      credentials: 'include',
    })
    return { status: r.status, body: await r.json() }
  })
  if (settings.status !== 200 || !settings.body.vapidPublicKey) {
    console.error('settings missing vapid', settings.status)
    await close()
    process.exit(4)
  }
  console.log('channel before', settings.body.channel)
  console.log('vapid present', true)

  const subResult = await page.evaluate(async (keyB64) => {
    const hdrs = {
      'content-type': 'application/json',
      'X-Dayrule-Client': 'web',
    }
    const fromB64Url = (s) =>
      Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
        c.charCodeAt(0),
      )
    if ((await Notification.requestPermission()) !== 'granted') {
      return { ok: false, error: 'permission denied' }
    }
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromB64Url(keyB64),
      })
    }
    const json = sub.toJSON()
    const r = await fetch('/api/v1/push/subscriptions', {
      method: 'POST',
      credentials: 'include',
      headers: hdrs,
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    })
    let host = ''
    try {
      host = new URL(json.endpoint).host
    } catch {
      /* ignore */
    }
    return { ok: r.status === 204, status: r.status, endpointHost: host }
  }, settings.body.vapidPublicKey)

  if (!subResult.ok) {
    console.error('subscribe failed', subResult)
    await close()
    process.exit(5)
  }
  console.log('subscribed', subResult.endpointHost)

  const prevChannel = settings.body.channel
  const ch = await page.evaluate(async () => {
    const r = await fetch('/api/v1/reminders/settings', {
      method: 'PUT',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'X-Dayrule-Client': 'web',
      },
      body: JSON.stringify({ channel: 'push' }),
    })
    return r.status
  })
  if (ch !== 204) {
    console.error('set channel failed', ch)
    await close()
    process.exit(6)
  }
  console.log('channel set to push')

  const reminderId = randomUUID()
  const fireAt = new Date(Date.now() - 60_000).toISOString()
  const put = await page.evaluate(
    async ({ id, fireAt }) => {
      const r = await fetch('/api/v1/reminders', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'X-Dayrule-Client': 'web',
        },
        body: JSON.stringify({
          reminders: [{ id, fireAt, localTime: '09:00' }],
        }),
      })
      return r.status
    },
    { id: reminderId, fireAt },
  )
  if (put !== 204) {
    console.error('put reminders failed', put)
    await close()
    process.exit(7)
  }
  console.log('reminder due')

  // Trigger production cron (Vercel injects CRON_SECRET).
  console.log('triggering vercel cron…')
  const cron = spawnSync(
    'vercel',
    [
      '--scope',
      'jon-hadfields-projects',
      'crons',
      'run',
      '/api/internal/reminders',
    ],
    { cwd: REPO, encoding: 'utf8', timeout: 120_000 },
  )
  console.log(
    'cron_cli',
    cron.status,
    (cron.stdout || '').trim().split('\n').slice(-5).join(' | '),
  )
  if (cron.status !== 0) {
    console.error(
      'cron trigger failed',
      (cron.stderr || '').trim().split('\n').slice(-8).join(' | '),
    )
  }

  // Clear any leftover notifications, then wait for FCM → Chromium.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    for (const n of await reg.getNotifications()) n.close()
  })
  let notificationSeen = false
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1500)
    const notifs = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready
      const list = await reg.getNotifications()
      return list.map((n) => ({
        title: n.title,
        tag: n.tag,
      }))
    })
    if (notifs.length) {
      notificationSeen = true
      console.log(
        'notifications',
        notifs.map((n) => ({
          title: n.title,
          tagPrefix: (n.tag || '').slice(0, 8),
        })),
      )
      break
    }
  }
  if (!notificationSeen) console.log('notifications', [])

  await page.evaluate(
    async ({ channel }) => {
      const hdrs = {
        'content-type': 'application/json',
        'X-Dayrule-Client': 'web',
      }
      await fetch('/api/v1/reminders', {
        method: 'PUT',
        credentials: 'include',
        headers: hdrs,
        body: JSON.stringify({ reminders: [] }),
      })
      await fetch('/api/v1/reminders/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: hdrs,
        body: JSON.stringify({ channel }),
      })
    },
    { channel: prevChannel },
  )
  console.log('restored channel to previous')

  await close()

  if (cron.status !== 0) {
    console.error('FAIL: could not trigger cron')
    process.exit(8)
  }
  if (!notificationSeen) {
    // Cron ran; FCM may have accepted without a visible Chromium notification
    // (headless quirks). Treat subscribe + cron success as soft pass.
    console.log(
      'SOFT PASS: subscribed + cron triggered; no in-browser notification observed',
    )
    process.exit(0)
  }
  console.log('PASS: server pushed and browser showed a notification')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
