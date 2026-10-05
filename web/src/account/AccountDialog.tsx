import { Dialog } from 'radix-ui'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { formatDisplayDate, toLocalDate } from '../domain/dates'
import {
  changeEmailStart,
  changeEmailVerify,
  changePassword,
  deleteAccount,
  listSessions,
  revokeSession,
  setRemember,
  useAccount,
  type DeviceSession,
} from './session'
import { useEntityStore } from '../app/context'
import { withRepairs } from '../domain/repair'
import {
  exportJson,
  exportMarkdown,
  ImportError,
  parseImport,
} from '../domain/exchange'
import * as cmd from '../store/commands'
import { disablePasskey, enablePasskey, passkeysAvailable } from './passkey'
import {
  loadReminderSettings,
  pushSupported,
  setChannel,
  subscribeThisDevice,
  thisDeviceSubscribed,
  unsubscribeThisDevice,
  useReminderSettings,
  type Channel,
} from '../reminders/reminders'
import { ErrorText, Field } from './ui'
import { message, passwordProblem } from './validation'

/** Account settings (email, password, devices, delete). */
export function AccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-text/20" />
        <Dialog.Content className="fixed top-[6vh] left-1/2 z-50 max-h-[88vh] w-[min(520px,calc(100vw-24px))] -translate-x-1/2 overflow-y-auto rounded-[8px] border border-hairline bg-bg p-5 shadow-lg outline-none">
          <Dialog.Title className="mb-1 font-serif text-xl font-semibold">
            Account
          </Dialog.Title>
          <Dialog.Description className="mb-4 text-sm text-text-secondary">
            Your to-dos are encrypted on your devices. These settings never
            change that key.
          </Dialog.Description>
          {open && <AccountSettings />}
          <p className="text-xs text-text-secondary">
            <a
              href="/privacy"
              target="_blank"
              rel="noopener"
              className="hover:underline"
            >
              Privacy
            </a>{' '}
            ·{' '}
            <a
              href="/terms"
              target="_blank"
              rel="noopener"
              className="hover:underline"
            >
              Terms
            </a>
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6 border-t border-hairline pt-4">
      <h2 className="mb-2 font-serif text-lg font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function useForm() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const run = (fn: () => Promise<string | void>) => async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const ok = await fn()
      if (ok) setDone(ok)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, setError, done, run }
}

const button =
  'rounded-full bg-text px-4 py-2 text-sm font-medium text-bg hover:bg-accent disabled:opacity-60'

function Done({ text }: { text: string | null }) {
  return text ? (
    <p role="status" className="mb-3 text-sm text-ready">
      {text}
    </p>
  ) : null
}

function AccountSettings() {
  const profile = useAccount((s) => s.profile)
  if (!profile) return null
  return (
    <>
      <EmailSection email={profile.email} />
      <PasswordSection />
      <DevicesSection remember={profile.remember} />
      <RemindersSection />
      <DataSection />
      <DeleteSection />
    </>
  )
}

