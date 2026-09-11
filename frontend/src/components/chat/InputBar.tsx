import { useEffect, useRef, useState } from 'react'
import { Send, Square, Plus, X, Image as ImageIcon, Wand2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { MessageAttachment } from '../../types'

interface InputBarProps {
  onSend: (text: string, attachments?: MessageAttachment[]) => void
  onStop: () => void
  isGenerating: boolean
  visionEnabled?: boolean
  imageGenEnabled?: boolean
  onGenerateImage: () => void
}

/**
 * Pole wpisywania wiadomości z dynamicznym rozszerzaniem (textarea).
 * Enter wysyła, Shift+Enter nowa linia. Przycisk Send/Stop po prawej.
 * Przycisk plusa po lewej rozwija menu: „Załącz obraz” (img2txt, jeśli
 * visionEnabled) oraz „Generuj obraz” (txt2img, jeśli imageGenEnabled).
 */
export default function InputBar({ onSend, onStop, isGenerating, visionEnabled = false, imageGenEnabled = false, onGenerateImage }: InputBarProps) {
  const { t } = useI18n()
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  const [plusOpen, setPlusOpen] = useState(false)
  const plusRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      const reader = new FileReader()
      reader.onload = () => {
        const data = reader.result as string
        setAttachments((prev) => [
          ...prev,
          { type: 'image', data, name: file.name },
        ])
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      {/* Podgląd załączników */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att, idx) => (
            <div key={idx} className="relative group">
              <img
                src={att.data}
                alt={att.name || 'załącznik'}
                className="h-16 w-16 rounded-lg border border-edge object-cover"
              />
              <button
                onClick={() => removeAttachment(idx)}
                className="absolute -right-1 -top-1 rounded-full bg-[#2a1a1a] p-0.5 text-[#e05b5b] hover:bg-[#3a1a1a]"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2.5">
        {(visionEnabled || imageGenEnabled) && (
          <div className="relative" ref={plusRef}>
            <button
              onClick={() => setPlusOpen((prev) => !prev)}
              title="Załącz / generuj"
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
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (isGenerating) return
              handleSubmit()
            }
          }}
          placeholder={t('chatPlaceholder')}
          rows={1}
          className="max-h-[200px] flex-1 resize-none rounded-2xl border border-[#2a2a31] bg-surface-dark px-4 py-2.5 text-[13.5px] leading-relaxed text-[#e8e8eb] outline-none transition-colors placeholder:text-[#75757f] focus:border-accent"
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
            disabled={!value.trim() && attachments.length === 0}
            className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
