/* Ledger Offline 3.0 — application shell only.
   Financial, authentication and Supabase API responses are never cached. */
const CACHE_PREFIX = 'ledger-app-shell-'
const CACHE_NAME = 'ledger-app-shell-offline-3-0'
const STATIC_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/ledger-192.png',
  '/ledger-512.png',
  '/ledger-maskable-512.png',
]

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    const response = await fetch('/index.html', { cache: 'reload' })
    if (!response.ok) throw new Error('Could not load the Ledger application shell.')
    await cache.put('/index.html', response.clone())

    const html = await response.text()
    const assetUrls = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)]
      .map(match => match[1])
    const uniqueAssets = [...new Set(assetUrls)]
    await cache.addAll(STATIC_URLS)
    if (uniqueAssets.length) await cache.addAll(uniqueAssets)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map(key => caches.delete(key))
    )
    await self.clients.claim()
  })())
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
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response && response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put('/index.html', response.clone())
        }
        return response
      } catch {
        const cache = await caches.open(CACHE_NAME)
        return (await cache.match('/index.html')) || new Response(
          '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ledger offline</title></head><body style="font-family:system-ui;padding:2rem"><h1>Ledger</h1><p>The application shell is not available offline yet. Reconnect and open Ledger once to prepare it.</p></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      }
    })())
    return
  }

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
    return
  }

  if (STATIC_URLS.includes(url.pathname)) {
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
