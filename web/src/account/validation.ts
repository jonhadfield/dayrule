// Form rules for the account screens.

export const MIN_PASSWORD = 10

export function passwordProblem(pw: string, confirm: string): string | null {
  if (pw.length < MIN_PASSWORD)
    return `Use at least ${MIN_PASSWORD} characters.`
  if (pw !== confirm) return 'The passwords don’t match.'
  return null
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.'
}
