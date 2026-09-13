import type { WebSearchResult } from '../types'
import { getToken } from '../services/sync/client'
import { parseSearchResults } from '../../../shared/llm/webSearch'

let lastSearchTime = 0

/**
 * Wykonuje wyszukiwanie web przez SearXNG z cooldownem.
 *
 * Zawsze przez `/searxng-proxy` na własnym origin (dev: Vite proxy plugin,
 * prod: Hono backend). Adres SearXNG w nagłówku `X-SearXNG-Target`.
 * Dzięki temu HTTPS strona może wołać HTTP SearXNG bez mixed content.
 *
 * Auth do proxy: `X-RP-Auth: Bearer <jwt>` — endpoint proxy wymaga
 * zalogowanego usera (patrz sync/src/proxy.ts).
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

  const syncToken = getToken()
  if (syncToken) headers['X-RP-Auth'] = `Bearer ${syncToken}`

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

    return parseSearchResults(data, maxResults)
  } catch (error) {
    console.error('Web search error:', error)
    throw error
  }
}