function EmailSection({ email }: { email: string }) {
  const [newEmail, setNewEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const f = useForm()
  return (
    <Section title="Email">
      <p className="mb-3 text-sm">
        You sign in with <strong>{email}</strong>.
      </p>
      <ErrorText error={f.error} />
      <Done text={f.done} />
      {!sent ? (
        <form
          onSubmit={f.run(async () => {
            await changeEmailStart(newEmail, password)
            setSent(true)
          })}
        >
          <Field
            label="New email"
            type="email"
            autoComplete="email"
            required
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button type="submit" disabled={f.busy} className={button}>
            Send code
          </button>
        </form>
      ) : (
        <form
          onSubmit={f.run(async () => {
            await changeEmailVerify(newEmail, code)
            setSent(false)
            setNewEmail('')
            setPassword('')
            setCode('')
            return 'Email changed. We’ve told your old address.'
          })}
        >
          <Field
            label={`Code sent to ${newEmail}`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <button type="submit" disabled={f.busy} className={button}>
            Change email
          </button>
        </form>
      )}
    </Section>
  )
}

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const f = useForm()
  return (
    <Section title="Password">
      <p className="mb-3 text-sm text-text-secondary">
        Changing it signs out your other devices. Your recovery phrase stays the
        same.
      </p>
      <ErrorText error={f.error} />
      <Done text={f.done} />
      <form
        onSubmit={f.run(async () => {
          const problem = passwordProblem(next, confirm)
          if (problem) throw new Error(problem)
          await changePassword(current, next)
          setCurrent('')
          setNext('')
          setConfirm('')
          return 'Password changed. Other devices have been signed out.'
        })}
      >
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
          hint="At least 10 characters."
        />
        <Field
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button type="submit" disabled={f.busy} className={button}>
          Change password
        </button>
      </form>
    </Section>
  )
}

function DevicesSection({ remember }: { remember: boolean }) {
  const [sessions, setSessions] = useState<DeviceSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = () =>
    listSessions()
      .then(setSessions)
      .catch((err: unknown) => setError(message(err)))
  useEffect(() => {
    void load()
  }, [])

  return (
    <Section title="Devices">
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => void setRemember(e.target.checked)}
        />
        Stay unlocked on this device
      </label>
      <PasskeyUnlock />
      <ErrorText error={error} />
      {sessions === null ? (
        <p className="text-sm text-text-secondary">Loading…</p>
      ) : (
        <ul>
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 border-b border-hairline py-2 text-sm"
            >
              <span className="min-w-0 flex-1">
                {s.deviceLabel}
                {s.current && (
                  <span className="ml-2 text-xs text-ready">this device</span>
                )}
                <span className="block text-xs text-text-secondary">
                  Last active{' '}
                  {formatDisplayDate(toLocalDate(new Date(s.lastSeenAt)))}
                </span>
              </span>
              {!s.current && (
                <button
                  type="button"
                  className="text-accent hover:underline"
                  onClick={() =>
                    void revokeSession(s.id)
                      .then(load)
                      .catch((err: unknown) => setError(message(err)))
                  }
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function download(name: string, type: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Export and import (PLAN.md §8.1), all in the browser. */
function DataSection() {
  const store = useEntityStore()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const stamp = () => toLocalDate(new Date())

  const importFile = async (file: File) => {
    setError(null)
    setDone(null)
    try {
      const data = parseImport(await file.text())
      const n = store.run('Import', (d, env) => cmd.importData(d, env, data))
      const parts = [
        [n.todos, 'to-do'],
        [n.projects, 'project'],
        [n.areas, 'area'],
        [n.tags, 'tag'],
      ]
        .filter(([count]) => (count as number) > 0)
        .map(([count, what]) => `${count} ${what}${count === 1 ? '' : 's'}`)
      setDone(
        parts.length
          ? `Imported ${parts.join(', ')}. Undo (⌘Z) removes the whole import.`
          : 'That file had nothing to import.',
      )
    } catch (err) {
      setError(
        err instanceof ImportError
          ? err.message
          : 'That file couldn’t be imported.',
      )
    }
  }

  return (
    <Section title="Your data">
      <p className="mb-3 text-sm text-text-secondary">
        Exports are made on this device and are <strong>not encrypted</strong>:
        anyone with the file can read it. Importing adds a copy and never
        replaces what’s here.
      </p>
      <Done text={done} />
      <ErrorText error={error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={button}
          onClick={() =>
            download(
              `dayrule-${stamp()}.json`,
              'application/json',
              exportJson(withRepairs(store.entities), new Date()),
            )
          }
        >
          Export JSON
        </button>
        <button
          type="button"
          className={button}
          onClick={() =>
            download(
              `dayrule-${stamp()}.md`,
              'text/markdown',
              exportMarkdown(withRepairs(store.entities), new Date()),
            )
          }
        >
          Export Markdown
        </button>
        <label className={`${button} cursor-pointer`}>
          Import JSON…
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void importFile(file)
            }}
          />
        </label>
      </div>
    </Section>
  )
}

/** Reminder delivery (§10.5): opt-in, account-wide channel. */
function RemindersSection() {
  const { loaded, channel, vapidPublicKey } = useReminderSettings()
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!loaded)
      loadReminderSettings().catch((err: unknown) => setError(message(err)))
    void thisDeviceSubscribed().then(setSubscribed)
  }, [loaded])
  const canPush = vapidPublicKey !== '' && pushSupported()
  const wantsPush = channel === 'push' || channel === 'both'

  const act = (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    fn()
      .then(() => thisDeviceSubscribed().then(setSubscribed))
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setBusy(false))
  }
  const choose = (next: Channel) =>
    act(async () => {
      const push = next === 'push' || next === 'both'
      if (push) await subscribeThisDevice()
      await setChannel(next)
      if (!push) await unsubscribeThisDevice()
    })

  const options: { value: Channel; label: string; disabled?: boolean }[] = [
    { value: 'off', label: 'Off' },
    { value: 'push', label: 'Notifications', disabled: !canPush },
    { value: 'email', label: 'Email' },
    { value: 'both', label: 'Both', disabled: !canPush },
  ]

  return (
    <Section title="Reminders">
      <p className="mb-3 text-sm text-text-secondary">
        To remind you at the right time, Dayrule’s server has to know{' '}
        <strong>when</strong> each reminder is due. It never learns what a
        reminder is for.{' '}
        {channel === 'email' || channel === 'both'
          ? 'Email reminders also tell our email provider (Resend) your address and reminder times; they say only the time.'
          : ''}
      </p>
      <ErrorText error={error} />
      <div
        role="radiogroup"
        aria-label="Send reminders by"
        className="mb-3 flex flex-wrap gap-2"
      >
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex items-center gap-1.5 text-sm ${o.disabled ? 'opacity-50' : ''}`}
          >
            <input
              type="radio"
              name="reminder-channel"
              checked={channel === o.value}
              disabled={!loaded || busy || o.disabled}
              onChange={() => choose(o.value)}
            />
            {o.label}
          </label>
        ))}
      </div>
      {!canPush && (
        <p className="text-xs text-text-secondary">
          Notifications aren’t available here. On iPhone and iPad, add Dayrule
          to your Home Screen first.
        </p>
      )}
      {canPush && wantsPush && subscribed === false && (
        <button
          type="button"
          disabled={busy}
          className={button}
          onClick={() => act(subscribeThisDevice)}
        >
          Notify this device too
        </button>
      )}
      {canPush && wantsPush && subscribed && (
        <p className="text-xs text-text-secondary">
          This device shows notifications. Titles appear only on devices that
          stay unlocked; elsewhere it says “You have a reminder”.
        </p>
      )}
    </Section>
  )
}

/** Passkey unlock on this device (§10.2). */
function PasskeyUnlock() {
  const passkey = useAccount((s) => s.profile?.passkey)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!passkeysAvailable()) return null
  const act = (fn: () => Promise<void>) => () => {
    setBusy(true)
    setError(null)
    fn()
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="mb-3">
      <ErrorText error={error} />
      {passkey ? (
        <p className="flex items-center gap-3 text-sm">
          <span className="flex-1">
            Unlock with a passkey is on for this device.
          </span>
          <button
            type="button"
            disabled={busy}
            className="text-accent hover:underline"
            onClick={act(disablePasskey)}
          >
            Turn off
          </button>
        </p>
      ) : (
        <div className="text-sm">
          <button
            type="button"
            disabled={busy}
            className={button}
            onClick={act(enablePasskey)}
          >
            Unlock with a passkey
          </button>
          <p className="mt-1 text-xs text-text-secondary">
            Face ID, Touch ID, Windows Hello or a security key instead of typing
            your password on this device. Your password still works, and is
            needed on new devices.
          </p>
        </div>
      )}
    </div>
  )
}

function DeleteSection() {
  const [password, setPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const f = useForm()
  return (
    <Section title="Delete account">
      <p className="mb-3 text-sm text-text-secondary">
        Deletes your account and all your to-dos, on our servers and on this
        device. This can’t be undone.
      </p>
      <ErrorText error={f.error} />
      <form
        onSubmit={f.run(async () => {
          if (confirmText !== 'DELETE')
            throw new Error('Type DELETE to confirm.')
          await deleteAccount(password)
        })}
      >
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Field
          label="Type DELETE to confirm"
          required
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
        />
        <button
          type="submit"
          disabled={f.busy}
          className="rounded-full bg-deadline px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Delete my account
        </button>
      </form>
    </Section>
  )
}
