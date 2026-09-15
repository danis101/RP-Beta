import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CharacterCard,
  ChatMessage,
  Conversation,
  Persona,
  LongTermMemoryEntry,
  MessageAttachment,
  MessageVariant,
  WebSearchResult,
  APIToolCall,
  ToolCall,
  StylePreset,
  Lorebook,
} from './types'
import { MockAdapter, OpenAIAdapter, type ApiAdapter, type OpenAIMessage } from './services/api'
import {
  charactersApi,
  personasApi,
  conversationsApi,
  stylesApi,
  lorebooksApi,
  connectSyncWs,
  isRecentSelfSave,
  SETTINGS_WS_ID,
  uploadBlobFromBlob,
} from './services/sync'
import { ConflictError } from './services/sync/client'
import { useGenerationJob } from './hooks/useGenerationJob'
import { isGenerationActive, type StartGeneration } from './services/sync/generation'
import { getBlobAsDataUrl } from './lib/blobCache'
import { mergeConversations } from './lib/conversationMerge'
import { prepareChatMessages } from './lib/chatCompatibility'
import { buildSystemPrompt } from './lib/prompt'
import { buildStyledSystemPrompt, getStyledChatInjections } from './lib/style'
import { activateLorebooks } from './lib/lorebook'
import { makeMessage, getContent, updateMessage } from './lib/messages'
import { substituteTokens } from './lib/tokens'
import { useI18n } from './i18n'
import { useSettings } from './context/SettingsContext'
import { useAuth } from './context/AuthContext'
import { useConflict } from './context/ConflictContext'
import { shouldSummarize } from './lib/summarizer'
import { buildToolDeclarations, getTool, type ToolContext, type ToolResult } from './lib/toolRegistry'
import { buildImageRefinerMessages } from './lib/refiner'
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

