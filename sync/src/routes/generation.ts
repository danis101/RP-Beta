import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { authMiddleware, type AppEnv } from '../auth'
import { db } from '../db'
import { generationRunner, generationStore, openModelResponse, createSearchWorkflow, createImageExecution, startSummary, type SearchSettings } from '../generation/service'
import { validModelMessage } from '../../../shared/llm/messages'
import { webSearchDeclaration } from '../../../shared/llm/webSearch'
import { imageDeclaration, type ImageInput } from '../../../shared/llm/imageTypes'
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
      (body.operation !== undefined && !['image', 'summary'].includes(body.operation)) ||
      (body.historyTailId !== undefined && !validId(body.historyTailId)) ||
      !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 4096 ||
      body.messages.some((message: any) => !validModelMessage(message)) || body.tools?.length) {
    return c.json({ error: 'Nieprawidlowe zadanie. Dozwolony jest tekst i zalaczniki image_url jako rp-blob lub data URL; bez wlasnych deklaracji narzedzi.' }, 400)
  }
  let image: ImageInput | undefined
  if (body.image !== undefined) {
    const value = body.image
    if (!value || typeof value !== 'object') return c.json({ error: 'Nieprawidlowe dane obrazu.' }, 400)
    if (value.prompt !== undefined) {
      if (typeof value.prompt !== 'string' || !value.prompt.trim() || body.operation !== 'image' || body.mode !== 'regenerate') return c.json({ error: 'Zapisany prompt jest dozwolony tylko przy regeneracji obrazu.' }, 400)
      image = { prompt: value.prompt }
    } else {
      if (!validId(value.refinerProfileId) || !Array.isArray(value.refinerMessages) || value.refinerMessages.length !== 2 ||
        value.refinerMessages.some((m: any, i: number) => m?.role !== (i === 0 ? 'system' : 'user') || typeof m.content !== 'string')) return c.json({ error: 'Brak gotowego kontekstu refinera.' }, 400)
      image = { refinerProfileId: value.refinerProfileId, refinerMessages: value.refinerMessages.map((m: any) => ({ role: m.role, content: m.content })) }
    }
  }
  if (body.operation === 'image' && !image) return c.json({ error: 'Brak danych zadania obrazu.' }, 400)
  const request: StartJob = {
    id: body.id, conversationId: body.conversationId, targetMessageId: body.targetMessageId,
    mode: body.mode, expectedUpdatedAt: body.expectedUpdatedAt, profileId: body.profileId,
    messages: body.messages.map((message: any) => ({ role: message.role, content: message.content })),
    ...(body.webSearch === true ? { webSearch: true as const } : {}),
    ...(image ? { image } : {}),
    ...(body.operation === 'image' ? { operation: 'image' as const } : {}),
    ...(body.historyTailId ? { historyTailId: body.historyTailId } : {}),
  }
  const userId = c.get('userId')
  try {
    if (body.operation === 'summary') {
      if (body.mode !== 'append' || body.image || body.webSearch || body.historyTailId) throw new JobError('Nieprawidlowe parametry podsumowania.', 400)
      return c.json(startSummary(userId, body.conversationId, body.profileId, body.id, body.expectedUpdatedAt), 202)
    }
    const previous = generationStore.get(userId, request.id)
    if (previous) {
      if (previous.request_json !== JSON.stringify(request)) throw new JobError('Ten identyfikator zadania zostal juz uzyty z innymi danymi.')
      return c.json(publicJob(previous))
    }
    const row = db.query("SELECT data_json FROM entities WHERE user_id=? AND type='settings' AND id='singleton' AND deleted_at IS NULL").get(userId) as { data_json: string } | null
    const settings = row ? JSON.parse(row.data_json) : null
    const profile = settings?.aiProfiles?.find((item: any) => item.id === request.profileId)
    if (request.operation !== 'image' && (!profile || typeof profile.baseUrl !== 'string' || !profile.baseUrl.trim() || typeof profile.model !== 'string' || !profile.model.trim())) {
      return c.json({ error: 'Zapisany profil API nie jest skonfigurowany.' }, 400)
    }
    const payload: Record<string, unknown> = { model: profile?.model, messages: request.messages, stream: true }
    if (image && image.prompt === undefined && settings?.imageGenEnabled !== true) throw new JobError('Generowanie obrazow jest wylaczone.', 400)
    const imageExecution = image ? createImageExecution(userId, image, settings ?? {}) : undefined
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
    if (image && request.operation !== 'image') {
      payload.tools = [...(payload.tools as unknown[] ?? []), imageDeclaration]
      payload.tool_choice = 'auto'
    }
    for (const [key, wireKey] of Object.entries({ temperature: 'temperature', topP: 'top_p', topK: 'top_k', frequencyPenalty: 'frequency_penalty', presencePenalty: 'presence_penalty' })) {
      const value = profile?.sampler?.[key]
      if (typeof value === 'number' && Number.isFinite(value)) payload[wireKey] = value
    }
    if (typeof profile?.maxTokens === 'number' && Number.isFinite(profile.maxTokens) && profile.maxTokens > 0) payload.max_tokens = profile.maxTokens
    const baseUrl = typeof profile?.baseUrl === 'string' ? profile.baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '') : ''
    const apiKey = typeof profile?.apiKey === 'string' ? profile.apiKey.trim() : ''
    const { webSearchApiKey: _secret, ...searchSnapshot } = searchSettings ?? {}
    const { job, created } = generationStore.start(userId, request, { baseUrl, body: payload, ...(searchSettings ? { search: searchSnapshot } : {}), ...(imageExecution ? { image: imageExecution.snapshot } : {}) })
    if (created) generationRunner.start(job, signal => openModelResponse(userId, baseUrl, apiKey, payload, signal),
      request.operation === 'image' ? async (signal, report) => ({ content: '', thinking: '', phase: 'image-result', toolCall: await imageExecution!.execute(signal, report) })
        : searchSettings || imageExecution ? createSearchWorkflow(userId, request.messages, baseUrl, apiKey, payload, searchSettings ?? { webSearchUrl: '' }, imageExecution?.execute) : undefined)
    return c.json(publicJob(generationStore.get(userId, job.id)!), created ? 202 : 200)
  } catch (error) {
    if (error instanceof JobError) return c.json({ error: error.message }, error.status)
    throw error
  }
})
