import { Suspense, lazy, type ComponentProps } from 'react'

const AccountDialog = lazy(() =>
  import('./AccountDialog').then((m) => ({ default: m.AccountDialog })),
)

/** Loads Account (+ Things import) only when the dialog is opened. */
export function LazyAccountDialog(props: ComponentProps<typeof AccountDialog>) {
  if (!props.open) return null
  return (
    <Suspense fallback={null}>
      <AccountDialog {...props} />
    </Suspense>
  )
}
