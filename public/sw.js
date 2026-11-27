/* Fallback service worker source for Ledger's GitHub Pages project site.
   The production Vite plugin generates the versioned worker in dist/sw.js. */
const CACHE_PREFIX = 'ledger-app-shell-'
const CACHE_NAME = 'ledger-app-shell-fallback-4'
const BASE_PATH = '/ledger/'
const STATIC_URLS = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}favicon.svg`,
  `${BASE_PATH}icons.svg`,
  `${BASE_PATH}apple-touch-icon.png`,
  `${BASE_PATH}ledger-192.png`,
  `${BASE_PATH}ledger-512.png`,
  `${BASE_PATH}ledger-maskable-512.png`,
]

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    const response = await fetch(`${BASE_PATH}index.html`, { cache: 'reload' })
    if (!response.ok) throw new Error('Could not load the Ledger application shell.')

    await cache.put(`${BASE_PATH}index.html`, response.clone())

    const html = await response.text()
    const assetUrls = [...html.matchAll(/(?:src|href)=["'](\/ledger\/assets\/[^"']+)["']/g)]
      .map(match => match[1])

    await cache.addAll([...new Set([...STATIC_URLS, ...assetUrls])])
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

      const cache = await caches.open(CACHE_NAME)
      return (await cache.match(`${BASE_PATH}index.html`)) || new Response(
        'Ledger is unavailable offline.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
      )
    })())
    return
  }

  if (
    STATIC_URLS.includes(url.pathname) ||
    url.pathname.startsWith(`${BASE_PATH}assets/`)
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
