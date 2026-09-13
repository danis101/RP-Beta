export interface ModelMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
}

export function validModelMessage(value: any): value is ModelMessage {
  return !!value && ['system', 'user', 'assistant'].includes(value.role) && !value.tool_calls && !value.tool_call_id &&
    (typeof value.content === 'string' || (Array.isArray(value.content) && value.content.every((part: any) =>
      part?.type === 'text' ? typeof part.text === 'string' : part?.type === 'image_url' && typeof part.image_url?.url === 'string' &&
        (/^rp-blob:[a-f0-9]{64}$/.test(part.image_url.url) || /^data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\r\n]+$/.test(part.image_url.url)))))
}

export async function resolveModelImages(messages: ModelMessage[], load: (id: string) => Promise<string>): Promise<ModelMessage[]> {
  const cache = new Map<string, Promise<string>>()
  return Promise.all(messages.map(async message => ({ ...message, content: typeof message.content === 'string' ? message.content :
    await Promise.all(message.content.map(async part => {
      if (part.type !== 'image_url' || !part.image_url.url.startsWith('rp-blob:')) return part
      const id = part.image_url.url.slice(8)
      if (!cache.has(id)) cache.set(id, load(id))
      return { type: 'image_url' as const, image_url: { url: await cache.get(id)! } }
    })) })))
}
