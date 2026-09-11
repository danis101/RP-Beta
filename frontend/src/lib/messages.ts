import type { ChatMessage, MessageVariant } from '../types'

/** Zwraca aktualnie wybrany wariant wiadomości. */
export function getSelectedVariant(msg: ChatMessage): MessageVariant {
  return msg.variants[msg.selectedVariant] ?? msg.variants[0] ?? { content: '' }
}

/** Zwraca treść aktualnie wybranego wariantu. */
export function getContent(msg: ChatMessage): string {
  return getSelectedVariant(msg).content
}

/** Tworzy nową wiadomość z pojedynczym wariantem. */
export function makeMessage(
  id: string,
  role: ChatMessage['role'],
  content: string,
  toolCall?: MessageVariant['toolCall'],
): ChatMessage {
  return {
    id,
    role,
    variants: [{ content, toolCall }],
    selectedVariant: 0,
    timestamp: Date.now(),
  }
}
