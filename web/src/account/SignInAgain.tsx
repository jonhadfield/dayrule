import { useState, type FormEvent, type ReactNode } from 'react'
import { resumeSync, useSyncStatus } from '../sync/controller'
import {
  refreshSession,
  signInWithCode,
  signInWithPasskey,
  useAccount,
  type SecondStep,
} from './session'
import { ErrorText, Field, LinkButton, Remember, Submit } from './ui'
import { message } from './validation'

function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = (fn: () => Promise<void>) => async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function Overlay({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-bg/80 px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-in-again-title"
    >
      <div className="w-full max-w-sm rounded-[8px] border border-hairline bg-bg p-5 shadow-md">
        <h1
          id="sign-in-again-title"
          className="mb-1 font-serif text-xl font-semibold"
        >
          {title}
        </h1>
        {children}
      </div>
    </div>
  )
}

function PasswordStep({
  email,
  remember,
  setRemember,
  onSecondStep,
  onDone,
  onClose,
}: {
  email: string
  remember: boolean
  setRemember: (v: boolean) => void
  onSecondStep: (step: SecondStep) => void
  onDone: () => void
  onClose: () => void
}) {
  const [password, setPassword] = useState('')
  const { busy, error, run } = useSubmit()
  return (
    <Overlay title="Sign in to sync">
      <p className="mb-4 text-sm text-text-secondary">{email}</p>
      <form
        onSubmit={run(async () => {
          const step = await refreshSession(password, remember)
          if (step) onSecondStep(step)
          else onDone()
        })}
      >
        <ErrorText error={error} />
        <input
          type="email"
          autoComplete="username"
          value={email}
          readOnly
          hidden
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Remember checked={remember} onChange={setRemember} />
        <Submit busy={busy}>Sign in</Submit>
      </form>
      <div className="mt-5">
        <LinkButton onClick={onClose}>Not now</LinkButton>
      </div>
    </Overlay>
  )
}

function SecondStepOverlay({
  step,
  email,
  remember,
  onDone,
  onClose,
}: {
  step: SecondStep
  email: string
  remember: boolean
  onDone: () => void
  onClose: () => void
}) {
  const passkey = step.methods.includes('passkey')
  const totp = step.methods.includes('totp')
  const backup = step.methods.includes('backup')
  const [code, setCode] = useState('')
  const { busy, error, run } = useSubmit()
  const codeLabel = totp
    ? backup
      ? 'Code from your authenticator app, or a backup code'
      : 'Code from your authenticator app'
    : 'Backup code'
  return (
    <Overlay title={passkey ? 'Use your passkey' : 'Enter your code'}>
      <p className="mb-4 text-sm text-text-secondary">
        Your account asks for a second step as well as your password.
      </p>
      <ErrorText error={error} />
      {passkey && (
        <form
          onSubmit={run(async () => {
            await signInWithPasskey(step, email, remember)
            onDone()
          })}
        >
          <Submit busy={busy}>Use passkey</Submit>
        </form>
      )}
      {(totp || backup) && (
        <form
          aria-label="Sign in with a code"
          className={passkey ? 'mt-5 border-t border-hairline pt-5' : ''}
          onSubmit={run(async () => {
            await signInWithCode(step, email, remember, code)
            onDone()
          })}
        >
          <Field
            label={codeLabel}
            autoComplete="one-time-code"
            inputMode={backup ? 'text' : 'numeric'}
            autoCapitalize="none"
            spellCheck={false}
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Submit busy={busy}>Continue</Submit>
        </form>
      )}
      <div className="mt-5">
        <LinkButton onClick={onClose}>Not now</LinkButton>
      </div>
    </Overlay>
  )
}

/** Banner + overlay when sync got 401 and the vault is still open. */
export function SignInToSync() {
  const needs = useSyncStatus((s) => s.state.kind === 'needs-sign-in')
  const profile = useAccount((s) => s.profile)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<SecondStep | null>(null)
  const [remember, setRemember] = useState(profile?.remember ?? false)

  if (!needs || !profile) return null

  const done = () => {
    resumeSync()
    setOpen(false)
    setStep(null)
  }

  return (
    <>
      <div className="border-b border-hairline bg-sidebar px-4 py-3">
        <p className="text-sm font-semibold">On this device only</p>
        <p className="mt-0.5 text-xs text-text-secondary">
          Changes stay here until you sign in with your password.
        </p>
        <button
          type="button"
          className="mt-2 text-sm font-semibold text-accent hover:underline"
          onClick={() => setOpen(true)}
        >
          Sign in to sync
        </button>
      </div>
      {open &&
        (step ? (
          <SecondStepOverlay
            step={step}
            email={profile.email}
            remember={remember}
            onDone={done}
            onClose={() => setOpen(false)}
          />
        ) : (
          <PasswordStep
            email={profile.email}
            remember={remember}
            setRemember={setRemember}
            onSecondStep={setStep}
            onDone={done}
            onClose={() => setOpen(false)}
          />
        ))}
    </>
  )
}
