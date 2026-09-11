import { useState } from 'react'
import { Globe, ChevronDown, ExternalLink, Search, AlertCircle, Loader2, ImageOff } from 'lucide-react'
import type { ChatMessage, ToolCall } from '../../types'
import { getSelectedVariant } from '../../lib/messages'
import { renderFormattedText } from '../../lib/FormattedText'
import { substituteTokens, type TokenContext } from '../../lib/tokens'
import { useBlobSrc } from '../../lib/blobCache'
import { useSettings } from '../../context/SettingsContext'
import ImageLightbox from './ImageLightbox'

interface ChatBubbleProps {
  message: ChatMessage
  tokens?: TokenContext
}

/**
 * Pojedyncza wiadomosc w czacie.
 *
 * Zwraca Fragment z dziecmi (thinking / bubble / tool-call / attachments).
 * NIE ma wlasnego wrappera flex — wyrownanie (lewo/prawo) i max-width sa
 * ustawiane przez rodzica (ChatView) na `flex-col items-end/items-start`.
 *
 * Bubble tekstowy uzywa `w-fit`:
 *   - `w-fit`     = fit-content — naturalna szerokosc tekstu, ale nie mniej
 *                   niz min-content (najdluzsze slowo); gdy parent ma
 *                   items-*, dziecko nie stretchuje sie, wiec fit-content
 *                   daje dokladnie szerokosc tekstu.
 *   - `max-w-full`= cap do szerokosci rodzica (ktory ma max-w-[90%]).
 *
 * To rozwiazuje problem krotkich wiadomosci ("jeszcze jeden") ktore
 * wczesniej lamaly sie na dwie linie przez podwojny max-w i min-w-0.
 */
