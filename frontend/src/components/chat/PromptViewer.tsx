import { X } from 'lucide-react'
import type { OpenAIMessage } from '../../services/api'
import { useI18n } from '../../i18n'

interface PromptViewerProps {
  messages: OpenAIMessage[]
  model: string
  onClose: () => void
}

/**
 * Podgląd pełnego promptu wysłanego do LLM.
 * Pokazuje system prompt i każdą wiadomość osobno — bez kopania w JSON.
 * Obsługuje zarówno zwykłe stringi, jak i tablice dla vision (multimodal).
 */
export default function PromptViewer({ messages, model, onClose }: PromptViewerProps) {
  const { t } = useI18n()

  const formatContent = (content: string | any[]): string => {
    if (!content) return '(pusta treść)'
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (part.type === 'text') return part.text
          if (part.type === 'image_url') return `[OBRAZ: ${part.image_url?.url?.slice(0, 50)}...]`
          return JSON.stringify(part, null, 2)
        })
        .join('\n')
    }
    return String(content)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-5 py-3.5">
          <div className="flex-1">
            <h2 className="text-[15px] font-semibold text-[#f2f2f4]">{t('promptViewerTitle')}</h2>
            <p className="mt-0.5 text-[11.5px] text-[#75757f]">
              {t('promptViewerModel')}: {model || 'brak'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-[#8a8a94] hover:bg-surface-light hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-3">
          {!messages || messages.length === 0 ? (
            <div className="rounded-xl border border-dashed border-edge p-8 text-center text-[13px] text-[#75757f]">
              Brak wiadomości do wyświetlenia.
            </div>
          ) : (
            messages.map((msg, index) => (
              <div key={index} className="rounded-xl border border-edge bg-surface-light p-3.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                      msg.role === 'system'
                        ? 'bg-[#2a1a3d] text-[#c9a7f5]'
                        : msg.role === 'user'
                          ? 'bg-[#1e2436] text-[#8ab4f8]'
                          : msg.role === 'assistant'
                            ? 'bg-[#1f3a2a] text-[#7ee2a0]'
                            : 'bg-[#2a2a31] text-[#b8bdd0]'
                    }`}
                  >
                    {msg.role}
                  </span>
                  <span className="text-[10.5px] text-[#5a5f78]">#{index + 1}</span>
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-[#d0d0d8]">
                  {formatContent(msg.content)}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
