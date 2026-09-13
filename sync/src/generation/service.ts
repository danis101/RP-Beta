import { Hono } from 'hono'
import { db } from '../db'
import { broadcast } from '../ws'
import { makeProxyHandler } from '../proxy'
import type { AppEnv } from '../auth'
import { GenerationStore } from './store'
import { GenerationRunner } from './runner'

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
