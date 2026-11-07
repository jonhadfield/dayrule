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
import {
  addSignInPasskey,
  cancelTwoStepReset,
  confirmTotp,
  listSignInPasskeys,
  makeBackupCodes,
  removeSignInPasskey,
  removeTotp,
  resetDate,
  startTotp,
  twoStepStatus,
  type SignInPasskey,
  type TwoStepStatus,
} from './twostep'
import { QrCode } from './QrCode'
import { deviceLabel } from './api'
import { ErrorText, Field } from './ui'
import { message, newPasswordProblem } from './validation'

/** Account settings (email, password, devices, delete). */
export function AccountDialog({
  open,
  onOpenChange,
  focus,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** A section to scroll to on opening. */
  focus?: 'two-step'
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
          {open && <AccountSettings focus={focus} />}
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

function Section({
  title,
  id,
  children,
}: {
  title: string
  id?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="mb-6 border-t border-hairline pt-4">
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

function AccountSettings({ focus }: { focus?: 'two-step' }) {
  const profile = useAccount((s) => s.profile)
  useEffect(() => {
    if (focus) document.getElementById(focus)?.scrollIntoView()
  }, [focus])
  if (!profile) return null
  return (
    <>
      <EmailSection email={profile.email} />
      <PasswordSection />
      <TwoStepSection />
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
          const problem = await newPasswordProblem(next, confirm)
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

/** Passkeys the server asks for after the password (decision 30). */
function TwoStepSection() {
  const [status, setStatus] = useState<TwoStepStatus | null>(null)
  const [keys, setKeys] = useState<SignInPasskey[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const load = () =>
    Promise.all([twoStepStatus(), listSignInPasskeys()])
      .then(([s, k]) => {
        setStatus(s)
        setKeys(k)
      })
      .catch((err: unknown) => setLoadError(message(err)))
  useEffect(() => {
    void load()
  }, [])
  const on = status !== null && (status.passkeys > 0 || status.totp !== null)
  return (
    <Section title="Two-step sign-in" id="two-step">
      {status?.resetDueAt && (
        <PendingReset due={status.resetDueAt} reload={load} />
      )}
      <p className="mb-3 text-sm text-text-secondary">
        When you sign in on a new device, Dayrule asks for a passkey or a code
        from an authenticator app after your password, so a stolen password
        isn’t enough. Your recovery phrase still works without either.
      </p>
      <ErrorText error={loadError} />
      {passkeysAvailable() && keys && status && (
        <SignInPasskeys
          keys={keys}
          totpOn={status.totp !== null}
          reload={load}
        />
      )}
      {status && (
        <AuthenticatorApp
          totp={status.totp}
          passkeys={status.passkeys}
          reload={load}
        />
      )}
      {status && on && <BackupCodes left={status.backupCodes} reload={load} />}
    </Section>
  )
}

/** A reset by email is waiting (PLAN.md §10.2): say when, and offer to stop it. */
function PendingReset({
  due,
  reload,
}: {
  due: string
  reload: () => Promise<void>
}) {
  const f = useForm()
  return (
    <form
      aria-label="Pending reset"
      className="mb-4 rounded-[6px] border border-hairline p-3 text-sm"
      onSubmit={f.run(async () => {
        await cancelTwoStepReset()
        await reload()
      })}
    >
      <ErrorText error={f.error} />
      <p className="mb-2">
        Someone with your password asked by email to turn off two-step sign-in.
        It happens on {resetDate(due)} unless you cancel it. If it wasn’t you,
        cancel it and change your password.
      </p>
      <button type="submit" disabled={f.busy} className={button}>
        Cancel the reset
      </button>
    </form>
  )
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h3 className="mt-4 mb-2 text-sm font-semibold">{children}</h3>
}

const linkButton = 'text-sm text-accent hover:underline'

function SignInPasskeys({
  keys,
  totpOn,
  reload,
}: {
  keys: SignInPasskey[]
  totpOn: boolean
  reload: () => Promise<void>
}) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [removePassword, setRemovePassword] = useState('')
  const f = useForm()
  const here = window.location.hostname // the RP ID: no port
  return (
    <>
      <SubHeading>Passkeys</SubHeading>
      <ErrorText error={f.error} />
      <Done text={f.done} />
      {keys.length > 0 && (
        <ul className="mb-3 divide-y divide-hairline text-sm">
          {keys.map((k) => (
            <li key={k.id} className="py-2">
              <div className="flex items-center gap-3">
                <span className="flex-1">
                  {k.label}
                  <span className="block text-xs text-text-secondary">
                    {k.site !== here && `Works on ${k.site}. `}
                    {k.lastUsedAt
                      ? `Last used ${formatDisplayDate(toLocalDate(new Date(k.lastUsedAt)))}`
                      : 'Not used yet'}
                  </span>
                </span>
                {removing !== k.id && (
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={() => {
                      setRemoving(k.id)
                      setRemovePassword('')
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
              {removing === k.id && (
                <form
                  className="mt-2"
                  aria-label={`Remove ${k.label}`}
                  onSubmit={f.run(async () => {
                    await removeSignInPasskey(k.id, removePassword)
                    setRemoving(null)
                    await reload()
                    return keys.length > 1 || totpOn
                      ? 'Passkey removed.'
                      : 'Passkey removed. Signing in now needs only your password.'
                  })}
                >
                  <Field
                    label="Password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={removePassword}
                    onChange={(e) => setRemovePassword(e.target.value)}
                  />
                  <div className="flex gap-3">
                    <button type="submit" disabled={f.busy} className={button}>
                      Remove passkey
                    </button>
                    <button
                      type="button"
                      className={linkButton}
                      onClick={() => setRemoving(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {removing === null && !adding && (
        <button
          type="button"
          className={button}
          onClick={() => {
            setName('')
            setPassword('')
            setAdding(true)
          }}
        >
          Add a passkey
        </button>
      )}
      {removing === null && adding && (
        <form
          aria-label="Add a sign-in passkey"
          onSubmit={f.run(async () => {
            await addSignInPasskey(name.trim() || deviceLabel(), password)
            setAdding(false)
            await reload()
            return 'Passkey added. Signing in on a new device now needs it too.'
          })}
        >
          <Field
            label="Name (optional)"
            value={name}
            placeholder={deviceLabel()}
            onChange={(e) => setName(e.target.value)}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="flex gap-3">
            <button type="submit" disabled={f.busy} className={button}>
              Add passkey
            </button>
            <button
              type="button"
              className={linkButton}
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </>
  )
}

type AppStep =
  | { kind: 'idle' }
  | { kind: 'password' }
  | { kind: 'scan'; secret: string; uri: string }
  | { kind: 'remove' }

/** TOTP (decision 30): for people without passkeys, or as well as them. */
function AuthenticatorApp({
  totp,
  passkeys,
  reload,
}: {
  totp: TwoStepStatus['totp']
  passkeys: number
  reload: () => Promise<void>
}) {
  const [step, setStep] = useState<AppStep>({ kind: 'idle' })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const f = useForm()
  const cancel = (
    <button
      type="button"
      className={linkButton}
      onClick={() => setStep({ kind: 'idle' })}
    >
      Cancel
    </button>
  )
  const passwordField = (
    <Field
      label="Password"
      type="password"
      autoComplete="current-password"
      required
      value={password}
      onChange={(e) => setPassword(e.target.value)}
    />
  )
  return (
    <>
      <SubHeading>Authenticator app</SubHeading>
      <ErrorText error={f.error} />
      <Done text={f.done} />
      {totp && step.kind !== 'remove' && (
        <div className="mb-3 flex items-center gap-3 text-sm">
          <span className="flex-1">
            On
            <span className="block text-xs text-text-secondary">
              {totp.lastUsedAt
                ? `Last used ${formatDisplayDate(toLocalDate(new Date(totp.lastUsedAt)))}`
                : 'Not used yet'}
            </span>
          </span>
          <button
            type="button"
            className="text-accent hover:underline"
            onClick={() => {
              setPassword('')
              setStep({ kind: 'remove' })
            }}
          >
            Remove app
          </button>
        </div>
      )}
      {totp && step.kind === 'remove' && (
        <form
          aria-label="Remove the authenticator app"
          onSubmit={f.run(async () => {
            await removeTotp(password)
            setStep({ kind: 'idle' })
            await reload()
            return passkeys > 0
              ? 'Authenticator app removed.'
              : 'Authenticator app removed. Signing in now needs only your password.'
          })}
        >
          {passwordField}
          <div className="flex gap-3">
            <button type="submit" disabled={f.busy} className={button}>
              Remove app
            </button>
            {cancel}
          </div>
        </form>
      )}
      {!totp && step.kind === 'idle' && (
        <>
          <p className="mb-3 text-sm text-text-secondary">
            Use an app such as 1Password, Google Authenticator or your phone’s
            password manager to make a new code every 30 seconds.
          </p>
          <button
            type="button"
            className={button}
            onClick={() => {
              setPassword('')
              setStep({ kind: 'password' })
            }}
          >
            Set up an authenticator app
          </button>
        </>
      )}
      {!totp && step.kind === 'password' && (
        <form
          aria-label="Set up an authenticator app"
          onSubmit={f.run(async () => {
            const { secret, uri } = await startTotp(password)
            setPassword('')
            setCode('')
            setStep({ kind: 'scan', secret, uri })
          })}
        >
          {passwordField}
          <div className="flex gap-3">
            <button type="submit" disabled={f.busy} className={button}>
              Continue
            </button>
            {cancel}
          </div>
        </form>
      )}
      {!totp && step.kind === 'scan' && (
        <form
          aria-label="Confirm the authenticator app"
          onSubmit={f.run(async () => {
            await confirmTotp(code)
            setStep({ kind: 'idle' })
            await reload()
            return 'Authenticator app added. Signing in on a new device now needs a code from it.'
          })}
        >
          <p className="mb-3 text-sm text-text-secondary">
            Scan this with your authenticator app, or enter the key by hand.
            Then type the code it shows.
          </p>
          <QrCode text={step.uri} label="QR code for your authenticator app" />
          <p className="mt-2 mb-3 text-sm">
            Key:{' '}
            <code
              data-testid="totp-secret"
              className="font-mono break-all select-all"
            >
              {step.secret.replace(/(.{4})(?=.)/g, '$1 ')}
            </code>
          </p>
          <Field
            label="Code from the app"
            autoComplete="one-time-code"
            inputMode="numeric"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div className="flex gap-3">
            <button type="submit" disabled={f.busy} className={button}>
              Turn on
            </button>
            {cancel}
          </div>
        </form>
      )}
    </>
  )
}

/** Single-use codes for when the passkey and the phone are both lost. */
function BackupCodes({
  left,
  reload,
}: {
  left: number
  reload: () => Promise<void>
}) {
  const [asking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const f = useForm()
  return (
    <>
      <SubHeading>Backup codes</SubHeading>
      <ErrorText error={f.error} />
      {codes ? (
        <>
          <p className="mb-3 text-sm text-text-secondary">
            Each code signs in once instead of a passkey or app code. Keep them
            somewhere safe; they won’t be shown again.
          </p>
          <ol
            aria-label="Backup codes"
            className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-[6px] border border-hairline bg-sidebar/50 p-3 font-mono text-sm"
          >
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
          <div className="flex gap-3">
            <button
              type="button"
              className={button}
              onClick={() =>
                download(
                  'dayrule-backup-codes.txt',
                  'text/plain',
                  `Dayrule backup codes\n\n${codes.join('\n')}\n\nEach code works once.\n`,
                )
              }
            >
              Download
            </button>
            <button
              type="button"
              className={linkButton}
              onClick={() => setCodes(null)}
            >
              I’ve saved them
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-text-secondary">
            {left > 0
              ? `${left} unused. Making new ones stops the old ones working.`
              : 'None yet. Make some so you can still sign in if you lose your passkeys and your phone.'}
          </p>
          {asking ? (
            <form
              aria-label="Make backup codes"
              onSubmit={f.run(async () => {
                setCodes(await makeBackupCodes(password))
                setAsking(false)
                await reload()
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
              <div className="flex gap-3">
                <button type="submit" disabled={f.busy} className={button}>
                  Make codes
                </button>
                <button
                  type="button"
                  className={linkButton}
                  onClick={() => setAsking(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              className={button}
              onClick={() => {
                setPassword('')
                setAsking(true)
              }}
            >
              {left > 0 ? 'Make new backup codes' : 'Make backup codes'}
            </button>
          )}
        </>
      )}
    </>
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
        replaces what’s here. To bring in Things 3, run{' '}
        <code className="text-xs">things-export</code> on your Mac (see Help →
        Your data), then import the JSON here — mapping stays on this device.
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
