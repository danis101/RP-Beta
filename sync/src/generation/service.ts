import { Hono } from 'hono'
import { db } from '../db'
import { broadcast } from '../ws'
import { makeProxyHandler } from '../proxy'
import type { AppEnv } from '../auth'
import { GenerationStore } from './store'
import { GenerationRunner } from './runner'
import { searchWorkflow } from './searchWorkflow'
import type { StartJob } from './store'
import { parseSearchResults } from '../../../shared/llm/webSearch'
import { setTimeout as delay } from 'node:timers/promises'

export const generationStore = new GenerationStore(db)
export const generationRunner = new GenerationRunner(generationStore, (userId, conversationId) => {
  broadcast(userId, { type: 'entity.changed', entityType: 'conversation', action: 'updated', id: conversationId })
})

/** Private in-process route reuses existing allowlist, redirects and long timeout.
 * No loopback HTTP, saved JWT or browser connection is involved.
 */
export function openModelResponse(userId: string, baseUrl: string, apiKey: string, body: unknown, signal: AbortSignal): Promise<Response> {
  const proxy = new Hono<AppEnv>()
  proxy.use('*', async (c, next) => { c.set('userId', userId); await next() })
  proxy.post('/llm-proxy/v1/chat/completions', makeProxyHandler('/llm-proxy', 'x-llm-target', signal))
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-LLM-Target': baseUrl }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return Promise.resolve(proxy.request('/llm-proxy/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify(body) }))
}

export interface SearchSettings {
  webSearchUrl: string
  webSearchApiKey?: string
  webSearchMaxResults?: number
  webSearchCooldown?: number
  webSearchShowResults?: boolean
}
const lastSearch = new Map<string, number>()

export function createSearchWorkflow(userId: string, messages: StartJob['messages'], baseUrl: string,
  apiKey: string, payload: Record<string, unknown>, settings: SearchSettings) {
  const enabled = () => {
    const row = db.query("SELECT data_json FROM entities WHERE user_id=? AND type='settings' AND id='singleton' AND deleted_at IS NULL").get(userId) as { data_json: string } | null
    return row ? JSON.parse(row.data_json).webSearchEnabled === true : false
  }
  return searchWorkflow({
    messages, enabled, showResults: settings.webSearchShowResults ?? true,
    open: (currentMessages, signal) => {
      const body: Record<string, unknown> = { ...payload, messages: currentMessages }
      if (!enabled()) { delete body.tools; delete body.tool_choice }
      return openModelResponse(userId, baseUrl, apiKey, body, signal)
    },
    search: async (query, signal) => {
      const now = Date.now()
      const scheduled = Math.max(now, (lastSearch.get(userId) ?? 0) + (settings.webSearchCooldown ?? 1) * 1000)
      lastSearch.set(userId, scheduled)
      if (scheduled > now) await delay(scheduled - now, undefined, { signal })
      signal.throwIfAborted()
      if (!enabled()) return []
      const proxy = new Hono<AppEnv>()
      proxy.use('*', async (c, next) => { c.set('userId', userId); await next() })
      proxy.get('/searxng-proxy/search', makeProxyHandler('/searxng-proxy', 'x-searxng-target', signal))
      const headers: Record<string, string> = { Accept: 'application/json', 'X-SearXNG-Target': settings.webSearchUrl.replace(/\/+$/, '') }
      if (settings.webSearchApiKey) headers.Authorization = `Bearer ${settings.webSearchApiKey}`
      const response = await proxy.request(`/searxng-proxy/search?q=${encodeURIComponent(query)}&format=json`, { headers })
      if (!response.ok) {
        if (response.status === 429) throw new Error('Zbyt wiele zapytań – spróbuj ponownie za chwilę.')
        throw new Error(`SearXNG error: ${response.status} ${response.statusText}`)
      }
      return parseSearchResults(await response.json(), settings.webSearchMaxResults ?? 5)
    },
  })
}
