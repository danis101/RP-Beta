interface Message { id?: string; role: string; selectedVariant: number; variants: Array<{ content: string }> }
export const summaryMessage = (message: Message) => ({ id: message.id, role: message.role,
  content: (message.variants[message.selectedVariant] ?? message.variants[0])?.content ?? '' })

export function buildSummaryPrompt(messages: Message[], character: { name: string }, persona: { name: string } | undefined,
  existingSummary: string | undefined, customPrompt: string): { system: string; user: string } {
  const historyText = messages.map(message => `${message.role === 'assistant' ? character.name : persona?.name ?? 'Użytkownik'}: ${summaryMessage(message).content}`).join('\n')
  const existingText = existingSummary?.trim() ? `Aktualne podsumowanie:\n${existingSummary.trim()}\n\n` : ''
  return { system: customPrompt, user: `${existingText}Oto nowe wiadomości:\n\n${historyText}\n\nZaktualizuj podsumowanie, uwzględniając nowe wydarzenia.` }
}
export const shouldSummarize = (lastIndex: number, count: number, threshold: number) => count - 1 - lastIndex >= threshold
