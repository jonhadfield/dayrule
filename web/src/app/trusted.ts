// The CSP requires Trusted Types and allows one policy, `dayrule-worker`
// (vercel.json). It turns nothing but this origin's own scripts into
// script URLs: the crypto worker and the service worker.

interface TrustedTypePolicyLike {
  createScriptURL(url: string): string
}
interface TrustedTypesLike {
  createPolicy(
    name: string,
    rules: { createScriptURL: (url: string) => string },
  ): TrustedTypePolicyLike
}

let policy: TrustedTypePolicyLike | null | undefined

export function trustedScriptUrl(url: string): string {
  if (policy === undefined) {
    const tt = (globalThis as { trustedTypes?: TrustedTypesLike }).trustedTypes
    policy =
      tt?.createPolicy('dayrule-worker', {
        createScriptURL: (u) => {
          const parsed = new URL(u, location.href)
          if (parsed.origin !== location.origin)
            throw new Error('script must be same-origin')
          return parsed.href
        },
      }) ?? null
  }
  return policy ? policy.createScriptURL(url) : url
}