export default function ChatBubble({ message, tokens }: ChatBubbleProps) {
  const { settings } = useSettings()
  const isUser = message.role === 'user'
  const variant = getSelectedVariant(message)
  const [thinkingOpen, setThinkingOpen] = useState(false)
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const [resultsOpen, setResultsOpen] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)

  const rawContent = tokens ? substituteTokens(variant.content, tokens) : variant.content
  const thinking = variant.thinking
  const showThinking = !settings.hideThinking && !!thinking && !isUser
  const attachments = variant.attachments ?? []
  const toolCall = variant.toolCall

  const showResults = settings.webSearchShowResults ?? true

  const openLightbox = (src: string) => setLightboxSrc(src)

  const imageSrc = useBlobSrc(toolCall?.type === 'image' ? (toolCall.imageBlobId ?? toolCall.imageUrl) : undefined)

  const imageTool = toolCall?.type === 'image' ? toolCall : undefined

  return (
    <>
      {/* Thinking section — pelna szerokosc wrappera */}
      {showThinking && (
        <div className="w-full overflow-hidden rounded-xl border border-[#252a3d] bg-surface">
          <button
            onClick={() => setThinkingOpen((prev) => !prev)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11.5px] font-medium text-[#8a94b8] transition-colors hover:bg-surface-light"
          >
            <ChevronDown size={12} className={`shrink-0 transition-transform ${thinkingOpen ? 'rotate-180' : ''}`} />
            thinking
          </button>
          {thinkingOpen && (
            <div className="border-t border-[#252a3d] px-3 py-2 text-[12px] leading-relaxed text-[#8a8a94]">
              {thinking}
            </div>
          )}
        </div>
      )}

      {/* Message content + obrazek w dymku (gdy jest tekst) */}
      {rawContent ? (
        <div
          className={`w-fit max-w-full whitespace-pre-wrap break-words px-3.5 py-2.5 text-[13.5px] leading-relaxed ${
            isUser
              ? 'rounded-2xl rounded-br-md bg-accent text-white'
              : 'rounded-2xl rounded-bl-md border border-edge bg-surface-light text-[#e8e8eb]'
          }`}
        >
          {isUser
            ? rawContent
            : renderFormattedText(
                rawContent,
                settings.formatting,
                settings.formattingColors,
                openLightbox,
              )}
          {imageTool && (
            <ImageInBubble
              toolCall={imageTool}
              imageSrc={imageSrc}
              imageFailed={imageFailed}
              onImageError={() => setImageFailed(true)}
              onImageClick={openLightbox}
            />
          )}
        </div>
      ) : null}

      {/* Sam obrazek (bez tekstu) - poza dymkiem */}
      {!rawContent && imageTool && (
        <ImageStandalone
          toolCall={imageTool}
          imageSrc={imageSrc}
          imageFailed={imageFailed}
          onImageError={() => setImageFailed(true)}
          onImageClick={openLightbox}
        />
      )}

      {/* Tool call - websearch */}
      {toolCall?.type === 'websearch' && toolCall.results && toolCall.results.length > 0 && (
        showResults ? (
          <div className="w-full overflow-hidden rounded-xl border border-[#252a3d] bg-surface">
            <button
              onClick={() => setResultsOpen((prev) => !prev)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-medium text-[#8a94b8] transition-colors hover:bg-surface-light"
            >
              <Search size={14} className="shrink-0 text-accent" />
              <span className="flex-1">Websearch: {toolCall.label}</span>
              <span className="text-[10.5px] text-[#6a6a72]">{toolCall.results.length} wynikow</span>
              <ChevronDown size={12} className={`shrink-0 transition-transform ${resultsOpen ? 'rotate-180' : ''}`} />
            </button>
            {resultsOpen && (
              <div className="border-t border-[#252a3d] p-3 space-y-2 max-h-60 overflow-y-auto">
                {toolCall.results.map((result, idx) => (
                  <div key={idx} className="rounded-lg border border-edge bg-surface-light p-2.5 hover:bg-surface">
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2 text-[12.5px] text-accent hover:underline"
                    >
                      <span className="flex-1 font-medium">{result.title}</span>
                      <ExternalLink size={12} className="shrink-0 mt-0.5" />
                    </a>
                    <p className="mt-0.5 text-[11.5px] text-[#9a9aa3]">{result.snippet}</p>
                    <p className="mt-0.5 text-[10.5px] text-[#6a6a72]">{result.source}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#252a3d] bg-surface px-3 py-2 text-xs text-[#8a94b8]">
            <Search size={14} className="shrink-0 text-accent" />
            <span>Websearch: {toolCall.label}</span>
            <span className="text-[10.5px] text-[#6a6a72]">{toolCall.results.length} wynikow</span>
          </div>
        )
      )}

      {/* Attachments od usera */}
      {attachments.map((att, idx) => (
        <AttachmentImage
          key={idx}
          blobId={att.blobId}
          legacyData={att.data}
          name={att.name}
          onImageClick={openLightbox}
        />
      ))}

      {/* Fallback tool call */}
      {toolCall && toolCall.type !== 'websearch' && toolCall.type !== 'image' && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#2c2c3a] bg-[#14151c] px-3 py-2 text-xs text-[#9a9aa8]">
          <Globe size={14} className="shrink-0" />
          <span>{toolCall.label}</span>
        </div>
      )}

      {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  )
}

/**
 * Obrazek tool call renderowany wewnatrz dymka (gdy jest tez tekst).
 */
function ImageInBubble({
  toolCall,
  imageSrc,
  imageFailed,
  onImageError,
  onImageClick,
}: {
  toolCall: ToolCall
  imageSrc: string | undefined
  imageFailed: boolean
  onImageError: () => void
  onImageClick: (src: string) => void
}) {
  if (toolCall.status === 'error') {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-lg border border-dashed border-[#3a2a2a] bg-[#1a1212] px-2.5 py-1.5 text-[11.5px] text-[#e05b5b]">
        <AlertCircle size={12} className="shrink-0" />
        <span>{toolCall.error || 'Blad generowania obrazu.'}</span>
      </div>
    )
  }
  if (!imageSrc || imageFailed) {
    if (imageFailed) {
      return (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-[#9a8a8a]">
          <ImageOff size={12} className="shrink-0" />
          <span>Nie mozna wyswietlic obrazu</span>
        </div>
      )
    }
    return (
      <div className="mt-2 flex items-center gap-2 text-[11.5px] text-[#8a94b8]">
        <Loader2 size={12} className="shrink-0 animate-spin text-accent" />
        <span>Generowanie obrazu...</span>
      </div>
    )
  }
  return (
    <img
      src={imageSrc}
      alt={toolCall.label}
      onError={onImageError}
      className="mt-2 block max-h-[320px] w-auto max-w-full cursor-zoom-in rounded-lg object-contain transition-opacity hover:opacity-90"
      onClick={() => onImageClick(imageSrc)}
    />
  )
}

/**
 * Sam obrazek (bez tekstu) - poza dymkiem, samodzielny element.
 */
function ImageStandalone({
  toolCall,
  imageSrc,
  imageFailed,
  onImageError,
  onImageClick,
}: {
  toolCall: ToolCall
  imageSrc: string | undefined
  imageFailed: boolean
  onImageError: () => void
  onImageClick: (src: string) => void
}) {
  if (toolCall.status === 'error') {
    return (
      <div className="flex max-w-[280px] items-start gap-2 rounded-lg border border-[#3a2a2a] bg-[#1a1212] px-3 py-2 text-[11.5px] text-[#e05b5b]">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <span>{toolCall.error || 'Blad generowania obrazu.'}</span>
      </div>
    )
  }
  if (!imageSrc || imageFailed) {
    if (imageFailed) {
      return (
        <div className="flex max-w-[280px] items-start gap-2 rounded-lg border border-[#3a2a2a] bg-[#1a1212] px-3 py-2 text-[11.5px] text-[#e05b5b]">
          <ImageOff size={14} className="mt-0.5 shrink-0" />
          <span>Nie mozna wyswietlic obrazu</span>
        </div>
      )
    }
    return (
      <div className="flex items-center gap-2 rounded-xl border border-dashed border-[#252a3d] bg-surface px-3 py-2 text-xs text-[#8a94b8]">
        <Loader2 size={14} className="shrink-0 animate-spin text-accent" />
        <span>Generowanie obrazu...</span>
      </div>
    )
  }
  return (
    <img
      src={imageSrc}
      alt={toolCall.label}
      onError={onImageError}
      className="max-h-[280px] max-w-[280px] cursor-zoom-in rounded-lg border border-edge object-cover transition-opacity hover:opacity-90"
      onClick={() => onImageClick(imageSrc)}
    />
  )
}

/** Zalacznik obrazu od usera. */
function AttachmentImage({
  blobId,
  legacyData,
  name,
  onImageClick,
}: {
  blobId?: string
  legacyData?: string
  name?: string
  onImageClick: (src: string) => void
}) {
  const src = useBlobSrc(blobId ?? legacyData)
  if (!src) return null
  return (
    <img
      src={src}
      alt={name || 'obraz'}
      className="max-h-[280px] max-w-[280px] cursor-zoom-in rounded-lg border border-edge object-cover transition-opacity hover:opacity-90"
      onClick={() => onImageClick(src)}
    />
  )
}

