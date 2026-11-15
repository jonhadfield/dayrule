import { Dialog } from 'radix-ui'
import { useState } from 'react'
import { LazyAccountDialog } from './LazyAccountDialog'
import { dismissTwoStepSuggestion, useAccount } from './session'

/**
 * Straight after sign-up, suggest a second step for sign-in (decision 30).
 * Optional: "Not now" is as easy as "Set it up", and Account has it later.
 */
export function TwoStepPrompt() {
  const suggest = useAccount((s) => s.suggestTwoStep)
  const [account, setAccount] = useState(false)
  return (
    <>
      <Dialog.Root
        open={suggest}
        onOpenChange={(o) => {
          if (!o) dismissTwoStepSuggestion()
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-text/20" />
          <Dialog.Content className="fixed top-[12vh] left-1/2 z-50 w-[min(420px,calc(100vw-24px))] -translate-x-1/2 rounded-[8px] border border-hairline bg-bg p-5 shadow-lg outline-none">
            <Dialog.Title className="mb-2 font-serif text-xl font-semibold">
              Add a second step to sign-in?
            </Dialog.Title>
            <Dialog.Description className="mb-4 text-sm text-text-secondary">
              Then your password alone can’t open your account on a new device.
              Use a passkey (like Face ID or a security key) or a code from an
              authenticator app. You can do this later under Account.
            </Dialog.Description>
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="rounded-full bg-text px-4 py-2 text-sm font-medium text-bg hover:bg-accent"
                onClick={() => {
                  dismissTwoStepSuggestion()
                  setAccount(true)
                }}
              >
                Set it up
              </button>
              <Dialog.Close className="text-sm text-accent hover:underline">
                Not now
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <LazyAccountDialog
        open={account}
        onOpenChange={setAccount}
        focus="two-step"
      />
    </>
  )
}
