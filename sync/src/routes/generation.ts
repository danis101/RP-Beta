import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { authMiddleware, type AppEnv } from '../auth'
import { db } from '../db'
import { generationRunner, generationStore, openModelResponse, createSearchWorkflow, type SearchSettings } from '../generation/service'
import { webSearchDeclaration } from '../../../shared/llm/webSearch'
import { JobError, publicJob, type StartJob } from '../generation/store'

export const generationRoutes = new Hono<AppEnv>()
generationRoutes.use('*', authMiddleware)
generationRoutes.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024 }))
generationRoutes.get('/', c => {
  const conversationId = c.req.query('conversationId')
  if (!conversationId) return c.json({ error: 'Podaj conversationId.' }, 400)
  return c.json({ items: generationStore.list(c.get('userId'), conversationId).map(publicJob) })
})
generationRoutes.get('/:id', c => {
  const job = generationStore.get(c.get('userId'), c.req.param('id'))
  return job ? c.json(publicJob(job)) : c.json({ error: 'Zadanie nie istnieje.' }, 404)
})
generationRoutes.post('/:id/cancel', c => {
  const job = generationRunner.cancel(c.get('userId'), c.req.param('id'))
  return job ? c.json(publicJob(job)) : c.json({ error: 'Zadanie nie istnieje.' }, 404)
})
generationRoutes.post('/', async c => {
  const body = await c.req.json().catch(() => null)
  const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128
  if (!body || !validId(body.id) || !validId(body.conversationId) || !validId(body.targetMessageId) || !validId(body.profileId) ||
      !['append', 'regenerate'].includes(body.mode) || !Number.isSafeInteger(body.expectedUpdatedAt) ||
      (body.webSearch !== undefined && typeof body.webSearch !== 'boolean') ||
      !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 4096 ||
      body.messages.some((message: any) => !message || !['system', 'user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string' || message.tool_calls || message.tool_call_id) || body.tools?.length) {
    return c.json({ error: 'Nieprawidlowe zadanie. Przyjmowany jest prompt tekstowy, opcjonalnie z webSearch; bez obrazow i wlasnych deklaracji narzedzi.' }, 400)
  }
  const request: StartJob = {
    id: body.id, conversationId: body.conversationId, targetMessageId: body.targetMessageId,
    mode: body.mode, expectedUpdatedAt: body.expectedUpdatedAt, profileId: body.profileId,
    messages: body.messages.map((message: any) => ({ role: message.role, content: message.content })),
    ...(body.webSearch === true ? { webSearch: true as const } : {}),
  }
  const userId = c.get('userId')
  try {
    const previous = generationStore.get(userId, request.id)
    if (previous) {
      if (previous.request_json !== JSON.stringify(request)) throw new JobError('Ten identyfikator zadania zostal juz uzyty z innymi danymi.')
      return c.json(publicJob(previous))
    }
    const row = db.query("SELECT data_json FROM entities WHERE user_id=? AND type='settings' AND id='singleton' AND deleted_at IS NULL").get(userId) as { data_json: string } | null
    const settings = row ? JSON.parse(row.data_json) : null
    const profile = settings?.aiProfiles?.find((item: any) => item.id === request.profileId)
    if (!profile || typeof profile.baseUrl !== 'string' || !profile.baseUrl.trim() || typeof profile.model !== 'string' || !profile.model.trim()) {
      return c.json({ error: 'Zapisany profil API nie jest skonfigurowany.' }, 400)
    }
    const payload: Record<string, unknown> = { model: profile.model, messages: request.messages, stream: true }
    let searchSettings: SearchSettings | undefined
    if (request.webSearch) {
      if (settings.webSearchEnabled !== true) throw new JobError('Wyszukiwanie jest wylaczone w zapisanych ustawieniach.', 400)
      searchSettings = {
        webSearchUrl: typeof settings.webSearchUrl === 'string' ? settings.webSearchUrl : '',
        webSearchApiKey: typeof settings.webSearchApiKey === 'string' ? settings.webSearchApiKey : undefined,
        webSearchMaxResults: Number.isFinite(settings.webSearchMaxResults) ? settings.webSearchMaxResults : 5,
        webSearchCooldown: Number.isFinite(settings.webSearchCooldown) ? Math.max(0, settings.webSearchCooldown) : 1,
        webSearchShowResults: settings.webSearchShowResults !== false,
      }
      payload.tools = [webSearchDeclaration]
      payload.tool_choice = 'auto'
    }
    for (const [key, wireKey] of Object.entries({ temperature: 'temperature', topP: 'top_p', topK: 'top_k', frequencyPenalty: 'frequency_penalty', presencePenalty: 'presence_penalty' })) {
      const value = profile.sampler?.[key]
      if (typeof value === 'number' && Number.isFinite(value)) payload[wireKey] = value
    }
    if (typeof profile.maxTokens === 'number' && Number.isFinite(profile.maxTokens) && profile.maxTokens > 0) payload.max_tokens = profile.maxTokens
    const baseUrl = profile.baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '')
    const apiKey = typeof profile.apiKey === 'string' ? profile.apiKey.trim() : ''
    const { webSearchApiKey: _secret, ...searchSnapshot } = searchSettings ?? {}
    const { job, created } = generationStore.start(userId, request, { baseUrl, body: payload, ...(searchSettings ? { search: searchSnapshot } : {}) })
    if (created) generationRunner.start(job, signal => openModelResponse(userId, baseUrl, apiKey, payload, signal),
      searchSettings ? createSearchWorkflow(userId, request.messages, baseUrl, apiKey, payload, searchSettings) : undefined)
    return c.json(publicJob(generationStore.get(userId, job.id)!), created ? 202 : 200)
  } catch (error) {
    if (error instanceof JobError) return c.json({ error: error.message }, error.status)
    throw error
  }
})
