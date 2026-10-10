import { useMemo, useState, type FormEvent } from 'react'
import {
  prepareAccount,
  recover,
  register,
  signIn,
  signInWithCode,
  signInWithPasskey,
  signOut,
  signUpStart,
  signUpVerify,
  unlock,
  useAccount,
  type PendingAccount,
  type SecondStep,
} from './session'
import { unlockWithPasskey } from './passkey'
import { AuthShell, ErrorText, Field, LinkButton, Remember, Submit } from './ui'
import { message, newPasswordProblem } from './validation'

type Screen = 'sign-in' | 'sign-up' | 'recover'

/** Shown when no one is signed in on this device. */
export function SignedOut() {
  const [screen, setScreen] = useState<Screen>('sign-in')
  if (screen === 'sign-up')
    return <SignUp onCancel={() => setScreen('sign-in')} />
  if (screen === 'recover')
    return <Recover onCancel={() => setScreen('sign-in')} />
  return (
    <SignIn
      onSignUp={() => setScreen('sign-up')}
      onRecover={() => setScreen('recover')}
    />
  )
}

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
  return { busy, error, setError, run }
}

function SignIn({
  onSignUp,
  onRecover,
}: {
  onSignUp: () => void
  onRecover: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [step, setStep] = useState<SecondStep | null>(null)
  const { busy, error, run } = useSubmit()
  if (step)
    return (
      <SecondStepScreen
        step={step}
        email={email}
        remember={remember}
        onRecover={onRecover}
      />
    )
  return (
    <AuthShell title="Sign in">
      <form
        onSubmit={run(async () =>
          setStep(await signIn(email, password, remember)),
        )}
      >
        <ErrorText error={error} />
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Remember checked={remember} onChange={setRemember} />
        <Submit busy={busy}>Sign in</Submit>
      </form>
      <div className="mt-5 flex justify-between">
        <LinkButton onClick={onSignUp}>Create an account</LinkButton>
        <LinkButton onClick={onRecover}>Forgot password?</LinkButton>
      </div>
    </AuthShell>
  )
}

/**
 * Two-step sign-in (decision 30): the password was right, and the account
 * also asks for a passkey or a code (authenticator app or backup code). The
 * passkey is a button, not an automatic prompt: some browsers only show the
 * passkey prompt straight after a tap.
 */
function SecondStepScreen({
  step,
  email,
  remember,
  onRecover,
}: {
  step: SecondStep
  email: string
  remember: boolean
  onRecover: () => void
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
    <AuthShell
      title={passkey ? 'Use your passkey' : 'Enter your code'}
      subtitle="Your account asks for a second step as well as your password when you sign in on a new device."
    >
      <ErrorText error={error} />
      {passkey && (
        <form onSubmit={run(() => signInWithPasskey(step, email, remember))}>
          <Submit busy={busy}>Use passkey</Submit>
        </form>
      )}
      {(totp || backup) && (
        <form
          aria-label="Sign in with a code"
          className={passkey ? 'mt-5 border-t border-hairline pt-5' : ''}
          onSubmit={run(() => signInWithCode(step, email, remember, code))}
        >
          {passkey && (
            <p className="mb-3 text-sm text-text-secondary">
              Or use a code instead.
            </p>
          )}
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
          {passkey ? (
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-full border border-hairline px-4 py-2 text-sm font-medium hover:border-accent disabled:opacity-60"
            >
              Continue with code
            </button>
          ) : (
            <Submit busy={busy}>Continue</Submit>
          )}
        </form>
      )}
      <div className="mt-5 flex justify-between">
        <LinkButton onClick={() => window.location.assign('/')}>
          Start again
        </LinkButton>
        <LinkButton onClick={onRecover}>
          {passkey && !totp && !backup
            ? 'Lost your passkey?'
            : 'Can’t use any of these?'}
        </LinkButton>
      </div>
    </AuthShell>
  )
}

/** Shown when this device has an account but it's locked. */
export function Locked() {
  const profile = useAccount((s) => s.profile)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(profile?.remember ?? false)
  const { busy, error, run } = useSubmit()
  const hasPasskey = profile?.passkey !== undefined
  return (
    <AuthShell title="Unlock" subtitle={profile?.email}>
      {hasPasskey && (
        <form
          onSubmit={run(() => unlockWithPasskey(remember))}
          className="mb-5 border-b border-hairline pb-5"
        >
          <Submit busy={busy}>Unlock with passkey</Submit>
        </form>
      )}
      <form onSubmit={run(() => unlock(password, remember))}>
        <ErrorText error={error} />
        <input
          type="email"
          autoComplete="username"
          value={profile?.email ?? ''}
          readOnly
          hidden
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          autoFocus={!hasPasskey}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Remember checked={remember} onChange={setRemember} />
        <Submit busy={busy}>Unlock</Submit>
      </form>
      <div className="mt-5">
        <LinkButton onClick={() => void signOut()}>
          Use a different account
        </LinkButton>
      </div>
    </AuthShell>
  )
}

// ---------------------------------------------------------------------------
// Sign-up

type Step = 'details' | 'code' | 'password' | 'phrase' | 'confirm'

function SignUp({ onCancel }: { onCancel: () => void }) {
  const [step, setStep] = useState<Step>('details')
  const [email, setEmail] = useState('')
  const [invite, setInvite] = useState('')
  const [code, setCode] = useState('')
  const [token, setToken] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(false)
  const [pending, setPending] = useState<PendingAccount | null>(null)
  const { busy, error, setError, run } = useSubmit()

  if (step === 'details') {
    return (
      <AuthShell
        title="Create an account"
        subtitle="Dayrule is invite-only for now."
      >
        <form
          onSubmit={run(async () => {
            await signUpStart(email, invite)
            setStep('code')
          })}
        >
          <ErrorText error={error} />
          <Field
            label="Invite code"
            required
            autoCapitalize="characters"
            value={invite}
            onChange={(e) => setInvite(e.target.value)}
            placeholder="XXXX-XXXX-XXXX"
          />
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            hint="This is how you’ll sign in."
          />
          <Submit busy={busy}>Send code</Submit>
        </form>
        <div className="mt-5">
          <LinkButton onClick={onCancel}>I already have an account</LinkButton>
        </div>
      </AuthShell>
    )
  }

  if (step === 'code') {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a 6-digit code to ${email}. It expires in 10 minutes.`}
      >
        <form
          onSubmit={run(async () => {
            setToken(await signUpVerify(email, code))
            setStep('password')
          })}
        >
          <ErrorText error={error} />
          <Field
            label="Code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          <Submit busy={busy}>Continue</Submit>
        </form>
        <div className="mt-5">
          <LinkButton onClick={() => setStep('details')}>
            Use a different email
          </LinkButton>
        </div>
      </AuthShell>
    )
  }

  if (step === 'password') {
    return (
      <AuthShell
        title="Choose a password"
        subtitle="Your password encrypts your to-dos on this device before anything is sent. We never see it and can’t reset it."
      >
        <form
          onSubmit={run(async () => {
            const problem = await newPasswordProblem(password, confirm)
            if (problem) return setError(problem)
            setPending(await prepareAccount(password))
            setStep('phrase')
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
            autoComplete="new-password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            hint="At least 10 characters. A few unrelated words work well."
          />
          <Field
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <Submit busy={busy}>Continue</Submit>
        </form>
      </AuthShell>
    )
  }

  if (step === 'phrase' && pending) {
    return (
      <AuthShell
        title="Your recovery phrase"
        subtitle="If you forget your password, these 24 words are the only way back into your account. Write them down and keep them somewhere safe. Nobody, including us, can recover your account without them."
      >
        <ol className="mb-5 grid grid-cols-2 gap-x-4 gap-y-1 rounded-[6px] border border-hairline bg-sidebar/50 p-3 font-mono text-sm sm:grid-cols-3">
          {pending.recoveryWords.map((w, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-5 text-right text-text-secondary">
                {i + 1}
              </span>
              <span>{w}</span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() => setStep('confirm')}
          className="w-full rounded-full bg-text px-4 py-2.5 font-medium text-bg hover:bg-accent"
        >
          I’ve written them down
        </button>
      </AuthShell>
    )
  }

  if (step === 'confirm' && pending) {
    return (
      <ConfirmPhrase
        words={pending.recoveryWords}
        busy={busy}
        error={error}
        remember={remember}
        setRemember={setRemember}
        onBack={() => setStep('phrase')}
        onConfirmed={run(() =>
          register(email, token, invite, pending, remember),
        )}
      />
    )
  }
  return null
}

function ConfirmPhrase({
  words,
  busy,
  error,
  remember,
  setRemember,
  onBack,
  onConfirmed,
}: {
  words: string[]
  busy: boolean
  error: string | null
  remember: boolean
  setRemember: (v: boolean) => void
  onBack: () => void
  onConfirmed: (e: FormEvent) => void
}) {
  // Three random positions to type back (decision 5).
  const positions = useMemo(() => {
    const picks = new Set<number>()
    while (picks.size < 3)
      picks.add(crypto.getRandomValues(new Uint32Array(1))[0]! % words.length)
    return [...picks].sort((a, b) => a - b)
  }, [words])
  const [answers, setAnswers] = useState<string[]>(['', '', ''])
  const correct = positions.every(
    (p, i) => answers[i]?.trim().toLowerCase() === words[p],
  )

  return (
    <AuthShell
      title="Check your recovery phrase"
      subtitle="Type these words from your phrase."
    >
      <form onSubmit={(e) => (correct ? onConfirmed(e) : e.preventDefault())}>
        <ErrorText error={error} />
        {positions.map((p, i) => (
          <Field
            key={p}
            label={`Word ${p + 1}`}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            required
            value={answers[i]}
            onChange={(e) =>
              setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))
            }
          />
        ))}
        <Remember checked={remember} onChange={setRemember} />
        {!correct && answers.every((a) => a.trim() !== '') && (
          <p className="mb-3 text-sm text-deadline">
            Those don’t match your phrase.
          </p>
        )}
        <Submit busy={busy}>Create account</Submit>
      </form>
      <div className="mt-5">
        <LinkButton onClick={onBack}>Show the phrase again</LinkButton>
      </div>
    </AuthShell>
  )
}

// ---------------------------------------------------------------------------
// Recovery

function Recover({ onCancel }: { onCancel: () => void }) {
  const [email, setEmail] = useState('')
  const [words, setWords] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(false)
  const { busy, error, setError, run } = useSubmit()
  return (
    <AuthShell
      title="Reset your password"
      subtitle="Use your 24-word recovery phrase. Your to-dos stay encrypted with the same key; only the password changes."
    >
      <form
        onSubmit={run(async () => {
          const problem = await newPasswordProblem(password, confirm)
          if (problem) return setError(problem)
          await recover(email, words, password, remember)
        })}
      >
        <ErrorText error={error} />
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">
            Recovery phrase
          </span>
          <textarea
            required
            rows={4}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            value={words}
            onChange={(e) => setWords(e.target.value)}
            placeholder="24 words, separated by spaces"
            className="w-full rounded-[6px] border border-hairline bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
        </label>
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
        <Remember checked={remember} onChange={setRemember} />
        <Submit busy={busy}>Reset password</Submit>
      </form>
      <div className="mt-5">
        <LinkButton onClick={onCancel}>Back to sign in</LinkButton>
      </div>
    </AuthShell>
  )
}
