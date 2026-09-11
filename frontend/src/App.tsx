import { useEffect, useMemo, useRef, useState } from 'react'
import type { CharacterCard, ChatMessage, Conversation, Persona, LongTermMemoryEntry, MessageAttachment, WebSearchResult, APIToolCall, ToolCall, StylePreset, Lorebook } from './types'
import { MockAdapter, OpenAIAdapter, type ApiAdapter, type OpenAIMessage } from './services/api'
import { charactersApi, personasApi, conversationsApi, stylesApi, lorebooksApi } from './services/sync'
import { ConflictError } from './services/sync/client'
import { mergeConversations } from './lib/conversationMerge'
import { buildSystemPrompt } from './lib/prompt'
import { buildStyledSystemPrompt, getStyledChatInjections } from './lib/style'
import { activateLorebooks } from './lib/lorebook'
import { makeMessage, getContent } from './lib/messages'
import { substituteTokens } from './lib/tokens'
import { useI18n } from './i18n'
import { useSettings } from './context/SettingsContext'
import { useAuth } from './context/AuthContext'
import { useConflict } from './context/ConflictContext'
import { generateSummary, shouldSummarize } from './lib/summarizer'
import { getTool, type ToolContext, type ToolResult } from './lib/toolRegistry'
import { generateImage } from './lib/imageGen'
import { refineImagePrompt } from './lib/refiner'
import { startApiStatusPolling, stopApiStatusPolling } from './lib/apiStatus'
import { useHashRoute } from './lib/hashRoute'
import NavigationRail, { type AppView } from './components/layout/NavigationRail'
import ChatList from './components/chat/ChatList'
import ChatView from './components/chat/ChatView'
import CardsView from './components/cards/CardsView'
import SettingsView from './components/settings/SettingsView'
import LorebooksView from './components/settings/LorebooksView'
import PersonaManager from './components/persona/PersonaManager'
import PromptViewer from './components/chat/PromptViewer'
import LongTermMemoryEditor from './components/chat/LongTermMemoryEditor'
import AdminPanel from './components/admin/AdminPanel'
import ConflictBanners from './components/chat/ConflictBanners'

function buildFirstMessage(card: CharacterCard): ChatMessage[] {
  const variants: Array<{ content: string }> = []

  if (card.firstMes?.trim()) variants.push({ content: card.firstMes.trim() })
  for (const alt of card.alternateGreetings ?? []) {
    if (alt?.trim()) variants.push({ content: alt.trim() })
  }
  if (variants.length === 0) return []

  return [
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      variants,
      selectedVariant: 0,
      timestamp: Date.now(),
    },
  ]
}

