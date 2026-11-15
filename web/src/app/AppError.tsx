import { useEffect } from 'react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { reportError } from './errors'

/** Shown instead of a blank page if rendering fails. Data is safe on the device. */
export function AppError({ error, reset }: ErrorComponentProps) {
  useEffect(() => {
    console.error(error)
    reportError(error)
  }, [error])
  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="mb-2 font-serif text-2xl font-semibold">
        Something went wrong
      </h1>
      <p className="mb-4 text-text-secondary">
        Your to-dos are safe on this device. Reload to carry on.
      </p>
      <button
        type="button"
        className="rounded-full bg-text px-4 py-2 text-bg"
        onClick={() => {
          reset()
          window.location.reload()
        }}
      >
        Reload
      </button>
    </div>
  )
}
