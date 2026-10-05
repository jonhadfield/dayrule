import { TOPICS, type TopicSlug } from './topics'
import { Article } from './articles'

/**
 * Help (/help and /help/<topic>): public, works offline, no account needed.
 * Plain links, so it works the same signed in or out.
 */
export function HelpPage({ path }: { path: string }) {
  const slug = path.replace(/^\/help\/?/, '').replace(/\/$/, '')
  const topic = TOPICS.find((t) => t.slug === slug)
  const index = TOPICS.findIndex((t) => t.slug === slug)
  const next = index >= 0 ? TOPICS[index + 1] : undefined

  return (
    <div className="mx-auto flex max-w-[1000px] gap-10 px-5 pt-[max(env(safe-area-inset-top),24px)] pb-16">
      <nav aria-label="Help topics" className="hidden w-56 shrink-0 md:block">
        <a href="/" className="text-accent hover:underline">
          ← Dayrule
        </a>
        <p className="mt-6 mb-2 font-serif text-lg font-semibold">
          <a href="/help">Help</a>
        </p>
        <ul className="space-y-1 text-sm">
          {TOPICS.map((t) => (
            <li key={t.slug}>
              <a
                href={`/help/${t.slug}`}
                aria-current={t.slug === slug ? 'page' : undefined}
                className={`block rounded-[6px] px-2 py-1 ${t.slug === slug ? 'bg-sidebar font-semibold' : 'hover:bg-sidebar/60'}`}
              >
                {t.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main className="min-w-0 max-w-[680px] flex-1 leading-relaxed">
        <a
          href={topic ? '/help' : '/'}
          className="text-accent hover:underline md:hidden"
        >
          ← {topic ? 'Help' : 'Dayrule'}
        </a>
        {topic ? (
          <article>
            <h1 className="mt-6 mb-1 font-serif text-[32px] font-semibold tracking-tight">
              {topic.title}
            </h1>
            <p className="mb-6 text-text-secondary">{topic.summary}</p>
            <Article slug={topic.slug as TopicSlug} />
            {next && (
              <p className="mt-10 border-t border-hairline pt-4">
                Next:{' '}
                <a
                  className="text-accent hover:underline"
                  href={`/help/${next.slug}`}
                >
                  {next.title}
                </a>
              </p>
            )}
          </article>
        ) : (
          <>
            <h1 className="mt-6 mb-1 font-serif text-[32px] font-semibold tracking-tight">
              Help
            </h1>
            <p className="mb-6 text-text-secondary">
              Short guides to everything in Dayrule. Start at the top if you’re
              new.
            </p>
            <ul className="divide-y divide-hairline border-y border-hairline">
              {TOPICS.map((t) => (
                <li key={t.slug}>
                  <a
                    href={`/help/${t.slug}`}
                    className="block py-3 hover:bg-sidebar/40"
                  >
                    <span className="block font-semibold">{t.title}</span>
                    <span className="block text-sm text-text-secondary">
                      {t.summary}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-10 text-xs text-text-secondary">
          <a href="/privacy" className="hover:underline">
            Privacy
          </a>{' '}
          ·{' '}
          <a href="/terms" className="hover:underline">
            Terms
          </a>
        </p>
      </main>
    </div>
  )
}