/** Tryb zakonczenia generacji. */
type CompletionMode = 'append' | 'replace' | 'regenerate'

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
  const { settings, refreshFromServer } = useSettings()
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const { user } = useAuth()
  const { pushBanner } = useConflict()
  const route = useHashRoute()

  const [view, setView] = useState<AppView>('chat')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mobileListOpen, setMobileListOpen] = useState(false)
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
  const [replacingMessageId, setReplacingMessageId] = useState<string | null>(null)
  const [hiddenSummaries, setHiddenSummaries] = useState<Set<string>>(new Set())
  const [lastPrompt, setLastPrompt] = useState<{ messages: OpenAIMessage[]; model: string } | null>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [toolRunning, setToolRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const conversationsRef = useRef<Conversation[]>([])
  conversationsRef.current = conversations

  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId

  const activeProfile =
    settings.aiProfiles.find((p) => p.id === settings.activeAiProfileId) ?? settings.aiProfiles[0]

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
    } finally {
      if (!opts.silent) setRefreshing(false)
    }
  }

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

  // --- WebSocket: live sync z innych urzadzen ---
  useEffect(() => {
    const cleanup = connectSyncWs((event) => {
      if (isRecentSelfSave(event.id)) return

      if (event.entityType === 'conversation') {
        if (event.action === 'deleted') {
          setConversations((prev) => prev.filter((c) => c.id !== event.id))
          if (activeIdRef.current === event.id) {
            setActiveId((prev) => {
              if (prev !== event.id) return prev
              const remaining = conversationsRef.current.filter((c) => c.id !== event.id)
              return remaining[0]?.id ?? null
            })
          }
          return
        }

        void conversationsApi
          .get(event.id)
          .then((remote) => {
            setConversations((prev) => {
              const idx = prev.findIndex((c) => c.id === remote.id)
              if (idx === -1) return [...prev, remote]
              const merged = mergeConversations(prev[idx], remote)
              const next = [...prev]
              next[idx] = merged
              return next
            })
          })
          .catch(() => {
            setConversations((prev) => prev.filter((c) => c.id !== event.id))
          })
        return
      }

      if (event.entityType === 'settings') {
        if (event.id === SETTINGS_WS_ID) {
          void refreshFromServer()
        }
        return
      }

      if (event.entityType === 'character') {
        void charactersApi.list().then(setCharacters).catch(() => {})
      } else if (event.entityType === 'persona') {
        void personasApi.list().then(setPersonas).catch(() => {})
      } else if (event.entityType === 'style') {
        void stylesApi.list().then(setStylePresets).catch(() => {})
      } else if (event.entityType === 'lorebook') {
        void lorebooksApi.list().then(setLorebooks).catch(() => {})
      }
    })

    return cleanup
  }, [refreshFromServer])

  const handleManualRefresh = async () => {
    try {
      await reloadAll()
      await refreshFromServer()
    } catch (err) {
      console.error('Manual refresh nie powiodl sie:', err)
    }
  }

  const handleNavigate = (nextView: AppView, mobile = false) => {
    if (nextView === 'chat' && view === 'chat') {
      if (mobile) setMobileListOpen((prev) => !prev)
      else setSidebarOpen((prev) => !prev)
    } else {
      setView(nextView)
      setSidebarOpen(true)
      setMobileListOpen(false)
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
    setMobileListOpen(false)
  }

  const activeConversation = conversations.find((c) => c.id === activeId)
  const serverGeneration = useGenerationJob(ready ? activeId : null, user?.id, (remote) => {
    setConversations(prev => prev.map(local => local.id === remote.id ? mergeConversations(local, remote) : local))
  })
  const activeCharacter = activeConversation
    ? characters.find((c) => c.id === activeConversation.characterId)
    : undefined

  const defaultPersona = personas.find((p) => p.id === settings.defaultPersonaId) ?? personas[0]
  const activePersona: Persona | undefined = activeConversation
    ? activeConversation.personaId
      ? personas.find((p) => p.id === activeConversation.personaId) ?? defaultPersona
      : defaultPersona
    : defaultPersona

  const activeStyleId = activeConversation?.styleId ?? settings.defaultStyleId
  const activeStylePreset = stylePresets.find((s) => s.id === activeStyleId)

  const activeLorebooks = (activeConversation?.lorebookIds ?? [])
    .map((id) => lorebooks.find((l) => l.id === id))
    .filter((l): l is Lorebook => Boolean(l))

  const persistConversation = (conversation: Conversation) => {
    void persistConversationInternal(conversation, false)
  }

  const persistConversationInternal = async (
    conversation: Conversation,
    isRetry: boolean,
  ): Promise<Conversation | undefined> => {
    try {
      const saved = await conversationsApi.update(conversation)
      setConversations((prev) =>
        prev.map((c) =>
          c.id === saved.id
            ? {
                ...c,
                _serverUpdatedAt: saved._serverUpdatedAt,
                _serverCreatedAt: saved._serverCreatedAt,
              }
            : c,
        ),
      )
      return saved
    } catch (err) {
      if (!(err instanceof ConflictError)) {
        console.warn('Zapis konwersacji do serwera nie powiodl sie:', err)
        return
      }

      const remote = err.current as Conversation | null

      if (!remote) {
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
        pushBanner({
          title: t('conflictChangedTitle'),
          description: t('conflictChangedDesc'),
          onRefresh: () => {
            setConversations((prev) => prev.map((c) => (c.id === remote.id ? remote : c)))
          },
        })
        return
      }

      const merged = mergeConversations(conversation, remote)
      setConversations((prev) => prev.map((c) => (c.id === merged.id ? merged : c)))
      return persistConversationInternal(merged, true)
    }
  }

  const handleStop = () => {
    void serverGeneration.cancel()
    if (isGenerationActive(serverGeneration.job)) {
      return
    }
    abortRef.current?.abort()
  }

  const buildMessages = async (history: ChatMessage[], server = false): Promise<OpenAIMessage[]> => {
    if (!activeCharacter) return []

    const tokenCtx = {
      charName: activeCharacter.name,
      userName: activePersona?.name ?? 'Uzytkownik',
      personaName: activePersona?.name ?? 'Uzytkownik',
    }

    const memory = activeProfile?.memoryMessages ?? 20
    const slicedHistory = memory > 0 ? history.slice(-memory) : history

    const substituted: OpenAIMessage[] = []
    const legacyImages = new Map<string, Promise<string>>()
    for (const m of slicedHistory) {
      const variant = m.variants[m.selectedVariant] ?? m.variants[0]
      const content = substituteTokens(getContent(m), tokenCtx)
      const attachments = variant.attachments ?? []

      if (m.role === 'user' && attachments.length > 0 && activeProfile?.visionEnabled) {
        const parts: any[] = []
        if (content) parts.push({ type: 'text', text: content })
        for (const att of attachments) {
          let blobId = att.blobId
          if (server && !blobId && att.data?.startsWith('data:image/')) {
            if (!legacyImages.has(att.data)) {
              legacyImages.set(att.data, fetch(att.data).then(response => response.blob()).then(blob => uploadBlobFromBlob(blob, 'vision.png')))
            }
            blobId = await legacyImages.get(att.data)
          }
          const dataUrl = server && blobId ? `rp-blob:${blobId}` : att.data ?? (blobId ? await getBlobAsDataUrl(blobId) : undefined)
          if (dataUrl) parts.push({ type: 'image_url', image_url: { url: dataUrl } })
        }
        substituted.push({ role: 'user', content: parts })
      } else {
        substituted.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content })
      }
    }

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

  const imageInput = (history: ChatMessage[], contextMessages = settings.imageGenContextMessages ?? 6): NonNullable<StartGeneration['image']> => {
    const [input] = buildImageRefinerMessages({ character: activeCharacter!, persona: activePersona,
      history, contextMessages, contextLength: refinerProfile?.contextLength, maxTokens: refinerProfile?.maxTokens,
      imageStyleDirective: activeConversation?.imageStyleId }, settings.imageGenRefinerPrompt)
    return { refinerProfileId: refinerProfile?.id ?? 'unconfigured', refinerMessages: [
      { role: 'system', content: input.system }, { role: 'user', content: input.user },
    ] }
  }

  const startImageJob = async (mode: 'append' | 'regenerate', messageId?: string, prompt?: string) => {
    if (!activeConversation || !activeCharacter || isTyping || toolRunning || serverGeneration.busy) return
    const controller = new AbortController()
    abortRef.current = controller
    setIsTyping(true)
    try {
      const saved = await persistConversationInternal(activeConversation, false)
      if (controller.signal.aborted) return
      if (!saved || saved._serverUpdatedAt == null) throw new Error('Nie udało się zapisać rozmowy przed generowaniem obrazu.')
      if (JSON.stringify(saved.messages) !== JSON.stringify(activeConversation.messages)) throw new Error('Rozmowa zmieniła się. Sprawdź ją i ponów generowanie obrazu.')
      await serverGeneration.start({ id: crypto.randomUUID(), conversationId: saved.id, mode, operation: 'image',
        targetMessageId: messageId ?? saved.messages[saved.messages.length - 1]?.id ?? saved.id,
        expectedUpdatedAt: saved._serverUpdatedAt, profileId: activeProfile?.id ?? 'image-only',
        messages: [{ role: 'user', content: '' }],
        image: prompt !== undefined ? { prompt } : imageInput(saved.messages, settings.imageGenContextMessages || 6),
      })
    } catch (error) {
      pushBanner({ title: 'Nie uruchomiono generowania obrazu', description: error instanceof Error ? error.message : String(error) })
    } finally { setIsTyping(false); abortRef.current = null }
  }

  const runCompletion = async (
    history: ChatMessage[],
    targetMessageId: string,
    mode: CompletionMode,
    extraMessages?: OpenAIMessage[],
    toolResults?: WebSearchResult[],
    toolLabel?: string,
    savedConversation?: Conversation,
  ) => {
    const controller = new AbortController()
    abortRef.current = controller

    setIsTyping(true)
    setStreamingText('')
    setReplacingMessageId(mode === 'append' ? null : targetMessageId)

    let accumulated = ''
    let thinking = ''
    let toolCalls: APIToolCall[] = []

    let baseMessages: OpenAIMessage[]
    try {
      baseMessages = await buildMessages(history, !!activeProfile?.baseUrl.trim() && !extraMessages && mode !== 'replace')
    } catch (error) {
      setIsTyping(false); setReplacingMessageId(null); abortRef.current = null
      pushBanner({ title: 'Nie przygotowano żądania', description: error instanceof Error ? error.message : String(error) })
      return
    }
    if (controller.signal.aborted) {
      setIsTyping(false)
      setReplacingMessageId(null)
      return
    }
    const messages = prepareChatMessages(
      extraMessages ? [...baseMessages, ...extraMessages] : baseMessages,
      activeCharacter?.name ?? 'Assistant',
    )
    setLastPrompt({ messages, model: activeProfile?.model ?? 'mock' })

    const useStreaming = activeProfile?.streamingEnabled ?? true
    const tools = buildToolDeclarations(settings)
    const conversation = savedConversation ?? activeConversation
    const serverEligible = conversation && activeProfile?.baseUrl.trim() &&
      !extraMessages && !toolResults && mode !== 'replace' &&
      messages.every(message => ['system', 'user', 'assistant'].includes(message.role) && !message.tool_calls && !message.tool_call_id)
    if (serverEligible) {
      try {
        const saved = savedConversation ?? await persistConversationInternal(conversation, false)
        if (controller.signal.aborted) return
        if (!saved || saved._serverUpdatedAt == null) throw new Error('Nie udało się zapisać rozmowy. Generowanie nie zostało uruchomione.')
        // A conflict merge can change history. Do not send a prompt built from
        // a different conversation version; let the user review and retry.
        if (JSON.stringify(saved.messages) !== JSON.stringify(conversation.messages)) {
          throw new Error('Rozmowa zmieniła się podczas zapisu. Sprawdź wiadomości i ponów generowanie.')
        }
        await serverGeneration.start({ id: crypto.randomUUID(), conversationId: saved.id,
          targetMessageId, mode: mode as 'append' | 'regenerate', expectedUpdatedAt: saved._serverUpdatedAt,
          profileId: activeProfile!.id, messages: messages as StartGeneration['messages'],
          ...(mode === 'append' && saved.messages[saved.messages.length - 1]?.id !== targetMessageId ? { historyTailId: saved.messages[saved.messages.length - 1].id } : {}),
          ...(tools.some(tool => tool.function.name === 'web_search') ? { webSearch: true as const } : {}),
          ...(tools.some(tool => tool.function.name === 'generate_image') ? { image: imageInput(history) } : {}) })
      } catch (error) {
        pushBanner({ title: 'Generowanie nie zostało uruchomione', description: error instanceof Error ? error.message : String(error) })
      } finally {
        setIsTyping(false)
        setStreamingText('')
        setReplacingMessageId(null)
        abortRef.current = null
      }
      return
    }
    const allowedToolCalls = (calls: APIToolCall[]) => calls.filter(
      (call) => tools.some((tool) => tool.function.name === call.function.name),
    )

    if (useStreaming) {
      await adapter.streamMessage(
        {
          messages,
          model: activeProfile?.model || undefined,
          temperature: activeProfile?.sampler.temperature,
          signal: controller.signal,
          tools,
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
            toolCalls = allowedToolCalls(calls)
          },
          onDone: () =>
            finishCompletion(
              accumulated,
              thinking,
              toolCalls,
              targetMessageId,
              mode,
              history,
              extraMessages,
              toolResults,
              toolLabel,
            ),
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
          tools,
          onThinking: (text) => { thinking += text },
        })
        try {
          const parsed = JSON.parse(result)
          if (parsed.tool_calls) {
            toolCalls = allowedToolCalls(parsed.tool_calls)
            accumulated = parsed.content || ''
          } else {
            accumulated = result
          }
        } catch {
          accumulated = result
        }
        finishCompletion(
          accumulated,
          thinking,
          toolCalls,
          targetMessageId,
          mode,
          history,
          extraMessages,
          toolResults,
          toolLabel,
        )
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
    mode: CompletionMode,
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
        refinerContextLength: refinerProfile?.contextLength,
        refinerMaxTokens: refinerProfile?.maxTokens,
        imageStyleDirective: activeConversation?.imageStyleId,
      }

      setToolRunning(true)
      try {
        for (const tc of toolCalls) {
          const tool = getTool(tc.function.name, settingsRef.current)
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
        finalContent =
          accumulated +
          `\n\nBlad wykonania narzedzia: ${error instanceof Error ? error.message : String(error)}`
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
            messages[targetIndex] = updateMessage(messages[targetIndex], {
              variants: [...messages[targetIndex].variants, tempVariant],
              selectedVariant: messages[targetIndex].variants.length,
            })
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
      setReplacingMessageId(null)
      abortRef.current = null
      return
    }

    const showResults = settings.webSearchShowResults ?? true
    const imageToolCall = collectedToolCalls.find((t) => t.type === 'image')

    const finalTool: ToolCall | undefined = imageToolCall
      ? imageToolCall
      : existingToolResults && showResults
        ? {
            type: 'websearch' as const,
            label: existingToolLabel || 'Wyszukiwanie',
            results: existingToolResults,
          }
        : toolResults && showResults && !extraMessages
          ? {
              type: 'websearch' as const,
              label: toolLabel || 'Wyszukiwanie',
              results: toolResults,
            }
          : undefined

    const newVariant: MessageVariant = {
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
          if (mode === 'regenerate') {
            messages[targetIndex] = updateMessage(messages[targetIndex], {
              variants: [...messages[targetIndex].variants, newVariant],
              selectedVariant: messages[targetIndex].variants.length,
            })
          } else {
            messages[targetIndex] = updateMessage(messages[targetIndex], {
              variants: [newVariant],
              selectedVariant: 0,
            })
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
    setReplacingMessageId(null)
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
      setReplacingMessageId(null)
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
    setReplacingMessageId(null)
    abortRef.current = null
  }

  const handleSend = async (text: string, attachments?: MessageAttachment[]) => {
    if (!activeConversation || !activeCharacter) return
    if (isTyping || toolRunning || serverGeneration.busy) return
    setIsTyping(true)
    const savingController = new AbortController()
    abortRef.current = savingController

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
    const saved = await persistConversationInternal(updated, false)
    if (savingController.signal.aborted) { setIsTyping(false); return }
    if (!saved) {
      setIsTyping(false)
      pushBanner({ title: 'Nie zapisano wiadomości', description: 'Generowanie nie zostało uruchomione. Sprawdź połączenie i ponów zapis rozmowy.' })
      return
    }
    await runCompletion(saved.messages, userMessage.id, 'append', undefined, undefined, undefined, saved)
  }

  const handleRegenerate = async (messageId: string) => {
    if (isTyping || toolRunning || serverGeneration.busy) return
    if (!activeConversation) return
    const index = activeConversation.messages.findIndex((m) => m.id === messageId)
    if (index === -1) return

    const target = activeConversation.messages[index]
    const variant = target.variants[target.selectedVariant] ?? target.variants[0]
    const toolCall = variant?.toolCall

    if (
      target.role === 'assistant' &&
      toolCall?.type === 'image' &&
      toolCall.prompt &&
      !variant.content.trim()
    ) {
      await startImageJob('regenerate', messageId, toolCall.prompt)
      return
    }

    if (target.role === 'assistant') {
      await runCompletion(activeConversation.messages.slice(0, index), messageId, 'regenerate')
    } else {
      await runCompletion(activeConversation.messages.slice(0, index + 1), messageId, 'append')
    }
  }

  const handleSwipeNext = (messageId: string) => {
    if (!activeConversation) return
    const msg = activeConversation.messages.find((m) => m.id === messageId)
    if (!msg) return
    if (msg.selectedVariant < msg.variants.length - 1) {
      handleSwitchVariant(messageId, 1)
    } else {
      void handleRegenerate(messageId)
    }
  }

  const handleSwipePrev = (messageId: string) => {
    if (!activeConversation) return
    const msg = activeConversation.messages.find((m) => m.id === messageId)
    if (!msg) return
    if (msg.selectedVariant > 0) {
      handleSwitchVariant(messageId, -1)
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
          return updateMessage(m, { variants })
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
        const updated: Conversation = {
          ...c,
          messages: c.messages.filter((m) => m.id !== messageId),
          _deletedMessageIds: [...new Set([...(c._deletedMessageIds ?? []), messageId])],
        }
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
          return updateMessage(m, { selectedVariant: next })
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

  const handlePickImageStyle = (styleId: string | undefined) => {
    if (!activeConversation) return
    const updated: Conversation = { ...activeConversation, imageStyleId: styleId }
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

  const handleSaveCard = async (card: CharacterCard): Promise<CharacterCard | null> => {
    let savedCard: CharacterCard
    try {
      const saved = await charactersApi.update(card)
      savedCard = saved
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
        return null
      }
      console.error('Zapis karty nie powiodl sie:', err)
      alert(err instanceof Error ? err.message : String(err))
      return null
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
    return savedCard
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

  const runSummarizer = async (conv: Conversation) => {
    if (summarizing || isTyping || toolRunning || serverGeneration.busy || serverGeneration.summaryActive) return
    setSummarizing(true)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const saved = await persistConversationInternal(conv, false)
      if (controller.signal.aborted) return
      if (!saved || saved._serverUpdatedAt == null) throw new Error('Nie zapisano rozmowy przed podsumowaniem.')
      const target = saved.messages[saved.messages.length - 1]
      if (!target) return
      await serverGeneration.start({ id: crypto.randomUUID(), conversationId: saved.id, targetMessageId: target.id,
        operation: 'summary', mode: 'append', expectedUpdatedAt: saved._serverUpdatedAt,
        profileId: activeProfile?.id ?? 'unconfigured', messages: [{ role: 'user', content: '' }] })
    } catch (error) {
      pushBanner({ title: 'Nie uruchomiono podsumowania', description: error instanceof Error ? error.message : String(error) })
    } finally { setSummarizing(false); if (abortRef.current === controller) abortRef.current = null }
  }
  const handleManualSummarize = () => {
    if (!activeConversation) return
    runSummarizer(activeConversation)
  }

  const handleGenerateImage = async () => {
    if (!settings.imageGenEnabled || !settings.imageGenBaseUrl) return
    await startImageJob('append')
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
      <div className="app-shell relative flex h-full min-h-0 flex-col overflow-hidden bg-surface-dark md:flex-row">
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
    <div className="app-shell relative flex h-full min-h-0 flex-col overflow-hidden bg-surface-dark md:flex-row">
      <ConflictBanners />
      <NavigationRail
        activeView={view}
        onNavigate={handleNavigate}
        persona={activePersona ?? { id: '', name: '?' }}
        onOpenPersonaManager={() => setPersonaManagerOpen(true)}
        onManualRefresh={handleManualRefresh}
        refreshing={refreshing}
      />

      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {view === 'chat' ? (
        <>
          <div className={`${mobileListOpen || !activeId ? 'flex' : 'hidden'} min-h-0 w-full shrink-0 ${sidebarOpen ? 'md:flex' : 'md:hidden'} md:w-80`}>
            <ChatList
              characters={characters}
              conversations={conversations}
              personas={personas}
              defaultPersonaId={settings.defaultPersonaId}
              activeId={activeId ?? ''}
              onSelect={(id) => {
                setActiveId(id)
                setMobileListOpen(false)
              }}
            />
          </div>
          {activeConversation && activeCharacter && activePersona ? (
            <div className={`${mobileListOpen ? 'hidden' : 'flex'} min-h-0 min-w-0 flex-1 md:flex`}>
            <ChatView
              conversationId={activeConversation.id}
              onOpenConversations={() => setMobileListOpen(true)}
              character={activeCharacter}
              messages={activeConversation.messages}
              persona={activePersona}
              availablePersonas={personas}
              availableStyles={stylePresets}
              availableLorebooks={lorebooks}
              availableImageStyles={settings.imageGenCustomStyles}
              activeStyleId={activeStyleId}
              activeImageStyleId={activeConversation.imageStyleId}
              activeLorebookIds={activeConversation.lorebookIds ?? []}
              isTyping={isTyping || toolRunning || serverGeneration.busy}
              streamingText={isGenerationActive(serverGeneration.job) ? (activeProfile?.streamingEnabled === false || serverGeneration.job?.operation === 'summary' ? '' : serverGeneration.job!.content) : streamingText}
              replacingMessageId={isGenerationActive(serverGeneration.job) && serverGeneration.job?.mode === 'regenerate' ? serverGeneration.job.targetMessageId : replacingMessageId}
              generationNotice={serverGeneration.notice || (isGenerationActive(serverGeneration.job)
                ? ''
                : isTyping || toolRunning ? 'Ten workflow działa jeszcze w przeglądarce — pozostaw ją aktywną.' : '')}
              generationResult={serverGeneration.job && !isGenerationActive(serverGeneration.job) && serverGeneration.job.status !== 'succeeded' ? serverGeneration.job : null}
              onSend={handleSend}
              onStop={handleStop}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
              onRegenerate={handleRegenerate}
              onSwitchVariant={handleSwitchVariant}
              onSwipeNext={handleSwipeNext}
              onSwipePrev={handleSwipePrev}
              showSummary={!hiddenSummaries.has(activeConversation.id)}
              summaryText={
                activeConversation.longTermMemory.length > 0
                  ? activeConversation.longTermMemory[activeConversation.longTermMemory.length - 1]
                      .content
                  : undefined
              }
              onCloseSummary={() =>
                setHiddenSummaries((prev) => new Set(prev).add(activeConversation.id))
              }
              onDeleteConversation={() => handleDeleteConversation(activeConversation.id)}
              onPickPersona={handlePickPersona}
              onPickStyle={handlePickStyle}
              onToggleLorebook={handleToggleLorebook}
              onPickImageStyle={handlePickImageStyle}
              onShowPrompt={() => setPromptViewerOpen(true)}
              onManualSummarize={handleManualSummarize}
              onOpenMemoryEditor={() => setMemoryEditorOpen(true)}
              summarizing={summarizing || serverGeneration.summaryActive}
              visionEnabled={activeProfile?.visionEnabled}
              imageGenEnabled={settings.imageGenEnabled}
              onGenerateImage={handleGenerateImage}
            />
            </div>
          ) : (
            <div className={`${mobileListOpen || !activeId ? 'hidden' : 'flex'} min-w-0 flex-1 items-center justify-center bg-surface-dark text-[13px] text-[#75757f] md:flex`}>
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
      </div>

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
