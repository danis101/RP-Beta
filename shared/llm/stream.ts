import { ReasoningParser, readReasoning } from './reasoning'
import type { APIToolCall, StreamCallbacks } from './types'

/** Reads an already-open response. Its caller owns fetch, cancellation and persistence.
 * Browser disconnection must not be used as the signal for a server-owned job.
 */
export async function readCompletionStream(response: Response, callbacks: StreamCallbacks): Promise<void> {
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
  let toolCalls: APIToolCall[] = []
  let toolCallInProgress: APIToolCall | null = null
  const parser = new ReasoningParser(callbacks.onToken, text => callbacks.onThinking?.(text))

  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const parts = buffer.split(/\r?\n\r?\n/)
      buffer = done ? '' : parts.pop() ?? ''

      for (const part of parts) {
        const lines = part.split(/\r?\n/)
        const isErrorEvent = lines.some(line => /^event:\s*error\s*$/.test(line))
        // SSE moze zawierac event/id/comment przed wlasciwymi danymi.
        // Niektore serwery zamiast SSE zwracaja sam JSON bledu z HTTP 200.
        const payload = part.trim().startsWith('{') ? part.trim() : lines
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, ''))
          .join('\n').trim()
        if (!payload) {
          if (isErrorEvent) throw new Error('OpenAI API: blad w strumieniu odpowiedzi.')
          continue
        }
        if (payload === '[DONE]') {
          parser.finish()
          if (toolCalls.length > 0 && callbacks.onToolCalls) {
            callbacks.onToolCalls(toolCalls)
          }
          callbacks.onDone()
          return
        }

        let json: any
        try {
          json = JSON.parse(payload)
        } catch {
          throw new Error('OpenAI API: nieprawidlowe dane w strumieniu odpowiedzi.')
        }
        if (json?.error || isErrorEvent) {
          const error = json?.error ?? json
          const detail = typeof error === 'string' ? error : error?.message ?? JSON.stringify(error)
          throw new Error(`OpenAI API: ${detail}`)
        }
        const delta = json.choices?.[0]?.delta

        const reasoning = readReasoning(delta)
        if (reasoning) callbacks.onThinking?.(reasoning)

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
          parser.push(delta.content)
        }
      }
      if (done) break
    }

    parser.finish()
    if (toolCalls.length > 0 && callbacks.onToolCalls) {
      callbacks.onToolCalls(toolCalls)
    }

    callbacks.onDone()
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
