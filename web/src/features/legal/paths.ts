/** Pages anyone can read, signed in or not. */
export const LEGAL_PATHS = ['/privacy', '/terms']

/** Help: /help and /help/<topic>. */
export const isHelpPath = (path: string) =>
  path === '/help' || path.startsWith('/help/')
