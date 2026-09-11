import { useEffect, useRef, useState } from 'react'
import { X, MoreVertical, Trash2, Check, X as XIcon, UserRound, Palette, BookOpen, Eye, Database, RotateCcw } from 'lucide-react'
import type { CharacterCard, ChatMessage, Persona, StylePreset, Lorebook, MessageAttachment } from '../../types'
import { useI18n } from '../../i18n'
import { getContent } from '../../lib/messages'
import type { TokenContext } from '../../lib/tokens'
import Avatar from '../ui/Avatar'
import ChatBubble from './ChatBubble'
import InputBar from './InputBar'
import MessageActions from './MessageActions'
import ConfirmDialog from './ConfirmDialog'

interface ChatViewProps {
  character: CharacterCard
  messages: ChatMessage[]
  persona: Persona
  isTyping: boolean
  streamingText: string
  /** Gdy ustawione, wiadomosc o tym id jest tymczasowo ukrywana i zastepowana streamem. */
  replacingMessageId?: string | null
  onSend: (text: string, attachments?: MessageAttachment[]) => void
  onStop: () => void
  onEditMessage: (messageId: string, content: string) => void
  onDeleteMessage: (messageId: string) => void
  onRegenerate: (messageId: string) => void
  onSwitchVariant: (messageId: string, delta: -1 | 1) => void
  /** Swipe w lewo: nastepny wariant lub regeneracja (na ostatnim). */
  onSwipeNext?: (messageId: string) => void
  /** Swipe w prawo: poprzedni wariant. */
  onSwipePrev?: (messageId: string) => void
  onCloseSummary: () => void
  onDeleteConversation: () => void
  onPickPersona: (personaId: string | null) => void
  onPickStyle: (styleId: string | null) => void
  onToggleLorebook: (lorebookId: string) => void
  onShowPrompt: () => void
  onManualSummarize: () => void
  onOpenMemoryEditor: () => void
  showSummary: boolean
  summaryText?: string
  availablePersonas: Persona[]
  availableStyles: StylePreset[]
  availableLorebooks: Lorebook[]
  activeStyleId?: string
  activeLorebookIds: string[]
  summarizing?: boolean
  visionEnabled?: boolean
  imageGenEnabled?: boolean
  onGenerateImage: () => void
}

/** Szerokosc progu swipe (px). */
const SWIPE_THRESHOLD = 55

