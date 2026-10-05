// Per-device appearance setting. Not synced: it's a device preference.

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'dayrule.theme'

export function storedTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Apply a theme to the page (tokens.css reads `data-theme`). */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') delete root.dataset.theme
  else root.dataset.theme = theme
}

export function saveTheme(theme: Theme): void {
  applyTheme(theme)
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Storage blocked (private mode): the choice lasts for this page only.
  }
}
