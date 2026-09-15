import { Hono } from 'hono'
import { assertRefinerBudget } from '../../../shared/llm/refinerBudget'
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
import { createImageGenerator } from '../../../shared/llm/imageGen'
import { ReasoningParser, readReasoning } from '../../../shared/llm/reasoning'
import type { ImageInput, ImageToolCall } from '../../../shared/llm/imageTypes'
import { runImage } from './imageWorkflow'
import type { WorkflowProgress } from './runner'
import { saveBlob } from '../blobs'
import { PROXY_TIMEOUT_POST_MS } from '../config'
import { resolveModelImages, type ModelMessage } from '../../../shared/llm/messages'
import { findBlob, resolveBlobPath } from '../blobs'
import { readFile } from 'node:fs/promises'
import { prepareSummary } from './summaryPlan'
import { JobError, publicJob } from './store'

export const generationStore = new GenerationStore(db)
export const generationRunner = new GenerationRunner(generationStore, (userId, conversationId, job) => {
  broadcast(userId, { type: 'entity.changed', entityType: 'conversation', action: 'updated', id: conversationId })
  const request: StartJob = JSON.parse(job.request_json)
  if (!request.operation) {
    try { startSummary(userId, conversationId, request.profileId, crypto.randomUUID(), undefined, true) }
    catch (error) { console.warn('[summary] Nie uruchomiono automatycznego podsumowania:', error) }
  }
})

/** Private in-process route reuses existing allowlist, redirects and long timeout.
 * No loopback HTTP, saved JWT or browser connection is involved.
 */
export async function openModelResponse(userId: string, baseUrl: string, apiKey: string, body: unknown, signal: AbortSignal): Promise<Response> {
  const input = body as Record<string, unknown>
  const resolved = await resolveModelImages(input.messages as ModelMessage[], async id => {
    signal.throwIfAborted()
    const meta = findBlob(userId, id)
    if (!meta?.mime.startsWith('image/')) throw new Error('Zalacznik obrazu nie istnieje lub nie nalezy do uzytkownika.')
    const path = await resolveBlobPath(userId, id)
    if (!path) throw new Error('Brak pliku zalacznika.')
    const bytes = await readFile(path)
    signal.throwIfAborted()
    return `data:${meta.mime};base64,${bytes.toString('base64')}`
  })
  signal.throwIfAborted()
  const proxy = new Hono<AppEnv>()
  proxy.use('*', async (c, next) => { c.set('userId', userId); await next() })
  proxy.post('/llm-proxy/v1/chat/completions', makeProxyHandler('/llm-proxy', 'x-llm-target', signal))
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-LLM-Target': baseUrl }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  return proxy.request('/llm-proxy/v1/chat/completions', { method: 'POST', headers, body: JSON.stringify({ ...input, messages: resolved }) })
}

function readEntity(userId: string, type: string, id: string) {
  const row = db.query('SELECT data_json,updated_at FROM entities WHERE user_id=? AND type=? AND id=? AND deleted_at IS NULL').get(userId, type, id) as { data_json: string; updated_at: number } | null
  return row ? { data: JSON.parse(row.data_json), version: row.updated_at } : null
}

