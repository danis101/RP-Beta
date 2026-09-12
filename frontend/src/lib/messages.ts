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
  const now = Date.now()
  return {
    id,
    role,
    variants: [{ content, toolCall }],
    selectedVariant: 0,
    timestamp: now,
    _updatedAt: now,
  }
}

/**
 * Zwraca timestamp ostatniej modyfikacji wiadomości — dla danych sprzed
 * migracji (bez `_updatedAt`) fallbackuje na `timestamp`.
 */
export function getMessageUpdatedAt(msg: ChatMessage): number {
  return msg._updatedAt ?? msg.timestamp
}

/** Kazda lokalna zmiana musi miec wersje nowsza od poprzedniej, nawet w tej samej ms. */
export function updateMessage(
  msg: ChatMessage,
  patch: Partial<Pick<ChatMessage, 'variants' | 'selectedVariant'>>,
): ChatMessage {
  return {
    ...msg,
    ...patch,
    _updatedAt: Math.max(Date.now(), getMessageUpdatedAt(msg) + 1),
  }
}

/** Lista widocznych wiadomości (bez tombstone'ów). */
export function visibleMessages(conv: {
  messages: ChatMessage[]
  _deletedMessageIds?: string[]
}): ChatMessage[] {
  const deleted = conv._deletedMessageIds
  if (!deleted || deleted.length === 0) return conv.messages
  const set = new Set(deleted)
  return conv.messages.filter((m) => !set.has(m.id))
}
