import type { ApiAdapter, SendMessageParams, StreamCallbacks, ListModelsResult, ModelInfo } from './types'
import type { ApiProfile, APIToolCall } from '../../types'
import { getToken } from '../sync/client'

export interface OpenAIConfig {
  baseUrl: string
  apiKey: string
  model: string
  sampler?: ApiProfile['sampler']
  maxTokens?: number
  streamingEnabled?: boolean
  visionEnabled?: boolean
  visionModel?: string
}

export interface OpenAIMessage {
  role: string
  content: string | any[]
  tool_calls?: APIToolCall[]
  tool_call_id?: string
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
    }
  }
}

/**
 * OpenAI-compatible adapter (Chat Completions with SSE + /v1/models).
 *
 * apiKey is OPTIONAL. LM Studio, Ollama, llama.cpp and many local backends
 * do not require a key.
 *
 * Proxy: all requests go through `/llm-proxy/...` on the same origin.
 * Target address is passed in the `X-LLM-Target` header.
 * Auth to proxy: `X-RP-Auth: Bearer <jwt>` (JWT sync, oddzielony od
 * `Authorization`, który niesie klucz API do LM Studio).
 *
 * Model list: tries LM Studio native `/api/v0/models` first, then falls
 * back to universal `/v1/models`.
 *
 * Reasoning fallback:
 *   Some models (DeepSeek R1, QwQ, Qwen3-thinking, GLM-Z1) split their
 *   output into `reasoning_content` and `content`. If `max_tokens` is too
 *   small, the reasoning part eats the whole budget and `content` is empty.
 *   For non-streaming calls (used by the image refiner) this would silently
 *   return "" and break downstream logic. We fall back to `reasoning_content`
 *   when `content` is empty. Not ideal output, but better than nothing.
 */
export class OpenAIAdapter implements ApiAdapter {
  id = 'openai'
  name = 'OpenAI'

  constructor(private config: OpenAIConfig) {}

  isConfigured(): boolean {
    return Boolean(this.config.baseUrl.trim() && this.config.model.trim())
  }

  private normalizedBase(): string {
    let base = this.config.baseUrl.trim().replace(/\/+$/, '')
    if (/\/v1$/.test(base)) base = base.replace(/\/v1$/, '')
    return base
  }

  private resolve(path: string): { url: string; headers: Record<string, string> } {
    const cleanBase = this.normalizedBase()
    const headers: Record<string, string> = { 'X-LLM-Target': cleanBase }
    // Proxy wymaga zalogowanego usera RP — JWT sync w dedykowanym nagłówku.
    const token = getToken()
    if (token) headers['X-RP-Auth'] = `Bearer ${token}`
    return { url: `/llm-proxy${path}`, headers }
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {}
    if (this.config.apiKey.trim()) {
      headers.Authorization = `Bearer ${this.config.apiKey.trim()}`
    }
    return headers
  }

  private samplerBody(): Record<string, unknown> {
    const sampler = this.config.sampler ?? {}
    const body: Record<string, unknown> = {}
    if (sampler.temperature !== undefined) body.temperature = sampler.temperature
    if (sampler.topP !== undefined) body.top_p = sampler.topP
    if (sampler.topK !== undefined) body.top_k = sampler.topK
    if (sampler.frequencyPenalty !== undefined) body.frequency_penalty = sampler.frequencyPenalty
    if (sampler.presencePenalty !== undefined) body.presence_penalty = sampler.presencePenalty
    if (this.config.maxTokens !== undefined && this.config.maxTokens > 0) {
      body.max_tokens = this.config.maxTokens
    }
    return body
  }

  private getModel(paramsModel?: string): string {
    if (paramsModel) return paramsModel
    if (this.config.visionEnabled && this.config.visionModel) {
      return this.config.visionModel
    }
    return this.config.model
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error('OpenAI adapter nie jest skonfigurowany - uzupelnij Base URL i model.')
    }

    const { url, headers: proxyHeaders } = this.resolve('/v1/chat/completions')
    const model = this.getModel(params.model)

    const body: any = {
      model,
      messages: params.messages as unknown as OpenAIMessage[],
      stream: false,
      ...this.samplerBody(),
    }

