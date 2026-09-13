/** Shared declaration and presentation; transport and credentials stay with the caller. */
export const webSearchDeclaration = {
  type: 'function' as const,
  function: {
    name: 'web_search',
    description: 'Search the internet for up-to-date information. Use this when you need current information, recent events, or specific facts that may not be in your training data.',
    parameters: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'The search query. Be specific and include relevant keywords.' } },
      required: ['query'],
    },
  },
}
export interface SearchResult { title: string; url: string; snippet: string; source?: string }
export interface SearchToolCall { type: 'websearch'; label: string; results: SearchResult[] }

export function parseSearchResults(data: any, maxResults: number): SearchResult[] {
  const results: SearchResult[] = (data.results || []).slice(0, maxResults).map((r: any) => ({
    title: r.title || r.url || 'Bez tytułu', url: r.url || '#',
    snippet: r.content || r.snippet || '', source: r.engine || 'SearXNG',
  }))
  if (results.length === 0 && data.infoboxes?.length > 0) {
    for (const info of data.infoboxes) {
      if (info.infobox) results.push({ title: info.infobox, url: info.id || info.url || '#', snippet: info.content || '', source: 'Infobox' })
      if (results.length >= maxResults) break
    }
  }
  return results
}

export function searchFollowUp(query: string, results: SearchResult[]) {
  const summary = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   Źródło: ${r.url}`).join('\n\n')
  return { role: 'system' as const,
    content: `[Wyniki wyszukiwania dla: "${query}"]\n\n${summary}\n\nNa podstawie tych informacji, odpowiedz w roli postaci, używając swojego stylu. Nie cytuj surowych wyników – wpleć je naturalnie w odpowiedź.` }
}
