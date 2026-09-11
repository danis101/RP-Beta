import type { WebSearchResult } from '../types'

let lastSearchTime = 0

/**
 * Wykonuje wyszukiwanie web przez SearXNG z cooldownem.
 *
 * Zawsze przez `/searxng-proxy` na własnym origin (dev: Vite proxy plugin,
 * prod: Hono backend). Adres SearXNG w nagłówku `X-SearXNG-Target`.
 * Dzięki temu HTTPS strona może wołać HTTP SearXNG bez mixed content.
 */
export async function searchWeb(
  query: string,
  searchUrl: string,
  maxResults: number = 5,
  apiKey?: string,
  cooldown: number = 1,
): Promise<WebSearchResult[]> {
  if (!query.trim()) return []

  // Cooldown
  const now = Date.now()
  const elapsed = (now - lastSearchTime) / 1000
  if (elapsed < cooldown) {
    const waitMs = (cooldown - elapsed) * 1000
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  lastSearchTime = Date.now()

  const cleanBase = searchUrl.replace(/\/+$/, '')
  const path = `/search?q=${encodeURIComponent(query)}&format=json`
  const url = `/searxng-proxy${path}`

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'X-SearXNG-Target': cleanBase,
  }

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  try {
    const response = await fetch(url, {
      headers,
      credentials: 'omit',
    })

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Zbyt wiele zapytań – spróbuj ponownie za chwilę.')
      }
      throw new Error(`SearXNG error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()

    if (data.results && data.results.length > 0) {
      console.debug('SearXNG sample result:', data.results[0])
    }

    const results: WebSearchResult[] = (data.results || [])
      .slice(0, maxResults)
      .map((r: any) => ({
        title: r.title || r.url || 'Bez tytułu',
        url: r.url || '#',
        snippet: r.content || r.snippet || '',
        source: r.engine || 'SearXNG',
      }))

    if (results.length === 0 && data.infoboxes && data.infoboxes.length > 0) {
      for (const info of data.infoboxes) {
        if (info.infobox) {
          results.push({
            title: info.infobox,
            url: info.id || info.url || '#',
            snippet: info.content || '',
            source: 'Infobox',
          })
        }
        if (results.length >= maxResults) break
      }
    }

    return results
  } catch (error) {
    console.error('Web search error:', error)
    throw error
  }
}
