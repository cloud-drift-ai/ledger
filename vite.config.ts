
import { createHash } from 'node:crypto'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE_PATH = '/ledger/'

function ledgerPagesSupport(): Plugin {
  return {
    name: 'ledger-github-pages-support',
    apply: 'build',

    generateBundle(_options, bundle) {
      const bundledAssets = Object.keys(bundle).filter(fileName =>
        fileName.startsWith('assets/') && !fileName.endsWith('.map')
      )

      const precacheUrls = [
        BASE_PATH,
        `${BASE_PATH}index.html`,
        `${BASE_PATH}favicon.svg`,
        `${BASE_PATH}icons.svg`,
        ...bundledAssets.map(fileName => `${BASE_PATH}${fileName}`),
      ]

      const buildHash = createHash('sha256')

      for (const fileName of Object.keys(bundle).sort()) {
        const output = bundle[fileName]
        buildHash.update(fileName)
        buildHash.update(
          output.type === 'chunk' ? output.code : output.source
        )
      }

      const cacheName =
        `ledger-app-shell-${buildHash.digest('hex').slice(0, 10)}`

      const serviceWorker = `
const CACHE_PREFIX = 'ledger-app-shell-'
const CACHE_NAME = '${cacheName}'
const BASE_PATH = '${BASE_PATH}'
const PRECACHE_URLS = ${JSON.stringify(precacheUrls)}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key =>
          key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME
        ).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', event => {
  if (event.data?.type === 'LEDGER_SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', event => {
  const request = event.request

  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok) return response
      } catch {}

      const cachedShell = await caches.match(
        new URL(BASE_PATH + 'index.html', self.location.origin).href
      )

      if (cachedShell) return cachedShell

      return new Response('Ledger is unavailable offline.', {
        status: 503
      })
    })())
    return
  }

  if (
    PRECACHE_URLS.includes(url.pathname) ||
    url.pathname.startsWith(BASE_PATH + 'assets/')
  ) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)

      if (cached) return cached

      const response = await fetch(request)

      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone())
      }

      return response
    })())
  }
})
`

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorker,
      })

    },

    // Create GitHub Pages' SPA fallback after Vite has written index.html.
    writeBundle(outputOptions) {
      const outputDir = resolve(outputOptions.dir ?? 'dist')
      const indexPath = resolve(outputDir, 'index.html')
      const fallbackPath = resolve(outputDir, '404.html')

      if (existsSync(indexPath)) {
        copyFileSync(indexPath, fallbackPath)
      }
    },
  }
}

export default defineConfig({
  base: BASE_PATH,
  plugins: [
    react(),
    tailwindcss(),
    ledgerPagesSupport(),
  ],
})
