// Small JSON client for the account API (PLAN.md §11.3).

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Dayrule-Client': 'web',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(
      0,
      'offline',
      'Can’t reach Dayrule. Check your connection.',
    )
  }
  if (res.status === 204) return undefined as T
  const data = (await res.json().catch(() => ({}))) as {
    error?: unknown
    code?: unknown
  }
  if (!res.ok) {
    // Vercel's Firewall (rate limits) answers before our API does, with its
    // own body; say what happened rather than showing that.
    if (res.headers.get('x-vercel-mitigated')) {
      throw new ApiError(
        res.status,
        'rate_limited',
        'Too many attempts from this network. Please wait a while and try again.',
      )
    }
    throw new ApiError(
      res.status,
      typeof data.code === 'string' ? data.code : 'error',
      typeof data.error === 'string' ? data.error : 'Something went wrong.',
    )
  }
  return data as T
}

/** A short, human label for this browser, shown in the devices list. */
export function deviceLabel(): string {
  const ua = navigator.userAgent
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  const os = /iPhone|iPad/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'unknown OS'
  return `${browser} on ${os}`
}
