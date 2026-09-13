import { buildSummaryPrompt, shouldSummarize } from '../../../shared/llm/summary'

export function prepareSummary(conversation: any, settings: any, character: { name: string }, persona: { name: string } | undefined, automatic: boolean) {
  const lastIndex = conversation.lastSummarizedIndex ?? -1
  if (automatic && (!settings.summarizerEnabled || !shouldSummarize(lastIndex, conversation.messages.length, settings.summarizerThreshold ?? 10))) return null
  const pending = conversation.messages.slice(lastIndex + 1)
  if (!pending.length) return null
  const limited = pending.slice(-(settings.summarizerMessageCount ?? 30))
  const existing = conversation.longTermMemory?.[conversation.longTermMemory.length - 1]?.content
  const prompt = buildSummaryPrompt(limited, character, persona, existing, settings.summarizerPrompt ?? '')
  return [{ role: 'system' as const, content: prompt.system }, { role: 'user' as const, content: prompt.user }]
}
