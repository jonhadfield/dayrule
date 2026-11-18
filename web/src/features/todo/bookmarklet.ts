/**
 * Bookmarklet that opens Dayrule Inbox with the current page’s title,
 * selected text, and URL (same query params as Share Target / PLAN §8.4).
 */
export function inboxBookmarklet(origin: string): string {
  const base = origin.replace(/\/$/, '')
  // Runs on the page you’re browsing, not inside Dayrule.
  return (
    `javascript:void(location.href=${JSON.stringify(`${base}/inbox`)}` +
    `+'?title='+encodeURIComponent(document.title)` +
    `+'&text='+encodeURIComponent(String(window.getSelection()))` +
    `+'&url='+encodeURIComponent(location.href))`
  )
}
