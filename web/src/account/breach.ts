// Breached-password check (PLAN.md §10.2, decision 31).
//
// The browser asks Have I Been Pwned's range API directly, never through
// Dayrule's API: only the first 5 hex characters of the password's SHA-1
// leave the device, and the match against the returned suffixes is done here.
// Any failure counts as "not breached", so a third-party outage never blocks
// sign-up, a password change or recovery.

export const RANGE_URL = 'https://api.pwnedpasswords.com/range/'
const TIMEOUT_MS = 3000

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(text),
  )
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  )
    .join('')
    .toUpperCase()
}

/** True if the password is in a known breach; false if not, or if unknown. */
export async function isBreached(
  password: string,
  timeoutMs = TIMEOUT_MS,
): Promise<boolean> {
  try {
    const hash = await sha1Hex(password)
    const res = await fetch(RANGE_URL + hash.slice(0, 5), {
      headers: { 'Add-Padding': 'true' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return false
    const suffix = hash.slice(5)
    // Lines are "SUFFIX:COUNT". Padding lines have a count of 0.
    return (await res.text()).split('\n').some((line) => {
      const [s, count] = line.trim().split(':')
      return s === suffix && Number(count) > 0
    })
  } catch {
    return false
  }
}