export default function App() {
  const { t } = useI18n()
  const { settings } = useSettings()
  const { user } = useAuth()
  const { pushBanner } = useConflict()
  const route = useHashRoute()
  const [view, setView] = useState<AppView>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [characters, setCharacters] = useState<CharacterCard[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [personas, setPersonas] = useState<Persona[]>([])
  const [stylePresets, setStylePresets] = useState<StylePreset[]>([])
  const [lorebooks, setLorebooks] = useState<Lorebook[]>([])
  const [personaManagerOpen, setPersonaManagerOpen] = useState(false)
  const [promptViewerOpen, setPromptViewerOpen] = useState(false)
  const [memoryEditorOpen, setMemoryEditorOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isTyping, setIsTyping] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [hiddenSummaries, setHiddenSummaries] = useState<Set<string>>(new Set())
  const [lastPrompt, setLastPrompt] = useState<{ messages: OpenAIMessage[]; model: string } | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [toolRunning, setToolRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Ref na aktualna liste konwersacji - do optimistic lockingu w callbackach.
  const conversationsRef = useRef<Conversation[]>([])
  conversationsRef.current = conversations

  const activeProfile = settings.aiProfiles.find((p) => p.id === settings.activeAiProfileId) ?? settings.aiProfiles[0]

  const adapter: ApiAdapter = useMemo(() => {
    if (activeProfile?.baseUrl.trim()) {
      return new OpenAIAdapter({
        baseUrl: activeProfile.baseUrl,
        apiKey: activeProfile.apiKey,
        model: activeProfile.model,
        sampler: activeProfile.sampler,
        maxTokens: activeProfile.maxTokens,
        streamingEnabled: activeProfile.streamingEnabled,
        visionEnabled: activeProfile.visionEnabled,
        visionModel: activeProfile.visionModel,
      })
    }
    return new MockAdapter()
  }, [activeProfile])

  const refinerProfile =
    settings.aiProfiles.find((p) => p.id === settings.imageGenRefinerProfileId) ?? activeProfile
  const refinerAdapter: ApiAdapter = useMemo(() => {
    if (refinerProfile?.baseUrl.trim()) {
      return new OpenAIAdapter({
        baseUrl: refinerProfile.baseUrl,
        apiKey: refinerProfile.apiKey,
        model: refinerProfile.model,
        sampler: refinerProfile.sampler,
        maxTokens: refinerProfile.maxTokens,
        streamingEnabled: false,
        visionEnabled: refinerProfile.visionEnabled,
        visionModel: refinerProfile.visionModel,
      })
    }
    return new MockAdapter()
  }, [refinerProfile])

  // Auto-poll statusu aktywnego API/modelu.
  useEffect(() => {
    if (!activeProfile) return
    const timer = window.setTimeout(() => {
      startApiStatusPolling(() => activeProfile, 60_000)
    }, 500)
    return () => {
      window.clearTimeout(timer)
      stopApiStatusPolling()
    }
  }, [activeProfile])

  /**
   * Wczytuje wszystkie encje z serwera. Uzywane przy pierwszym starcie
   * i przy manualnym "Odswiez z serwera" w nav rail.
   */
  const reloadAll = async (opts: { silent?: boolean } = {}): Promise<void> => {
    if (!opts.silent) setRefreshing(true)
    try {
      const [chars, convs, pers, styles, lbs] = await Promise.all([
        charactersApi.list(),
        conversationsApi.list(),
        personasApi.list(),
        stylesApi.list(),
        lorebooksApi.list(),
      ])
      setCharacters(chars)
      setConversations(convs)
      setPersonas(pers)
      setStylePresets(styles)
      setLorebooks(lbs)
      return
    } finally {
      if (!opts.silent) setRefreshing(false)
    }
  }

  // Pierwsze wczytanie danych z serwera.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [chars, convs, pers, styles, lbs] = await Promise.all([
          charactersApi.list(),
          conversationsApi.list(),
          personasApi.list(),
          stylesApi.list(),
          lorebooksApi.list(),
        ])
        if (cancelled) return

        setCharacters(chars)
        setConversations(convs)
        setPersonas(pers)
        setStylePresets(styles)
        setLorebooks(lbs)

        const firstConv = convs[0]
        setActiveId(firstConv?.id ?? null)
      } catch (err) {
        if (cancelled) return
        console.error('Blad wczytywania danych:', err)
        setLoadError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Manualny refresh z nav rail - pokazuje spinner i dociaga wszystko. */
  const handleManualRefresh = async () => {
    try {
      await reloadAll()
    } catch (err) {
      console.error('Manual refresh nie powiodl sie:', err)
    }
  }

  // --- Nawigacja ---
  const handleNavigate = (nextView: AppView) => {
    if (nextView === 'chat' && view === 'chat') {
      setSidebarOpen((prev) => !prev)
    } else {
      setView(nextView)
      setSidebarOpen(true)
    }
    if (window.location.hash) window.location.hash = ''
  }

  const startChatWith = async (characterId: string) => {
    const card = characters.find((c) => c.id === characterId)
    const existing = conversations.find((c) => c.characterId === characterId)

    if (existing) {
      setActiveId(existing.id)
    } else {
      const newConv: Conversation = {
        id: crypto.randomUUID(),
        characterId,
        messages: card ? buildFirstMessage(card) : [],
        unread: 0,
        longTermMemory: [],
        lastSummarizedIndex: -1,
      }
      try {
        const saved = await conversationsApi.update(newConv)
        setConversations((prev) => [...prev, saved])
        setActiveId(saved.id)
      } catch (err) {
        console.error('Nie udalo sie utworzyc konwersacji:', err)
        return
      }
    }
    setView('chat')
    setSidebarOpen(true)
  }

  const activeConversation = conversations.find((c) => c.id === activeId)
  const activeCharacter = activeConversation
    ? characters.find((c) => c.id === activeConversation.characterId)
    : undefined

  const defaultPersona = personas.find((p) => p.id === settings.defaultPersonaId) ?? personas[0]
  const activePersona: Persona | undefined = activeConversation
    ? (activeConversation.personaId
        ? personas.find((p) => p.id === activeConversation.personaId) ?? defaultPersona
        : defaultPersona)
    : defaultPersona

  const activeStyleId = activeConversation?.styleId ?? settings.defaultStyleId
  const activeStylePreset = stylePresets.find((s) => s.id === activeStyleId)

  const activeLorebooks = (activeConversation?.lorebookIds ?? [])
    .map((id) => lorebooks.find((l) => l.id === id))
    .filter((l): l is Lorebook => Boolean(l))

  /**
   * Zapisuje konwersacje do serwera z optimistic lockingiem i AUTO-MERGE.
   *
   * Sukces (200): cicho aktualizujemy _serverUpdatedAt lokalnie.
   *
   * Konflikt (409): ktos zmodyfikowal konwersacje na innym urzadzeniu.
   * Scalamy wiadomosci (nasze nowe + z serwera) i ponawiamy zapis RAZ.
   * Nie ma utraty danych, nie ma bannera.
   *
   * Konflikt przy retry (409 drugi raz): bardzo rzadkie. Pokazujemy banner
   * z Odswiez (wersja z serwera wygrywa).
   *
   * Usuniete na innym urzadzeniu (current=null): banner informacyjny.
   */
  const persistConversation = (conversation: Conversation) => {
    void persistConversationInternal(conversation, false)
  }

  const persistConversationInternal = async (conversation: Conversation, isRetry: boolean): Promise<void> => {
    try {
      const saved = await conversationsApi.update(conversation)
      setConversations((prev) =>
        prev.map((c) =>
          c.id === saved.id
            ? { ...c, _serverUpdatedAt: saved._serverUpdatedAt, _serverCreatedAt: saved._serverCreatedAt }
            : c,
        ),
      )
      return
    } catch (err) {
      if (!(err instanceof ConflictError)) {
        console.warn('Zapis konwersacji do serwera nie powiodl sie:', err)
        return
      }

      const remote = err.current as Conversation | null

      if (!remote) {
        // Encja zostala usunieta na innym urzadzeniu.
        pushBanner({
          title: t('conflictDeletedTitle'),
          description: t('conflictDeletedDesc'),
          onRefresh: () => {
            setConversations((prev) => prev.filter((c) => c.id !== conversation.id))
          },
        })
        return
      }

      if (isRetry) {
        // Retry tez sie nie powiodl - bardzo rzadkie (dwa konflikty pod rzad).
        // Pokazujemy banner, wersja z serwera wygrywa.
        pushBanner({
          title: t('conflictChangedTitle'),
          description: t('conflictChangedDesc'),
          onRefresh: () => {
            setConversations((prev) => prev.map((c) => (c.id === remote.id ? remote : c)))
          },
        })
        return
      }

      // Auto-merge: nasze nowe wiadomosci + historia z serwera.
      // Zero utraty danych, cichy retry.
      const merged = mergeConversations(conversation, remote)
      setConversations((prev) => prev.map((c) => (c.id === merged.id ? merged : c)))
      await persistConversationInternal(merged, true)
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const buildMessages = (history: ChatMessage[]): OpenAIMessage[] => {
    if (!activeCharacter) return []

    const tokenCtx = {
      charName: activeCharacter.name,
      userName: activePersona?.name ?? 'Uzytkownik',
      personaName: activePersona?.name ?? 'Uzytkownik',
    }

    const memory = activeProfile?.memoryMessages ?? 20
    const slicedHistory = memory > 0 ? history.slice(-memory) : history

    const substituted = slicedHistory.map((m) => {
      const variant = m.variants[m.selectedVariant] ?? m.variants[0]
      const content = substituteTokens(getContent(m), tokenCtx)
      const attachments = variant.attachments ?? []

      if (m.role === 'user' && attachments.length > 0 && activeProfile?.visionEnabled) {
        const parts: any[] = []
        if (content) parts.push({ type: 'text', text: content })
        for (const att of attachments) {
          parts.push({
            type: 'image_url',
            image_url: { url: att.data },
          })
        }
        return { role: 'user', content: parts }
      }

      return { role: m.role === 'assistant' ? 'assistant' : 'user', content }
    })

    const activated = activateLorebooks(activeLorebooks, slicedHistory)

    const memoryEntries = activeConversation?.longTermMemory ?? []
    const longTermMemoryText = memoryEntries.map((e) => e.content.trim()).join('\n\n')
    const hasMemoryMarker = activeStylePreset?.style.prompts.some(
      (b) => b.marker && b.identifier === 'longTermMemory' && b.enabled,
    )

    let systemPrompt: string | undefined

    if (activeStylePreset) {
      systemPrompt = buildStyledSystemPrompt(
        activeStylePreset.style,
        activeCharacter,
        activePersona,
        slicedHistory,
        activated.beforeChar.length > 0
          ? activated.beforeChar.concat(activated.afterChar)
          : undefined,
        hasMemoryMarker ? longTermMemoryText : undefined,
      )
      if (!systemPrompt) {
        systemPrompt = buildSystemPrompt(activeCharacter, activePersona)
      }
    } else {
      systemPrompt = buildSystemPrompt(activeCharacter, activePersona)
    }

    const messages: OpenAIMessage[] = []

    for (const content of activated.beforeChar) {
      messages.push({ role: 'system', content })
    }

    if (systemPrompt?.trim()) {
      messages.push({ role: 'system', content: systemPrompt.trim() })
    }

    const injections = activeStylePreset
      ? getStyledChatInjections(
          activeStylePreset.style,
          activeCharacter,
          activePersona,
          slicedHistory,
          activated.beforeChar.concat(activated.afterChar),
          hasMemoryMarker ? longTermMemoryText : undefined,
        )
      : []

    for (const content of activated.beforeChat) {
      messages.push({ role: 'system', content })
    }

    if (!hasMemoryMarker && longTermMemoryText) {
      messages.push({ role: 'system', content: `[Pamiec dlugotrwala]\n${longTermMemoryText}` })
    }

    let injectionIndex = 0
    for (let i = 0; i <= substituted.length; i++) {
      while (injectionIndex < injections.length && injections[injectionIndex].beforeIndex === i) {
        messages.push({
          role: injections[injectionIndex].role,
          content: injections[injectionIndex].content,
        })
        injectionIndex++
      }
      if (i < substituted.length) {
        messages.push(substituted[i])
      }
    }

    for (const content of activated.afterChat) {
      messages.push({ role: 'system', content })
    }

    return messages
  }

  const runCompletion = async (
    history: ChatMessage[],
    targetMessageId: string,
    mode: 'append' | 'replace',
    extraMessages?: OpenAIMessage[],
    toolResults?: WebSearchResult[],
    toolLabel?: string,
  ) => {
    const controller = new AbortController()
    abortRef.current = controller

    setIsTyping(true)
    setStreamingText('')

    let accumulated = ''
    let thinking = ''
    let toolCalls: APIToolCall[] = []

    const baseMessages = buildMessages(history)
    const messages = extraMessages ? [...baseMessages, ...extraMessages] : baseMessages
    setLastPrompt({ messages, model: activeProfile?.model ?? 'mock' })

    const useStreaming = activeProfile?.streamingEnabled ?? true

    if (useStreaming) {
      await adapter.streamMessage(
        {
          messages,
          model: activeProfile?.model || undefined,
          temperature: activeProfile?.sampler.temperature,
          signal: controller.signal,
        },
        {
          onToken: (token) => {
            accumulated += token
            setStreamingText(accumulated)
          },
          onThinking: (token) => {
            thinking += token
          },
          onToolCalls: (calls) => {
            toolCalls = calls
          },
          onDone: () => finishCompletion(accumulated, thinking, toolCalls, targetMessageId, mode, history, extraMessages, toolResults, toolLabel),
          onError: (error) => handleCompletionError(error),
        },
      )
    } else {
      try {
        const result = await adapter.sendMessage({
          messages,
          model: activeProfile?.model || undefined,
          temperature: activeProfile?.sampler.temperature,
          signal: controller.signal,
        })
        try {
          const parsed = JSON.parse(result)
          if (parsed.tool_calls) {
            toolCalls = parsed.tool_calls
            accumulated = parsed.content || ''
          } else {
            accumulated = result
          }
        } catch {
          accumulated = result
        }
        finishCompletion(accumulated, thinking, toolCalls, targetMessageId, mode, history, extraMessages, toolResults, toolLabel)
      } catch (error) {
        handleCompletionError(error instanceof Error ? error : new Error(String(error)))
      }
    }
  }

  const finishCompletion = async (
    accumulated: string,
    thinking: string,
    toolCalls: APIToolCall[],
    targetMessageId: string,
    mode: 'append' | 'replace',
    history: ChatMessage[],
    extraMessages?: OpenAIMessage[],
    existingToolResults?: WebSearchResult[],
    existingToolLabel?: string,
  ) => {
    let finalContent = accumulated
    let toolResults: WebSearchResult[] | undefined = existingToolResults
    let toolLabel: string | undefined = existingToolLabel

    const collectedToolCalls: ToolCall[] = []
    const followUpMessages: OpenAIMessage[] = []

    if (!extraMessages && toolCalls.length > 0) {
      const toolCtx: ToolContext = {
        character: activeCharacter!,
        persona: activePersona,
        history,
        settings: {
          webSearchUrl: settings.webSearchUrl,
          webSearchApiKey: settings.webSearchApiKey,
          webSearchMaxResults: settings.webSearchMaxResults,
          webSearchCooldown: settings.webSearchCooldown,
          imageGenBaseUrl: settings.imageGenBaseUrl,
          imageGenResponseFormat: settings.imageGenResponseFormat,
          imageGenRefinerProfileId: settings.imageGenRefinerProfileId,
          imageGenRefinerPrompt: settings.imageGenRefinerPrompt,
          imageGenContextMessages: settings.imageGenContextMessages,
        },
        refinerAdapter,
        refinerModel: refinerProfile?.model,
      }

      setToolRunning(true)
      try {
        for (const tc of toolCalls) {
          const tool = getTool(tc.function.name)
          if (!tool) continue

          const args = (() => {
            try {
              return JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>
            } catch {
              return {}
            }
          })()

          const result: ToolResult = await tool.run(args, tc, toolCtx)

          if (result.followUp && result.message) {
            followUpMessages.push(result.message)
          }
          if (result.toolCall) {
            collectedToolCalls.push(result.toolCall)
            if (result.toolCall.type === 'websearch' && result.toolCall.results) {
              toolResults = result.toolCall.results
              toolLabel = result.toolCall.label
            }
          }
        }
      } catch (error) {
        console.error('Tool execution error:', error)
        finalContent = accumulated + `\n\nBlad wykonania narzedzia: ${error instanceof Error ? error.message : String(error)}`
      } finally {
        setToolRunning(false)
      }
    }

    if (followUpMessages.length > 0 && !extraMessages) {
      const tempVariant = {
        content: 'Wykonywanie narzedzia...',
        thinking: thinking || undefined,
        toolCall: collectedToolCalls.length === 1 ? collectedToolCalls[0] : undefined,
      }

      const tempId = crypto.randomUUID()

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeId) return c
          const messages = [...c.messages]
          const targetIndex = messages.findIndex((m) => m.id === targetMessageId)

          if (mode === 'append') {
            const updated: Conversation = {
              ...c,
              messages: [
                ...messages,
                {
                  id: tempId,
                  role: 'assistant' as const,
                  variants: [tempVariant],
                  selectedVariant: 0,
                  timestamp: Date.now(),
                },
              ],
              unread: 0,
            }
            persistConversation(updated)
            return updated
          }

          if (targetIndex !== -1) {
            messages[targetIndex] = {
              ...messages[targetIndex],
              variants: [...messages[targetIndex].variants, tempVariant],
              selectedVariant: messages[targetIndex].variants.length,
            }
            const updated: Conversation = { ...c, messages, unread: 0 }
            persistConversation(updated)
            return updated
          }

          return c
        }),
      )

      await runCompletion(history, tempId, 'replace', followUpMessages, toolResults, toolLabel)

      setStreamingText('')
      setIsTyping(false)
      abortRef.current = null
      return
    }

    const showResults = settings.webSearchShowResults ?? true
    const imageToolCall = collectedToolCalls.find((t) => t.type === 'image')

    const finalTool: ToolCall | undefined = imageToolCall
      ? imageToolCall
      : (existingToolResults && showResults)
        ? {
            type: 'websearch' as const,
            label: existingToolLabel || 'Wyszukiwanie',
            results: existingToolResults,
          }
        : (toolResults && showResults && !extraMessages)
          ? {
              type: 'websearch' as const,
              label: toolLabel || 'Wyszukiwanie',
              results: toolResults,
            }
          : undefined

    const newVariant = {
      content: finalContent,
      thinking: thinking || undefined,
      toolCall: finalTool,
    }

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c
        const messages = [...c.messages]
        const targetIndex = messages.findIndex((m) => m.id === targetMessageId)

        if (mode === 'append') {
          const updated: Conversation = {
            ...c,
            messages: [
              ...messages,
              {
                id: crypto.randomUUID(),
                role: 'assistant' as const,
                variants: [newVariant],
                selectedVariant: 0,
                timestamp: Date.now(),
              },
            ],
            unread: 0,
          }
          persistConversation(updated)
          return updated
        }

        if (targetIndex !== -1) {
          messages[targetIndex] = {
            ...messages[targetIndex],
            variants: [newVariant],
            selectedVariant: 0,
          }
          const updated: Conversation = { ...c, messages, unread: 0 }
          persistConversation(updated)
          return updated
        }

        return c
      }),
    )

    setStreamingText('')
    setIsTyping(false)
    abortRef.current = null

    const conv = conversationsRef.current.find((c) => c.id === activeId)
    if (conv && settings.summarizerEnabled) {
      const threshold = settings.summarizerThreshold ?? 10
      if (shouldSummarize(conv.lastSummarizedIndex, conv.messages.length, threshold)) {
        runSummarizer(conv)
      }
    }
  }

  const handleCompletionError = (error: Error) => {
    if (error.name === 'AbortError') {
      setStreamingText('')
      setIsTyping(false)
      abortRef.current = null
      return
    }

    console.error('Blad adaptera:', error)
    const errorContent = `Blad: ${error.message}`
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c
        const updated: Conversation = {
          ...c,
          messages: [...c.messages, makeMessage(crypto.randomUUID(), 'assistant', errorContent)],
          unread: 0,
        }
        persistConversation(updated)
        return updated
      }),
    )

    setStreamingText('')
    setIsTyping(false)
    abortRef.current = null
  }

  const handleSend = async (text: string, attachments?: MessageAttachment[]) => {
    if (!activeConversation || !activeCharacter) return

    const userMessage = makeMessage(crypto.randomUUID(), 'user', text)
    if (attachments && attachments.length > 0) {
      userMessage.variants[0].attachments = attachments
    }

    const updated: Conversation = {
      ...activeConversation,
      messages: [...activeConversation.messages, userMessage],
      unread: 0,
    }

    setConversations((prev) => prev.map((c) => (c.id === activeId ? updated : c)))
    persistConversation(updated)

    await runCompletion(updated.messages, userMessage.id, 'append')
  }

  const handleRegenerate = async (messageId: string) => {
    if (!activeConversation) return
    const index = activeConversation.messages.findIndex((m) => m.id === messageId)
    if (index === -1) return

    const target = activeConversation.messages[index]
    if (target.role === 'assistant') {
      await runCompletion(activeConversation.messages.slice(0, index), messageId, 'replace')
    } else {
      await runCompletion(activeConversation.messages.slice(0, index + 1), messageId, 'append')
    }
  }

  const handleEditMessage = (messageId: string, content: string) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c
        const messages = c.messages.map((m) => {
          if (m.id !== messageId) return m
          const variant = m.variants[m.selectedVariant] ?? m.variants[0]
          const variants = [...m.variants]
          variants[m.selectedVariant] = { ...variant, content }
          return { ...m, variants }
        })
        const updated: Conversation = { ...c, messages }
        persistConversation(updated)
        return updated
      }),
    )
  }

  const handleDeleteMessage = (messageId: string) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c
        const updated: Conversation = { ...c, messages: c.messages.filter((m) => m.id !== messageId) }
        persistConversation(updated)
        return updated
      }),
    )
  }

  const handleSwitchVariant = (messageId: string, delta: -1 | 1) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c
        const messages = c.messages.map((m) => {
          if (m.id !== messageId) return m
          const count = m.variants.length
          const next = (m.selectedVariant + delta + count) % count
          return { ...m, selectedVariant: next }
        })
        const updated: Conversation = { ...c, messages }
        persistConversation(updated)
        return updated
      }),
    )
  }

  const handlePickPersona = (personaId: string | null) => {
    if (!activeConversation) return
    const updated: Conversation = { ...activeConversation, personaId: personaId ?? undefined }
    setConversations((prev) => prev.map((c) => (c.id === activeId ? updated : c)))
    persistConversation(updated)
  }

  const handlePickStyle = (styleId: string | null) => {
    if (!activeConversation) return
    const updated: Conversation = { ...activeConversation, styleId: styleId ?? undefined }
    setConversations((prev) => prev.map((c) => (c.id === activeId ? updated : c)))
    persistConversation(updated)
  }

  const handleToggleLorebook = (lorebookId: string) => {
    if (!activeConversation) return
    const current = activeConversation.lorebookIds ?? []
    const next = current.includes(lorebookId)
      ? current.filter((id) => id !== lorebookId)
      : [...current, lorebookId]
    const updated: Conversation = { ...activeConversation, lorebookIds: next }
    setConversations((prev) => prev.map((c) => (c.id === activeId ? updated : c)))
    persistConversation(updated)
  }

  const handleDeleteConversation = async (id: string) => {
    try {
      await conversationsApi.remove(id)
    } catch (err) {
      console.warn('Nie udalo sie usunac konwersacji na serwerze:', err)
    }
    const next = conversations.filter((c) => c.id !== id)
    setConversations(next)
    if (activeId === id) setActiveId(next[0]?.id ?? null)
  }

  // --- Karty postaci ---
  const handleSaveCard = async (card: CharacterCard) => {
    try {
      const saved = await charactersApi.update(card)
      setCharacters((prev) => {
        const exists = prev.some((c) => c.id === saved.id)
        return exists ? prev.map((c) => (c.id === saved.id ? saved : c)) : [...prev, saved]
      })
    } catch (err) {
      if (err instanceof ConflictError) {
        const current = err.current as CharacterCard | null
        pushBanner({
          title: t('conflictChangedTitle'),
          description: t('conflictChangedDesc'),
          onRefresh: () => {
            if (current) {
              setCharacters((prev) => prev.map((c) => (c.id === current.id ? current : c)))
            }
          },
        })
        return
      }
      console.error('Zapis karty nie powiodl sie:', err)
      alert(err instanceof Error ? err.message : String(err))
      return
    }

    const cardId = card.id
    if (!conversations.some((c) => c.characterId === cardId)) {
      const newConv: Conversation = {
        id: crypto.randomUUID(),
        characterId: cardId,
        messages: buildFirstMessage(card),
        unread: 0,
        longTermMemory: [],
        lastSummarizedIndex: -1,
      }
      try {
        const savedConv = await conversationsApi.update(newConv)
        setConversations((prev) => [...prev, savedConv])
        setActiveId(savedConv.id)
      } catch (err) {
        console.warn('Nie udalo sie utworzyc konwersacji:', err)
      }
    }
  }

  const handleDeleteCard = async (id: string) => {
    try {
      await charactersApi.remove(id)
    } catch (err) {
      console.warn('Usuwanie karty na serwerze nie powiodlo sie:', err)
    }

    const related = conversations.filter((c) => c.characterId === id)
    for (const conv of related) {
      try {
        await conversationsApi.remove(conv.id)
      } catch (err) {
        console.warn('Usuwanie konwersacji nie powiodlo sie:', err)
      }
    }

    setCharacters((prev) => prev.filter((c) => c.id !== id))
    setConversations((prev) => prev.filter((c) => c.characterId !== id))
  }

  // --- Persony ---
  const handleSavePersona = async (persona: Persona) => {
    try {
      const saved = await personasApi.update(persona)
      setPersonas((prev) => {
        const exists = prev.some((p) => p.id === saved.id)
        return exists ? prev.map((p) => (p.id === saved.id ? saved : p)) : [...prev, saved]
      })
    } catch (err) {
      if (err instanceof ConflictError) {
        const current = err.current as Persona | null
        pushBanner({
          title: t('conflictChangedTitle'),
          description: t('conflictChangedDesc'),
          onRefresh: () => {
            if (current) {
              setPersonas((prev) => prev.map((p) => (p.id === current.id ? current : p)))
            }
          },
        })
        return
      }
      console.error('Zapis persony nie powiodl sie:', err)
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDeletePersona = async (id: string) => {
    try {
      await personasApi.remove(id)
      setPersonas((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      console.warn('Usuwanie persony nie powiodlo sie:', err)
    }
  }

  // --- Style ---
  const handleSaveStyle = async (preset: StylePreset) => {
    try {
      const saved = await stylesApi.update(preset)
      setStylePresets((prev) => {
        const exists = prev.some((s) => s.id === saved.id)
        return exists ? prev.map((s) => (s.id === saved.id ? saved : s)) : [...prev, saved]
      })
    } catch (err) {
      if (err instanceof ConflictError) {
        const current = err.current as StylePreset | null
        pushBanner({
          title: t('conflictChangedTitle'),
          description: t('conflictChangedDesc'),
          onRefresh: () => {
            if (current) {
              setStylePresets((prev) => prev.map((s) => (s.id === current.id ? current : s)))
            }
          },
        })
        return
      }
      console.error('Zapis stylu nie powiodl sie:', err)
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDeleteStyle = async (id: string) => {
    try {
      await stylesApi.remove(id)
      setStylePresets((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      console.warn('Usuwanie stylu nie powiodlo sie:', err)
    }
  }

  // --- Lorebooki ---
  const handleSaveLorebook = async (lorebook: Lorebook) => {
    try {
      const saved = await lorebooksApi.update(lorebook)
      setLorebooks((prev) => {
        const exists = prev.some((l) => l.id === saved.id)
        return exists ? prev.map((l) => (l.id === saved.id ? saved : l)) : [...prev, saved]
      })
    } catch (err) {
      if (err instanceof ConflictError) {
        const current = err.current as Lorebook | null
        pushBanner({
          title: t('conflictChangedTitle'),
          description: t('conflictChangedDesc'),
          onRefresh: () => {
            if (current) {
              setLorebooks((prev) => prev.map((l) => (l.id === current.id ? current : l)))
            }
          },
        })
        return
      }
      console.error('Zapis lorebooka nie powiodl sie:', err)
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const handleDeleteLorebook = async (id: string) => {
    try {
      await lorebooksApi.remove(id)
      setLorebooks((prev) => prev.filter((l) => l.id !== id))
    } catch (err) {
      console.warn('Usuwanie lorebooka nie powiodlo sie:', err)
    }
  }

  // --- Summarizer ---
  const runSummarizer = async (conv: Conversation) => {
    if (summarizing) return
    if (!activeCharacter) return

    setSummarizing(true)

    try {
      const startIndex = conv.lastSummarizedIndex + 1
      const messagesToSummarize = conv.messages.slice(startIndex)
      if (messagesToSummarize.length === 0) {
        setSummarizing(false)
        return
      }

      const count = settings.summarizerMessageCount ?? 30
      const limited = messagesToSummarize.slice(-count)

      const existingSummary = conv.longTermMemory.length > 0
        ? conv.longTermMemory[conv.longTermMemory.length - 1].content
        : undefined

      const summary = await generateSummary(
        limited,
        activeCharacter,
        activePersona,
        existingSummary,
        settings.summarizerPrompt,
        settings.summarizerModel || undefined,
        adapter,
        activeProfile!,
      )

      if (summary) {
        const newEntry: LongTermMemoryEntry = {
          id: crypto.randomUUID(),
          content: summary,
          timestamp: Date.now(),
          messageIndex: conv.messages.length - 1,
        }

        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== conv.id) return c
            const updated: Conversation = {
              ...c,
              longTermMemory: [...c.longTermMemory, newEntry],
              lastSummarizedIndex: c.messages.length - 1,
            }
            persistConversation(updated)
            return updated
          }),
        )
      }
    } catch (error) {
      console.error('Summarizer error:', error)
    } finally {
      setSummarizing(false)
    }
  }

  const handleManualSummarize = () => {
    if (!activeConversation) return
    runSummarizer(activeConversation)
  }

  // --- Generowanie obrazu z przycisku ---
  const handleGenerateImage = async () => {
    if (!activeConversation || !activeCharacter) return
    if (!settings.imageGenEnabled) return

    const contextMessages = settings.imageGenContextMessages || 6
    const baseUrl = settings.imageGenBaseUrl
    const responseFormat = settings.imageGenResponseFormat

    if (!baseUrl) return

    const tempId = crypto.randomUUID()
    const tempVariant = {
      content: '',
      toolCall: {
        type: 'image' as const,
        label: 'Generowanie obrazu',
        status: 'generating' as const,
      },
    }

    const addTemp = (messages: ChatMessage[]): ChatMessage[] => [
      ...messages,
      { id: tempId, role: 'assistant' as const, variants: [tempVariant], selectedVariant: 0, timestamp: Date.now() },
    ]

    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c
        const updated: Conversation = { ...c, messages: addTemp(c.messages), unread: 0 }
        persistConversation(updated)
        return updated
      }),
    )

    try {
      const prompt = await refineImagePrompt(
        { character: activeCharacter, persona: activePersona, history: activeConversation.messages, contextMessages },
        settings.imageGenRefinerPrompt,
        refinerAdapter,
        refinerProfile?.model,
      )

      const result = await generateImage(prompt, { baseUrl, responseFormat })

      const finalToolCall: ToolCall = result.status === 'done'
        ? { type: 'image', label: 'Wygenerowany obraz', imageUrl: result.dataUrl, status: 'done' }
        : result.status === 'processing'
          ? { type: 'image', label: 'Generowanie obrazu', status: 'generating', error: 'Generowanie trwa dluzej niz 45s.' }
          : { type: 'image', label: 'Generowanie obrazu', status: 'error', error: result.message }

      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeId) return c
          const messages = c.messages.map((m) =>
            m.id === tempId
              ? { ...m, variants: [{ ...m.variants[0], toolCall: finalToolCall }] }
              : m,
          )
          const updated: Conversation = { ...c, messages }
          persistConversation(updated)
          return updated
        }),
      )
    } catch (error) {
      const errorToolCall: ToolCall = {
        type: 'image',
        label: 'Generowanie obrazu',
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== activeId) return c
          const messages = c.messages.map((m) =>
            m.id === tempId ? { ...m, variants: [{ ...m.variants[0], toolCall: errorToolCall }] } : m,
          )
          const updated: Conversation = { ...c, messages }
          persistConversation(updated)
          return updated
        }),
      )
    }
  }

  const handleUpdateMemory = (entries: LongTermMemoryEntry[]) => {
    if (!activeConversation) return
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c
        const updated: Conversation = { ...c, longTermMemory: entries }
        persistConversation(updated)
        return updated
      }),
    )
  }

  // --- Rendering ---
  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-dark text-[13px] text-[#75757f]">
        {t('statusLoading')}
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-surface-dark p-6 text-center">
        <p className="text-[13px] text-[#e05b5b]">{t('syncLoadError')}</p>
        <p className="max-w-md text-[12px] text-[#75757f]">{loadError}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-accent-hover"
        >
          {t('syncRetry')}
        </button>
      </div>
    )
  }

  if (route === 'admin' && user?.isAdmin) {
    return (
      <div className="relative flex h-screen overflow-hidden bg-surface-dark">
        <ConflictBanners />
        <NavigationRail
          activeView={view}
          onNavigate={handleNavigate}
          persona={activePersona ?? { id: '', name: '?' }}
          onOpenPersonaManager={() => setPersonaManagerOpen(true)}
          onManualRefresh={handleManualRefresh}
          refreshing={refreshing}
        />
        <AdminPanel />
      </div>
    )
  }

  return (
    <div className="relative flex h-screen overflow-hidden bg-surface-dark">
      <ConflictBanners />
      <NavigationRail
        activeView={view}
        onNavigate={handleNavigate}
        persona={activePersona ?? { id: '', name: '?' }}
        onOpenPersonaManager={() => setPersonaManagerOpen(true)}
        onManualRefresh={handleManualRefresh}
        refreshing={refreshing}
      />

      {view === 'chat' ? (
        <>
          {sidebarOpen && (
            <ChatList
              characters={characters}
              conversations={conversations}
              activeId={activeId ?? ''}
              onSelect={setActiveId}
            />
          )}
          {activeConversation && activeCharacter && activePersona ? (
            <ChatView
              character={activeCharacter}
              messages={activeConversation.messages}
              persona={activePersona}
              availablePersonas={personas}
              availableStyles={stylePresets}
              availableLorebooks={lorebooks}
              activeStyleId={activeStyleId}
              activeLorebookIds={activeConversation.lorebookIds ?? []}
              isTyping={isTyping || toolRunning}
              streamingText={streamingText}
              onSend={handleSend}
              onStop={handleStop}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
              onRegenerate={handleRegenerate}
              onSwitchVariant={handleSwitchVariant}
              showSummary={!hiddenSummaries.has(activeConversation.id)}
              summaryText={activeConversation.longTermMemory.length > 0
                ? activeConversation.longTermMemory[activeConversation.longTermMemory.length - 1].content
                : undefined}
              onCloseSummary={() =>
                setHiddenSummaries((prev) => new Set(prev).add(activeConversation.id))
              }
              onDeleteConversation={() => handleDeleteConversation(activeConversation.id)}
              onPickPersona={handlePickPersona}
              onPickStyle={handlePickStyle}
              onToggleLorebook={handleToggleLorebook}
              onShowPrompt={() => setPromptViewerOpen(true)}
              onManualSummarize={handleManualSummarize}
              onOpenMemoryEditor={() => setMemoryEditorOpen(true)}
              summarizing={summarizing}
              visionEnabled={activeProfile?.visionEnabled}
              imageGenEnabled={settings.imageGenEnabled}
              onGenerateImage={handleGenerateImage}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center bg-surface-dark text-[13px] text-[#75757f]">
              {t('chatNoConversation')}
            </div>
          )}
        </>
      ) : view === 'cards' ? (
        <CardsView
          characters={characters}
          onSave={handleSaveCard}
          onDelete={handleDeleteCard}
          onStartChat={startChatWith}
        />
      ) : view === 'lorebooks' ? (
        <LorebooksView
          lorebooks={lorebooks}
          onSave={handleSaveLorebook}
          onDelete={handleDeleteLorebook}
        />
      ) : (
        <SettingsView
          stylePresets={stylePresets}
          onSaveStyle={handleSaveStyle}
          onDeleteStyle={handleDeleteStyle}
        />
      )}

      {personaManagerOpen && activePersona && (
        <PersonaManager
          personas={personas}
          activePersona={activePersona}
          onSave={handleSavePersona}
          onDelete={handleDeletePersona}
          onClose={() => setPersonaManagerOpen(false)}
        />
      )}

      {promptViewerOpen && lastPrompt && (
        <PromptViewer
          messages={lastPrompt.messages}
          model={lastPrompt.model}
          onClose={() => setPromptViewerOpen(false)}
        />
      )}

      {memoryEditorOpen && activeConversation && (
        <LongTermMemoryEditor
          entries={activeConversation.longTermMemory}
          onUpdate={handleUpdateMemory}
          onClose={() => setMemoryEditorOpen(false)}
        />
      )}
    </div>
  )
}