export function startSummary(userId: string, conversationId: string, profileId: string, id: string, expectedUpdatedAt?: number, automatic = false) {
  const previous = generationStore.get(userId, id)
  if (previous) {
    const input: StartJob = JSON.parse(previous.request_json)
    if (input.operation !== 'summary' || input.conversationId !== conversationId || input.profileId !== profileId || (expectedUpdatedAt !== undefined && input.expectedUpdatedAt !== expectedUpdatedAt)) throw new JobError('Identyfikator podsumowania zostal juz uzyty.')
    return publicJob(previous)
  }
  const row = readEntity(userId, 'conversation', conversationId)
  if (!row) throw new JobError('Rozmowa nie istnieje.', 404)
  if (expectedUpdatedAt !== undefined && row.version !== expectedUpdatedAt) throw new JobError('Rozmowa zmienila sie przed podsumowaniem.')
  const settings = readEntity(userId, 'settings', 'singleton')?.data ?? {}
  if (automatic && !settings.summarizerEnabled) return null
  if (automatic && generationStore.list(userId, conversationId).some(job => ['queued', 'running'].includes(job.status) && JSON.parse(job.request_json).operation === 'summary')) return null
  const character = readEntity(userId, 'character', row.data.characterId)?.data
  if (!character) throw new JobError('Nie znaleziono karty postaci.', 404)
  const personaRows = db.query("SELECT data_json FROM entities WHERE user_id=? AND type='persona' AND deleted_at IS NULL ORDER BY updated_at DESC").all(userId) as { data_json: string }[]
  const personas = personaRows.map(p => JSON.parse(p.data_json))
  const persona = personas.find(p => p.id === row.data.personaId) ?? personas.find(p => p.id === settings.defaultPersonaId) ?? personas[0]
  const messages = prepareSummary(row.data, settings, character, persona, automatic)
  if (!messages) { if (automatic) return null; throw new JobError('Brak nowych wiadomosci do podsumowania.', 400) }
  const profile = settings.aiProfiles?.find((p: any) => p.id === profileId)
  const model = settings.summarizerModel?.trim() || profile?.model
  if (!profile?.baseUrl?.trim() || !model) throw new JobError('Brak skonfigurowanego modelu podsumowania.', 400)
  const baseUrl = profile.baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
  const body: Record<string, unknown> = { model, messages, stream: true }
  for (const [key, wireKey] of Object.entries({ temperature: 'temperature', topP: 'top_p', topK: 'top_k', frequencyPenalty: 'frequency_penalty', presencePenalty: 'presence_penalty' })) {
    if (typeof profile.sampler?.[key] === 'number') body[wireKey] = profile.sampler[key]
  }
  if (profile.maxTokens > 0) body.max_tokens = profile.maxTokens
  const input: StartJob = { id, conversationId, targetMessageId: row.data.messages[row.data.messages.length - 1].id,
    mode: 'append', operation: 'summary', expectedUpdatedAt: row.version, profileId, messages }
  const { job, created } = generationStore.start(userId, input, { baseUrl, body })
  if (created) {
    generationStore.workflow(userId, id, 'summary')
    generationRunner.start(job, signal => openModelResponse(userId, baseUrl, profile.apiKey ?? '', body, signal))
  }
  return publicJob(generationStore.get(userId, id)!)
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
  apiKey: string, payload: Record<string, unknown>, settings: SearchSettings, image?: ImageExecution) {
  const enabled = () => {
    const row = db.query("SELECT data_json FROM entities WHERE user_id=? AND type='settings' AND id='singleton' AND deleted_at IS NULL").get(userId) as { data_json: string } | null
    return row ? JSON.parse(row.data_json).webSearchEnabled === true : false
  }
  return searchWorkflow({
    messages, enabled, showResults: settings.webSearchShowResults ?? true,
    open: (currentMessages, signal) => {
      const body: Record<string, unknown> = { ...payload, messages: currentMessages }
      const tools = (payload.tools as Array<{ function: { name: string } }> | undefined)?.filter(tool =>
        tool.function.name === 'web_search' ? enabled() : tool.function.name === 'generate_image' && imageEnabled(userId))
      if (tools?.length) body.tools = tools
      else { delete body.tools; delete body.tool_choice }
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
    image, imageEnabled: () => imageEnabled(userId),
  })
}

function imageEnabled(userId: string): boolean {
  const row = db.query("SELECT data_json FROM entities WHERE user_id=? AND type='settings' AND id='singleton' AND deleted_at IS NULL").get(userId) as { data_json: string } | null
  return row ? JSON.parse(row.data_json).imageGenEnabled === true : false
}
export type ImageExecution = (signal: AbortSignal, report: (state: WorkflowProgress) => void, label?: string) => Promise<ImageToolCall>

export function createImageExecution(userId: string, input: ImageInput, settings: any): { execute: ImageExecution; snapshot: unknown } {
  const profile = settings.aiProfiles?.find((p: any) => p.id === input.refinerProfileId)
  const refinerBody: Record<string, unknown> = { model: profile?.model, messages: input.refinerMessages, stream: false }
  // Match the existing adapter: sampler from the refiner profile, no tools.
  for (const [key, wireKey] of Object.entries({ temperature: 'temperature', topP: 'top_p', topK: 'top_k', frequencyPenalty: 'frequency_penalty', presencePenalty: 'presence_penalty' })) {
    if (typeof profile?.sampler?.[key] === 'number') refinerBody[wireKey] = profile.sampler[key]
  }
  if (profile?.maxTokens > 0) refinerBody.max_tokens = profile.maxTokens
  const baseUrl = typeof settings.imageGenBaseUrl === 'string' ? settings.imageGenBaseUrl : ''
  const responseFormat = settings.imageGenResponseFormat === 'b64_json' ? 'b64_json' : 'url'
  const refinerBase = typeof profile?.baseUrl === 'string' ? profile.baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '') : ''
  const generator = createImageGenerator(() => null, async (url, init) => {
    if (typeof url !== 'string' || !url.startsWith('/images-proxy/')) throw new Error('Nieprawidłowy adres obrazu z mostka.')
    const signal = init?.signal ?? undefined
    const proxy = new Hono<AppEnv>()
    proxy.use('*', async (c, next) => { c.set('userId', userId); await next() })
    proxy.all('/images-proxy/*', makeProxyHandler('/images-proxy', 'x-image-target', signal))
    const headers = new Headers(init?.headers)
    if (init?.method === 'POST') headers.set('X-RP-Image-Wait-Seconds', String(Math.max(60, Math.floor((PROXY_TIMEOUT_POST_MS - 30000) / 1000))))
    return proxy.request(url, { ...init, headers })
  })
  const execute: ImageExecution = (signal, report, label) => runImage({
    refine: async currentSignal => {
      if (!imageEnabled(userId)) throw new Error('Generowanie obrazów zostało wyłączone.')
      if (!refinerBase || !profile?.model) throw new Error('Brak skonfigurowanego profilu refinera.')
      assertRefinerBudget((input.refinerMessages ?? []).map(message => message.content).join(''), profile.contextLength, profile.maxTokens)
      const response = await openModelResponse(userId, refinerBase, profile.apiKey ?? '', refinerBody, currentSignal)
      if (!response.ok) throw new Error(`Refiner: HTTP ${response.status} ${(await response.text()).slice(0, 600)}`)
      const data = await response.json() as any
      if (data.error) throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Błąd refinera')
      const message = data.choices?.[0]?.message
      let content = '', thinking = readReasoning(message)
      const parser = new ReasoningParser(text => { content += text }, text => { thinking += text })
      parser.push(typeof message?.content === 'string' ? message.content : ''); parser.finish()
      return content.trim() ? content : thinking
    },
    generate: (prompt, currentSignal) => generator(prompt, { baseUrl, responseFormat, signal: currentSignal }),
    save: async (blob, currentSignal) => {
      currentSignal.throwIfAborted()
      const meta = await saveBlob(userId, new Uint8Array(await blob.arrayBuffer()), blob.type || 'image/png')
      currentSignal.throwIfAborted()
      return meta.sha256
    },
  }, signal, report, input.prompt, label || 'Wygenerowany obraz')
  return { execute, snapshot: { baseUrl, responseFormat, ...(input.prompt === undefined ? { refinerBase, refinerBody } : { prompt: input.prompt }) } }
}
