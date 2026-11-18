import { describe, expect, it } from 'vitest'
import { fieldsFromShareParams } from './share'
import { inboxBookmarklet } from './bookmarklet'

describe('inboxBookmarklet', () => {
  it('targets the given origin’s /inbox with share params', () => {
    const js = inboxBookmarklet('https://dayrule.app')
    expect(js.startsWith('javascript:')).toBe(true)
    expect(js).toContain('https://dayrule.app/inbox')
    expect(js).toContain('title=')
    expect(js).toContain('text=')
    expect(js).toContain('url=')
  })

  it('matches Share Target field mapping for a page share', () => {
    const q = new URLSearchParams({
      title: 'Example',
      text: 'A note',
      url: 'https://example.com/x',
    })
    expect(fieldsFromShareParams(q)).toEqual({
      title: 'Example',
      notes: 'A note\n\nhttps://example.com/x',
    })
  })
})
