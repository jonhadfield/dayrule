import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

// Production and every preview are separate origins, so separate installed
// apps: previews get their own name and inverted icon (PLAN.md §14).
const production = process.env.VERCEL_ENV === 'production'
const name = production ? 'Dayrule' : 'Dayrule preview'
const icon = production ? '' : '-preview'
// Exposed as import.meta.env.VITE_APP_VERSION (a plain `define` global
// isn't substituted in dev).
process.env.VITE_APP_VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev'

// Subresource Integrity (PLAN.md §10.7): every script and stylesheet tag in
// index.html gets an integrity hash of the exact file built, so a changed
// file on the CDN is refused rather than run.
function sri(): Plugin {
  return {
    name: 'dayrule-sri',
    apply: 'build',
    // Last, once Vite has finished rewriting chunks (preload markers), so
    // the hashes match the files exactly as written.
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        // The crypto worker can't carry an integrity attribute: write its
        // hash into the bundle that starts it (src/crypto/client.ts), which
        // is itself hashed below.
        const placeholder = '__DAYRULE_WORKER_INTEGRITY__'
        const worker = Object.values(bundle).filter((o) =>
          /^assets\/worker-[^/]+\.js$/.test(o.fileName),
        )
        const users = Object.values(bundle).filter(
          (o) => o.type === 'chunk' && o.code.includes(placeholder),
        )
        if (worker.length !== 1 || users.length !== 1)
          throw new Error(
            `SRI: expected one crypto worker and one chunk starting it, found ${worker.length} and ${users.length}`,
          )
        const [w] = worker
        const [user] = users
        if (user?.type === 'chunk' && w) {
          const hash = createHash('sha384')
            .update(w.type === 'chunk' ? w.code : w.source)
            .digest('base64')
          user.code = user.code.replaceAll(placeholder, hash)
        }

        const page = bundle['index.html']
        if (!page || page.type !== 'asset') return
        page.source = String(page.source).replace(
          /<(script|link)\b([^>]*?)\s(src|href)="\/(assets\/[^"]+)"([^>]*)>/g,
          (
            tag,
            name: string,
            before: string,
            attr: string,
            file: string,
            after: string,
          ) => {
            if (/integrity=/.test(tag)) return tag
            if (
              name === 'link' &&
              !/rel="(stylesheet|modulepreload)"/.test(tag)
            )
              return tag
            const out = bundle[file]
            if (!out) throw new Error(`SRI: ${file} is not in the bundle`)
            const content = out.type === 'chunk' ? out.code : out.source
            const hash = createHash('sha384').update(content).digest('base64')
            return `<${name}${before} ${attr}="/${file}" integrity="sha384-${hash}"${after}>`
          },
        )
      },
    },
  }
}

// `vite preview` sends production's global headers (vercel.json), so the
// perf and worker checks in CI run under the real CSP, Trusted Types and
// cross-origin isolation. Not in dev: the CSP would block Vite's client.
function productionHeaders(): Record<string, string> {
  const vercel = JSON.parse(
    readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
  ) as {
    headers: {
      source: string
      has?: unknown
      missing?: unknown
      headers: { key: string; value: string }[]
    }[]
  }
  const global = vercel.headers.find(
    (r) => r.source === '/(.*)' && !r.has && !r.missing,
  )
  return Object.fromEntries(global?.headers.map((h) => [h.key, h.value]) ?? [])
}

// https://vite.dev/config/
export default defineConfig({
  preview: { headers: productionHeaders() },
  plugins: [
    react(),
    tailwindcss(),
    sri(),
    {
      name: 'dayrule-icons',
      transformIndexHtml: (html) => html.replaceAll('%ICON%', icon),
    },
    VitePWA({
      // Registered by src/app/pwa.ts through the Trusted Types policy.
      injectRegister: false,
      registerType: 'prompt',
      // Our own worker (src-sw/sw.ts) for reminder notifications, bundled
      // into one file: no importScripts, a Trusted Types sink.
      strategies: 'injectManifest',
      srcDir: 'src-sw',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // The crypto worker embeds libsodium's WebAssembly (~660 KB).
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        id: '/',
        lang: 'en-GB',
        name,
        short_name: name,
        description: 'A calm, end-to-end encrypted task manager.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f7f3ec',
        theme_color: '#f7f3ec',
        icons: [
          {
            src: `/icons/icon${icon}-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `/icons/icon${icon}-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `/icons/maskable${icon}-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          {
            name: 'New to-do',
            short_name: 'New',
            url: '/inbox?add=1',
            icons: [{ src: `/icons/icon${icon}-192.png`, sizes: '192x192' }],
          },
        ],
        // Android: share text/URL into Inbox (PLAN.md §8.3 / §8.4).
        share_target: {
          action: '/inbox',
          method: 'GET',
          enctype: 'application/x-www-form-urlencoded',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
          },
        },
      },
    }),
  ],
  server: {
    // The Go API runs separately in development (see AGENTS.md).
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