    if (params.tools?.length) {
      body.tools = params.tools
      body.tool_choice = 'auto'
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
        ...proxyHeaders,
      },
      body: JSON.stringify(body),
      signal: params.signal,
    })

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      throw new Error(`OpenAI API ${response.status}: ${bodyText.slice(0, 300)}`)
    }

    const data = await response.json()
    const choice = data.choices?.[0]
    const message = choice?.message

    // Tool calls: some backends return them as content but most use this field.
    if (message?.tool_calls && message.tool_calls.length > 0) {
      return JSON.stringify({
        content: message.content || '',
        tool_calls: message.tool_calls,
      })
    }

    const content = typeof message?.content === 'string' ? message.content : ''
    const reasoning =
      typeof message?.reasoning_content === 'string'
        ? message.reasoning_content
        : typeof message?.reasoning === 'string'
          ? message.reasoning
          : typeof message?.thinking === 'string'
            ? message.thinking
            : ''

    // Fallback: model spent its entire token budget on reasoning and produced
    // no content. Use reasoning as content so downstream logic does not
    // silently get an empty string. Not perfect, but avoids silent failure.
    if (!content.trim() && reasoning.trim()) {
      if (import.meta.env.DEV) {
        console.warn(
          '[OpenAIAdapter] content pusty (model zużył budżet na reasoning). ' +
            'Używam reasoning_content jako fallback. Zwiększ max_tokens w profilu.',
        )
      }
      return reasoning
    }

    return content
  }

  async streamMessage(params: SendMessageParams, callbacks: StreamCallbacks): Promise<void> {
    if (!this.isConfigured()) {
      callbacks.onError(new Error('OpenAI adapter nie jest skonfigurowany - uzupelnij Base URL i model.'))
      return
    }

    const { url, headers: proxyHeaders } = this.resolve('/v1/chat/completions')
    const model = this.getModel(params.model)

    const body: any = {
      model,
      messages: params.messages as unknown as OpenAIMessage[],
      stream: true,
      ...this.samplerBody(),
    }

    if (params.tools?.length) {
      body.tools = params.tools
      body.tool_choice = 'auto'
    }

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.authHeaders(),
          ...proxyHeaders,
        },
        body: JSON.stringify(body),
        signal: params.signal,
      })
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)))
      return
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      callbacks.onError(new Error(`OpenAI API ${response.status}: ${bodyText.slice(0, 300)}`))
      return
    }

    if (!response.body) {
      callbacks.onError(new Error('Brak body w odpowiedzi streamujacej.'))
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let accumulatedContent = ''
    let toolCalls: APIToolCall[] = []
    let toolCallInProgress: APIToolCall | null = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''

        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data:')) continue

          const payload = line.slice(5).trim()
          if (payload === '[DONE]') {
            if (toolCalls.length > 0 && callbacks.onToolCalls) {
              callbacks.onToolCalls(toolCalls)
            }
            callbacks.onDone()
            return
          }

          try {
            const json = JSON.parse(payload)
            const delta = json.choices?.[0]?.delta

            if (delta?.reasoning_content && callbacks.onThinking) {
              callbacks.onThinking(delta.reasoning_content)
            } else if ((delta?.reasoning || delta?.thinking) && callbacks.onThinking) {
              callbacks.onThinking(delta.reasoning ?? delta.thinking)
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                if (tc.id) {
                  toolCallInProgress = {
                    id: tc.id,
                    type: 'function',
                    function: {
                      name: tc.function?.name || '',
                      arguments: tc.function?.arguments || '',
                    },
                  }
                  toolCalls.push(toolCallInProgress)
                } else if (toolCallInProgress) {
                  if (tc.function?.arguments) {
                    toolCallInProgress.function.arguments += tc.function.arguments
                  }
                }
              }
            }

            if (delta?.content) {
              accumulatedContent += delta.content
              callbacks.onToken(delta.content)
            }
          } catch {
            // ignore incomplete lines
          }
        }
      }

      if (toolCalls.length > 0 && callbacks.onToolCalls) {
        callbacks.onToolCalls(toolCalls)
      }

      callbacks.onDone()
    } catch (error) {
      callbacks.onError(error instanceof Error ? error : new Error(String(error)))
    }
  }

  async listModels(signal?: AbortSignal): Promise<ListModelsResult> {
    if (!this.config.baseUrl.trim()) {
      throw new Error('Podaj Base URL przed pobraniem listy modeli.')
    }

    const lmStudioResult = await this.tryListLMStudioModels(signal)
    if (lmStudioResult) return lmStudioResult

    return this.listGenericModels(signal)
  }

  private async tryListLMStudioModels(signal?: AbortSignal): Promise<ListModelsResult | null> {
    const { url, headers: proxyHeaders } = this.resolve('/api/v0/models')

    let response: Response
    try {
      response = await fetch(url, {
        headers: { ...this.authHeaders(), ...proxyHeaders },
        signal,
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      return null
    }

    if (!response.ok) return null

    const data = await response.json().catch(() => null)
    const rawModels: any[] | undefined = data?.data
    if (!Array.isArray(rawModels)) return null

    const models: ModelInfo[] = rawModels
      .filter((m) => m?.id)
      .map((m) => {
        const state = String(m.state ?? '').toLowerCase()
        const status: ModelInfo['status'] =
          state === 'loaded'
            ? 'loaded'
            : state === 'error' || state === 'failed'
              ? 'unavailable'
              : 'available'
        return { id: String(m.id), status }
      })

    return { models, backend: 'lmstudio' }
  }

  private async listGenericModels(signal?: AbortSignal): Promise<ListModelsResult> {
    const { url, headers: proxyHeaders } = this.resolve('/v1/models')

    const response = await fetch(url, {
      headers: { ...this.authHeaders(), ...proxyHeaders },
      signal,
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Lista modeli: ${response.status}: ${body.slice(0, 300)}`)
    }

    const data = await response.json()
    const rawModels: Array<{ id?: string; loaded?: boolean; state?: string }> =
      data?.data ?? data?.models ?? []

    const models: ModelInfo[] = rawModels
      .filter((m) => m?.id)
      .map((m) => {
        const isLoaded = m.loaded === true || m.state === 'loaded' || m.state === 'ready'
        return { id: m.id!, status: isLoaded ? 'loaded' : 'available' }
      })

    return { models, backend: 'generic' }
  }
}