export default function ChatView({
  character,
  messages,
  persona,
  isTyping,
  streamingText,
  replacingMessageId = null,
  onSend,
  onStop,
  onEditMessage,
  onDeleteMessage,
  onRegenerate,
  onSwitchVariant,
  onSwipeNext,
  onSwipePrev,
  onCloseSummary,
  onDeleteConversation,
  onPickPersona,
  onPickStyle,
  onToggleLorebook,
  onShowPrompt,
  onManualSummarize,
  onOpenMemoryEditor,
  showSummary,
  summaryText,
  availablePersonas,
  availableStyles,
  availableLorebooks,
  activeStyleId,
  activeLorebookIds,
  summarizing = false,
  visionEnabled = false,
  imageGenEnabled = false,
  onGenerateImage,
}: ChatViewProps) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [personaMenuOpen, setPersonaMenuOpen] = useState(false)
  const [styleMenuOpen, setStyleMenuOpen] = useState(false)
  const [lorebookMenuOpen, setLorebookMenuOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Tracking dotkniec dla swipe.
  const touchRef = useRef<{ id: string; x: number } | null>(null)

  const tokenContext: TokenContext = {
    charName: character.name,
    userName: persona.name,
    personaName: persona.name,
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamingText])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
        setPersonaMenuOpen(false)
        setStyleMenuOpen(false)
        setLorebookMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const startEdit = (msg: ChatMessage) => {
    setEditingId(msg.id)
    setEditDraft(getContent(msg))
  }

  const commitEdit = () => {
    if (editingId) onEditMessage(editingId, editDraft)
    setEditingId(null)
    setEditDraft('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft('')
  }

  const statusLabel =
    character.status === 'online'
      ? t('chatStatusOnline')
      : character.status === 'away'
        ? t('chatStatusAway')
        : t('chatStatusOffline')

  // Streaming na dole tylko w trybie 'append' (nie przy regeneracji).
  const showBottomStreaming = !!streamingText && !replacingMessageId

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-surface-dark">
      {/* Naglowek */}
      <div className="flex items-center gap-3 border-b border-edge bg-surface px-5 py-4">
        <Avatar src={character.portraitBlobId ?? character.portrait} name={character.name} size="sm" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[14.5px] font-semibold text-[#f2f2f4]">{character.name}</h1>
          <p className="mt-1 truncate text-[11.5px] text-[#75757f]">
            {statusLabel} · {character.role ?? ''}
          </p>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => {
              setMenuOpen((prev) => !prev)
              setPersonaMenuOpen(false)
              setStyleMenuOpen(false)
              setLorebookMenuOpen(false)
            }}
            title={t('chatMenuOptions')}
            className={`rounded-lg p-2 transition-colors ${
              menuOpen ? 'bg-surface-light text-white' : 'text-[#8a8a94] hover:bg-surface-light hover:text-white'
            }`}
          >
            <MoreVertical size={16} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 max-h-[70vh] w-56 overflow-y-auto rounded-xl border border-edge bg-surface shadow-lg shadow-black/30">
              <button
                onClick={() => {
                  setMenuOpen(false)
                  onShowPrompt()
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light"
              >
                <Eye size={14} />
                {t('chatShowPrompt')}
              </button>

              <button
                onClick={() => {
                  setPersonaMenuOpen((prev) => !prev)
                  setStyleMenuOpen(false)
                  setLorebookMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light"
              >
                <UserRound size={14} />
                Persona
              </button>

              {personaMenuOpen && (
                <div className="max-h-56 overflow-y-auto border-t border-edge bg-surface-light">
                  <button
                    onClick={() => {
                      onPickPersona(null)
                      setMenuOpen(false)
                      setPersonaMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#8a8a94] hover:bg-surface"
                  >
                    {t('chatUseDefaultPersona')}
                  </button>
                  {availablePersonas.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onPickPersona(p.id)
                        setMenuOpen(false)
                        setPersonaMenuOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-surface ${
                        p.id === persona.id ? 'bg-[#1e2436] text-white' : 'text-[#b8bdd0]'
                      }`}
                    >
                      <span className="truncate">{p.name}</span>
                      {p.id === persona.id && <Check size={13} className="ml-auto shrink-0 text-accent" />}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  setStyleMenuOpen((prev) => !prev)
                  setPersonaMenuOpen(false)
                  setLorebookMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light"
              >
                <Palette size={14} />
                Styl
              </button>

              {styleMenuOpen && (
                <div className="max-h-56 overflow-y-auto border-t border-edge bg-surface-light">
                  <button
                    onClick={() => {
                      onPickStyle(null)
                      setMenuOpen(false)
                      setStyleMenuOpen(false)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-[#8a8a94] hover:bg-surface"
                  >
                    {t('chatUseDefaultStyle')}
                  </button>
                  {availableStyles.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => {
                        onPickStyle(s.id)
                        setMenuOpen(false)
                        setStyleMenuOpen(false)
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-surface ${
                        s.id === activeStyleId ? 'bg-[#1e2436] text-white' : 'text-[#b8bdd0]'
                      }`}
                    >
                      <span className="truncate">{s.name}</span>
                      {s.id === activeStyleId && <Check size={13} className="ml-auto shrink-0 text-accent" />}
                    </button>
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  setLorebookMenuOpen((prev) => !prev)
                  setPersonaMenuOpen(false)
                  setStyleMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light"
              >
                <BookOpen size={14} />
                {t('lorebookTitle')}
              </button>

              {lorebookMenuOpen && (
                <div className="max-h-56 overflow-y-auto border-t border-edge bg-surface-light">
                  {availableLorebooks.length === 0 && (
                    <div className="px-3 py-2 text-[11.5px] text-[#75757f]">{t('lorebookEmpty')}</div>
                  )}
                  {availableLorebooks.map((l) => {
                    const isActive = activeLorebookIds.includes(l.id)
                    return (
                      <button
                        key={l.id}
                        onClick={() => {
                          onToggleLorebook(l.id)
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors hover:bg-surface"
                      >
                        <span className="min-w-0 flex-1 truncate text-[#b8bdd0]">{l.name}</span>
                        {isActive && <Check size={13} className="ml-auto shrink-0 text-accent" />}
                      </button>
                    )
                  })}
                </div>
              )}

              <button
                onClick={() => {
                  setMenuOpen(false)
                  onManualSummarize()
                }}
                disabled={summarizing}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light disabled:opacity-50"
              >
                <RotateCcw size={14} />
                {summarizing ? t('memoryGenerating') : t('memoryGenerate')}
              </button>

              <button
                onClick={() => {
                  setMenuOpen(false)
                  onOpenMemoryEditor()
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light"
              >
                <Database size={14} />
                {t('memoryButton')}
              </button>

              <div className="border-t border-edge">
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    setConfirmDelete(true)
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#e05b5b] transition-colors hover:bg-[#2a1a1a]"
                >
                  <Trash2 size={14} />
                  {t('chatMenuDelete')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Summarizer – wyswietlanie podsumowania */}
      {showSummary && summaryText && (
        <div className="mx-5 mt-3 flex items-start gap-2 rounded-xl border border-[#252b45] bg-[#161a2a] px-4 py-3.5">
          <p className="flex-1 text-[12.5px] leading-relaxed text-[#b8bdd0]">{summaryText}</p>
          <button
            onClick={onCloseSummary}
            className="rounded p-0.5 text-[#5a5f78] transition-colors hover:text-[#e8e8eb]"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Wiadomosci */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-5">
        {messages.map((msg, index) => {
          const isLast = index === messages.length - 1
          const canRegenerate = msg.role === 'assistant' || isLast
          const editing = editingId === msg.id
          const isReplacing = replacingMessageId === msg.id && !!streamingText
          const isUser = msg.role === 'user'

          return (
            <div
              key={msg.id}
              className={`group flex touch-pan-y ${isUser ? 'justify-end' : 'justify-start'}`}
              onTouchStart={(e) => {
                if (msg.role !== 'assistant') return
                touchRef.current = { id: msg.id, x: e.touches[0].clientX }
              }}
              onTouchEnd={(e) => {
                if (msg.role !== 'assistant') return
                const start = touchRef.current
                touchRef.current = null
                if (!start || start.id !== msg.id) return
                const delta = e.changedTouches[0].clientX - start.x
                if (Math.abs(delta) < SWIPE_THRESHOLD) return
                if (isTyping || isReplacing) return
                if (delta > 0) {
                  onSwipePrev?.(msg.id)
                } else {
                  onSwipeNext?.(msg.id)
                }
              }}
            >
              {/*
                Jeden wrapper na cala wiadomosc (bubble + actions).
                `items-end` dla usera, `items-start` dla asystenta — kazde
                dziecko (bubble, thinking, tool-call) jest wyrownane do
                wlasciwej strony i ma swoja naturalna szerokosc (bez stretch).
                max-w-[90%] cap na cala wiadomosc.
              */}
              <div
                className={`flex max-w-[90%] min-w-0 flex-col gap-1 ${
                  isUser ? 'items-end' : 'items-start'
                }`}
              >
                {editing ? (
                  <div className="w-full min-w-[300px] space-y-1.5">
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={5}
                      autoFocus
                      className="w-full min-w-[300px] resize-y rounded-xl border border-accent bg-surface px-4 py-3 text-[13.5px] leading-relaxed text-[#e8e8eb] outline-none"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button onClick={cancelEdit} className="rounded-md p-1 text-[#8a8a94] hover:bg-surface-light hover:text-white">
                        <XIcon size={14} />
                      </button>
                      <button onClick={commitEdit} className="rounded-md p-1 text-accent hover:bg-surface-light">
                        <Check size={14} />
                      </button>
                    </div>
                  </div>
                ) : isReplacing ? (
                  /* Podczas regeneracji: stara wiadomosc ukryta, streaming w jej miejscu. */
                  <ChatBubble
                    message={{
                      id: `streaming-${msg.id}`,
                      role: 'assistant',
                      variants: [{ content: streamingText }],
                      selectedVariant: 0,
                      timestamp: Date.now(),
                    }}
                    tokens={tokenContext}
                  />
                ) : (
                  <>
                    <ChatBubble message={msg} tokens={tokenContext} />
                    <MessageActions
                      role={msg.role}
                      variantIndex={msg.selectedVariant}
                      variantCount={msg.variants.length}
                      canRegenerate={canRegenerate}
                      onEdit={() => startEdit(msg)}
                      onDelete={() => onDeleteMessage(msg.id)}
                      onRegenerate={() => onRegenerate(msg.id)}
                      onPrevVariant={() => onSwitchVariant(msg.id, -1)}
                      onNextVariant={() => onSwitchVariant(msg.id, 1)}
                    />
                  </>
                )}
              </div>
            </div>
          )
        })}

        {/* Streaming na dole tylko w trybie 'append' */}
        {showBottomStreaming && (
          <div className="flex justify-start">
            <div className="flex max-w-[90%] min-w-0 flex-col gap-1 items-start">
              <ChatBubble
                message={{
                  id: 'streaming',
                  role: 'assistant',
                  variants: [{ content: streamingText }],
                  selectedVariant: 0,
                  timestamp: Date.now(),
                }}
                tokens={tokenContext}
              />
            </div>
          </div>
        )}

        {isTyping && !streamingText && (
          <div className="flex justify-start">
            <div className="flex gap-1.5 rounded-2xl rounded-bl-md border border-edge bg-surface-light px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5a5a64]"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 px-5 pb-5 pt-1">
        <InputBar
          onSend={onSend}
          onStop={onStop}
          isGenerating={isTyping || !!streamingText}
          visionEnabled={visionEnabled}
          imageGenEnabled={imageGenEnabled}
          onGenerateImage={onGenerateImage}
        />
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('chatMenuDelete')}
          description={t('chatDeleteConfirm')}
          onConfirm={() => {
            setConfirmDelete(false)
            onDeleteConversation()
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </main>
  )
}

// === END OF FILE ===

