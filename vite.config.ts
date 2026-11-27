import { createHash } from 'node:crypto'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function ledgerServiceWorker(): Plugin {
  return {
    name: 'ledger-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const bundledAssets = Object.keys(bundle).filter(fileName =>
        fileName.startsWith('assets/') && !fileName.endsWith('.map')
      )

      const precacheUrls = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/favicon.svg',
        '/icons/ledger-192.png',
        '/icons/ledger-512.png',
        '/icons/ledger-maskable-512.png',
        ...bundledAssets.map(fileName => `/${fileName}`),
      ]

      const buildHash = createHash('sha256')
      for (const fileName of Object.keys(bundle).sort()) {
        const output = bundle[fileName]
        buildHash.update(fileName)
        buildHash.update(output.type === 'chunk' ? output.code : output.source)
      }
      const cacheName = `ledger-app-shell-${buildHash.digest('hex').slice(0, 10)}`

      const serviceWorker = `/* Ledger PWA 1.0 — app shell only. Financial/API responses are never cached. */
const CACHE_PREFIX = 'ledger-app-shell-'
const CACHE_NAME = '${cacheName}'
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS))
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'LEDGER_SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  // Never cache authentication, database, storage, realtime or function APIs.
  const privateApiPaths = [
    '/auth/v1/',
    '/rest/v1/',
    '/storage/v1/',
    '/functions/v1/',
    '/realtime/v1/',
    '/api/',
  ]
  if (privateApiPaths.some(path => url.pathname.startsWith(path))) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cachedShell = await caches.match(new URL('/index.html', self.location.origin).href)
        if (cachedShell) return cachedShell
        return new Response(
          '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ledger offline</title></head><body style="font-family:system-ui;padding:2rem"><h1>Ledger</h1><p>The application shell is not available offline yet. Reconnect to the internet and open Ledger once to prepare it for offline launch.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      })
    )
    return
  }

  // Serve the precached manifest, favicon and app icons from the app-shell cache.
  if (PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response && response.ok && response.type === 'basic') {
        await cache.put(request, response.clone())
      }
      return response
    })())
    return
  }

  // Cache only the versioned, same-origin application build assets.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)
      if (cached) return cached

      const response = await fetch(request)
      if (response && response.ok && response.type === 'basic') {
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
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ledgerServiceWorker()],
})
