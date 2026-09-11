import type { ApiAdapter, SendMessageParams, StreamCallbacks, ListModelsResult } from './types'
import type { OpenAIMessage } from './OpenAIAdapter'

/** Adapter lokalny — działa bez internetu i bez kluczy. */
export class MockAdapter implements ApiAdapter {
  id = 'mock'
  name = 'Mock'

  isConfigured(): boolean {
    return true
  }

  async sendMessage(params: SendMessageParams): Promise<string> {
    const reply = this.mockReply(params.messages)
    await new Promise((resolve) => setTimeout(resolve, 400))
    return reply
  }

  async streamMessage(params: SendMessageParams, callbacks: StreamCallbacks): Promise<void> {
    const reply = this.mockReply(params.messages)
    const words = reply.split(' ')

    await new Promise((resolve) => setTimeout(resolve, 350))

    for (let i = 0; i < words.length; i += 2) {
      if (params.signal?.aborted) {
        callbacks.onError(new DOMException('Aborted', 'AbortError'))
        return
      }
      const chunk = words.slice(i, i + 2).join(' ')
      callbacks.onToken(chunk + (i + 2 < words.length ? ' ' : ''))
      await new Promise((resolve) => setTimeout(resolve, 35))
    }

    callbacks.onDone()
  }

  async listModels(): Promise<ListModelsResult> {
    return {
      models: [
        { id: 'mock-local', status: 'loaded' },
        { id: 'mock-vision', status: 'available' },
        { id: 'mock-legacy', status: 'unavailable' },
      ],
    }
  }

  private mockReply(messages: OpenAIMessage[]): string {
    const last = messages[messages.length - 1]
    const snippet = last?.content?.slice(0, 70) ?? ''
    return `To jest mockowa odpowiedź na: „${snippet}”. Adapter działa — prawdziwe API podepniesz w Ustawieniach.`
  }
}
