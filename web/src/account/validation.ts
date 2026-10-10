// Form rules for the account screens.

import { isBreached } from './breach'

export const MIN_PASSWORD = 10

export function passwordProblem(pw: string, confirm: string): string | null {
  if (pw.length < MIN_PASSWORD)
    return `Use at least ${MIN_PASSWORD} characters.`
  if (pw !== confirm) return 'The passwords don’t match.'
  return null
}

export const BREACHED =
  'This password has appeared in a data breach, so it’s one of the first that attackers try. Choose a different one.'

/** passwordProblem, then the breached-password check (decision 31). */
export async function newPasswordProblem(
  pw: string,
  confirm: string,
): Promise<string | null> {
  const problem = passwordProblem(pw, confirm)
  if (problem) return problem
  return (await isBreached(pw)) ? BREACHED : null
}

export function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong.'
}
