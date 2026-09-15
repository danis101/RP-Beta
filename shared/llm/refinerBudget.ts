// A model-independent estimate, not a tokenizer. Keep headroom for the chat
// template and tokenization differences; the profile must match server settings.
export const estimateRefinerTokens = (text: string): number => Math.ceil(text.length / 3)
export function refinerInputBudget(contextLength = 8192, maxTokens = 1024): number {
  if (!Number.isFinite(contextLength) || contextLength <= 0 || !Number.isFinite(maxTokens) || maxTokens <= 0) return -1
  return Math.floor(contextLength * 0.9) - maxTokens - 64
}
export function assertRefinerBudget(text: string, contextLength?: number, maxTokens?: number): void {
  if (estimateRefinerTokens(text) > refinerInputBudget(contextLength, maxTokens)) {
    throw new Error('Refiner: instrukcje, karta, persona i najnowsza wiadomość przekraczają szacowany budżet kontekstu lub limity profilu są nieprawidłowe. Sprawdź kontekst i limit odpowiedzi wybranego profilu API albo skróć opisy.')
  }
}
