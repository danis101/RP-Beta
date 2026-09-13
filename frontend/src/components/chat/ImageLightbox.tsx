import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ImageLightboxProps {
  src: string
  onClose: () => void
}

/**
 * Pełnoekranowy podgląd zdjęcia (jak w Messengerze).
 * Kliknięcie w dowolne miejsce (w tym w zdjęcie) zamyka.
 */
export default function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement
    closeButton.current?.focus({ preventScroll: true })
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [])

  // Poza drzewem wiadomości: transformacje i przewijanie czatu nie ograniczają podglądu.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Podgląd zdjęcia"
      className="fixed inset-x-0 z-[100] flex items-center justify-center bg-black/95 cursor-zoom-out sm:p-6"
      style={{ top: 'var(--app-top, 0px)', height: 'var(--app-height, 100dvh)' }}
      onClick={(event) => {
        event.stopPropagation()
        onClose()
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') onClose()
        if (event.key === 'Tab') {
          event.preventDefault()
          closeButton.current?.focus()
        }
      }}
    >
      <img
        src={src}
        alt=""
        className="h-full w-full object-contain sm:rounded-lg"
      />
      <button
        ref={closeButton}
        type="button"
        aria-label="Zamknij podgląd zdjęcia"
        className="absolute right-3 top-3 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
        style={{ top: 'max(0.75rem, env(safe-area-inset-top))', right: 'max(0.75rem, env(safe-area-inset-right))' }}
        title="Zamknij"
      >
        <X size={20} />
      </button>
    </div>,
    document.body,
  )
}
