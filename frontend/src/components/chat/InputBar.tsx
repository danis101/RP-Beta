import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Send, Square, Plus, X, Image as ImageIcon, Wand2, Loader2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { MessageAttachment } from '../../types'
import { uploadBlobFromFile } from '../../services/sync'
import { useBlobSrc } from '../../lib/blobCache'

interface InputBarProps {
  onSend: (text: string, attachments?: MessageAttachment[]) => void
  onStop: () => void
  isGenerating: boolean
  visionEnabled?: boolean
  imageGenEnabled?: boolean
  onGenerateImage: () => void
}

/**
 * Pole wpisywania wiadomosci z dynamicznym rozszerzaniem (textarea).
 * Enter wysyla, Shift+Enter nowa linia.
 *
 * Zalaczniki: plik od razu jest uploadowany na /blobs, w stanie trzymamy
 * tylko blobId (sha256). Podglad renderuje sie przez useBlobSrc.
 */
export default function InputBar({
  onSend,
  onStop,
  isGenerating,
  visionEnabled = false,
  imageGenEnabled = false,
  onGenerateImage,
}: InputBarProps) {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  const [uploadingCount, setUploadingCount] = useState(0)
  const [plusOpen, setPlusOpen] = useState(false)
  const plusRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // React aktualizuje wartosc textarea przed przywroceniem kursora/zaznaczenia.
  useLayoutEffect(() => {
    const selection = pendingSelectionRef.current
    const el = textareaRef.current
    if (!selection || !el) return
    pendingSelectionRef.current = null
    el.setSelectionRange(selection.start, selection.end)
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const insertPair = (marker: string) => {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: start, selectionEnd: end } = el
    pendingSelectionRef.current = { start: start + marker.length, end: end + marker.length }
    // Fokus w obsludze klikniecia pozwala kontynuowac pisanie na telefonie.
    el.focus({ preventScroll: true })
    setValue(el.value.slice(0, start) + marker + el.value.slice(start, end) + marker + el.value.slice(end))
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) {
        setPlusOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSubmit = () => {
    const text = value.trim()
    if (!text && attachments.length === 0) return
    if (uploadingCount > 0) return
    onSend(text, attachments.length > 0 ? attachments : undefined)
    setValue('')
    setAttachments([])
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }
    })
  }

  const autoResize = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  /** Upload plikow od razu na /blobs, do stanu trafia tylko blobId. */
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    e.target.value = ''

    if (list.length === 0) return

    setUploadingCount((prev) => prev + list.length)

    for (const file of list) {
      try {
        const blobId = await uploadBlobFromFile(file)
        setAttachments((prev) => [...prev, { type: 'image', blobId, name: file.name }])
      } catch (err) {
        console.error('Upload zalacznika nie powiodl sie:', err)
        alert(err instanceof Error ? err.message : String(err))
      } finally {
        setUploadingCount((prev) => Math.max(0, prev - 1))
      }
    }
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  const canSend = (value.trim() || attachments.length > 0) && uploadingCount === 0

  return (
    <div className="space-y-2">
      <div className="flex justify-end gap-1.5 md:hidden">
        {[
          { marker: '"', label: 'chatInsertQuotes' },
          { marker: '*', label: 'chatInsertAsterisks' },
          { marker: '`', label: 'chatInsertBackticks' },
        ].map(({ marker, label }) => (
          <button
            key={marker}
            type="button"
            aria-label={t(label)}
            title={t(label)}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => insertPair(marker)}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-edge bg-surface font-mono text-base text-[#b8bdd0] active:bg-surface-light"
          >
            {marker + marker}
          </button>
        ))}
      </div>
      {/* Podglad zalacznikow */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att, idx) => (
            <AttachmentPreview
              key={idx}
              blobId={att.blobId}
              legacyData={att.data}
              name={att.name}
              onRemove={() => removeAttachment(idx)}
            />
          ))}
        </div>
      )}

      <div className="flex min-w-0 items-end gap-2 md:gap-2.5">
        {(visionEnabled || imageGenEnabled) && (
          <div className="relative" ref={plusRef}>
            <button
              onClick={() => setPlusOpen((prev) => !prev)}
              title="Zalacz / generuj"
              className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border border-edge transition-colors ${
                plusOpen ? 'bg-surface-light text-white' : 'bg-surface text-[#8a8a94] hover:bg-surface-light hover:text-white'
              }`}
            >
              <Plus size={18} />
            </button>

            {plusOpen && (
              <div className="absolute bottom-full left-0 z-50 mb-2 w-52 overflow-hidden rounded-xl border border-edge bg-surface shadow-lg shadow-black/30">
                {visionEnabled && (
                  <button
                    onClick={() => {
                      setPlusOpen(false)
                      fileInputRef.current?.click()
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light"
                  >
                    <ImageIcon size={14} />
                    {t('imageGenAttachImage')}
                  </button>
                )}
                {imageGenEnabled && (
                  <button
                    onClick={() => {
                      setPlusOpen(false)
                      onGenerateImage()
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light"
                  >
                    <Wand2 size={14} />
                    {t('imageGenButton')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            autoResize()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              if (isGenerating) return
              handleSubmit()
            }
          }}
          placeholder={t('chatPlaceholder')}
          rows={1}
          className="chat-input min-w-0 flex-1 resize-none rounded-2xl border border-[#2a2a31] bg-surface-dark px-3 py-2.5 text-base leading-relaxed text-[#e8e8eb] outline-none transition-colors placeholder:text-[#75757f] focus:border-accent md:px-4 md:text-[13.5px]"
        />

        {isGenerating ? (
          <button
            onClick={onStop}
            title="Zatrzymaj generowanie"
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-[#e05b5b] text-white transition-colors hover:bg-[#c74444]"
          >
            <Square size={15} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!canSend}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {uploadingCount > 0 ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        )}
      </div>
    </div>
  )
}

/** Podglad zalacznika w InputBar - rozwiazuje blobId przez useBlobSrc. */
function AttachmentPreview({
  blobId,
  legacyData,
  name,
  onRemove,
}: {
  blobId?: string
  legacyData?: string
  name?: string
  onRemove: () => void
}) {
  const src = useBlobSrc(blobId ?? legacyData)
  return (
    <div className="relative group">
      {src ? (
        <img
          src={src}
          alt={name || 'zalacznik'}
          className="h-16 w-16 rounded-lg border border-edge object-cover"
        />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-edge bg-surface">
          <Loader2 size={14} className="animate-spin text-[#8a8a94]" />
        </div>
      )}
      <button
        onClick={onRemove}
        className="absolute -right-1 -top-1 rounded-full bg-[#2a1a1a] p-0.5 text-[#e05b5b] hover:bg-[#3a1a1a]"
      >
        <X size={12} />
      </button>
    </div>
  )
}

// === END OF FILE ===
