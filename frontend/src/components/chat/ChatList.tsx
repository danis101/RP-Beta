import { useState } from 'react'
import { Search } from 'lucide-react'
import type { CharacterCard, Conversation, Persona } from '../../types'
import { useI18n } from '../../i18n'
import { getContent } from '../../lib/messages'
import { substituteTokens } from '../../lib/tokens'
import { useApiStatus, type ApiStatus } from '../../lib/apiStatus'
import Avatar from '../ui/Avatar'

interface ChatListProps {
  characters: CharacterCard[]
  conversations: Conversation[]
  personas: Persona[]
  defaultPersonaId: string
  activeId: string
  onSelect: (id: string) => void
}

/**
 * Kropka statusu = stan aktywnego API/modelu (nie status postaci).
 *  - zielona   – API online, model załadowany
 *  - żółta     – API odpowiada, model niezaładowany / nie wybrany
 *  - szara     – API nie odpowiada
 *  - przygasz. – sprawdzanie w toku (stan początkowy)
 */
const apiDot: Record<ApiStatus, { color: string; labelKey: string }> = {
  ok: { color: 'bg-[#34c759]', labelKey: 'apiStatusOk' },
  'no-model': { color: 'bg-[#ffcc00]', labelKey: 'apiStatusNoModel' },
  offline: { color: 'bg-[#4a4a52]', labelKey: 'apiStatusOffline' },
  unknown: { color: 'bg-[#3a3a42]', labelKey: 'apiStatusChecking' },
}

export default function ChatList({
  characters,
  conversations,
  personas,
  defaultPersonaId,
  activeId,
  onSelect,
}: ChatListProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const apiStatus = useApiStatus()

  const getCharacter = (id: string) => characters.find((c) => c.id === id)

  /**
   * Persona uzywana w danej konwersacji — analogicznie do logiki w App.tsx
   * (activePersona). Dla kazdej rozmowy osobno, bo kazda moze miec inna
   * personę (Conversation.personaId ma priorytet nad default z settings).
   */
  const getPersonaFor = (conv: Conversation): Persona | undefined => {
    const defaultPersona = personas.find((p) => p.id === defaultPersonaId) ?? personas[0]
    if (conv.personaId) {
      return personas.find((p) => p.id === conv.personaId) ?? defaultPersona
    }
    return defaultPersona
  }

  // Sortujemy kopie po ostatniej wiadomosci, nie po zapisie ustawien rozmowy.
  // Puste rozmowy trafiaja na dol; ID zapewnia stala kolejnosc przy remisie.
  const filtered = conversations
    .filter((conv) => {
      const character = getCharacter(conv.characterId)
      return character ? character.name.toLowerCase().includes(query.toLowerCase()) : false
    })
    .sort((a, b) => {
      const aTime = a.messages[a.messages.length - 1]?.timestamp ?? 0
      const bTime = b.messages[b.messages.length - 1]?.timestamp ?? 0
      return bTime - aTime || a.id.localeCompare(b.id)
    })

  const dot = apiDot[apiStatus.status]

  return (
    <aside className="flex w-80 flex-col border-r border-edge bg-surface-light">
      <div className="border-b border-edge px-4 pb-3 pt-4">
        <h2 className="mb-3 text-[17px] font-semibold text-[#f2f2f4]">{t('navChat')}</h2>
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6a6a72]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('chatSearch')}
            className="w-full rounded-[11px] border border-[#2a2a31] bg-surface-dark py-2.5 pl-10 pr-3 text-[13px] text-[#e8e8eb] outline-none transition-colors placeholder:text-[#6a6a72] focus:border-accent"
          />
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {filtered.map((conv) => {
          const character = getCharacter(conv.characterId)
          if (!character) return null

          const last = conv.messages[conv.messages.length - 1]
          const isActive = conv.id === activeId

          // Podstaw tokeny ({{user}}, {{char}}, etc.) w preview uzywajac
          // persony TEJ konwersacji — spojne z ChatBubble.
          const persona = getPersonaFor(conv)
          const lastPreview = last
            ? substituteTokens(getContent(last), {
                charName: character.name,
                userName: persona?.name ?? 'User',
                personaName: persona?.name ?? 'User',
              })
            : t('chatNoMessages')

          return (
            <button
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className={`flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2.5 text-left transition-colors ${
                isActive ? 'bg-[#1e2436]' : 'hover:bg-[#1b1b21]'
              }`}
            >
              <div className="relative shrink-0">
                {/* Preferuj nowy format bloba (portraitBlobId), fallback na stary base64 (portrait). */}
                <Avatar
                  src={character.portraitBlobId ?? character.portrait}
                  name={character.name}
                  size="md"
                />
                <span
                  title={t(dot.labelKey)}
                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface-light ${dot.color}`}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="truncate text-sm font-semibold text-[#f2f2f4]">{character.name}</span>
                  <span className="ml-2 shrink-0 text-[11px] text-[#75757f]">
                    {last
                      ? new Date(last.timestamp).toLocaleTimeString('pl-PL', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[12.5px] text-[#9a9aa3]">{lastPreview}</p>
              </div>

              {conv.unread > 0 && (
                <span className="flex h-[19px] min-w-[19px] shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[10.5px] font-semibold text-white">
                  {conv.unread}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
