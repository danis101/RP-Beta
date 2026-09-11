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
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-6"
      onClick={onClose}
    >
      <img
        src={src}
        alt=""
        className="max-h-[85vh] max-w-[85vw] cursor-zoom-out rounded-lg object-contain shadow-2xl"
      />
      <button
        onClick={onClose}
        className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
        title="Zamknij"
      >
        <X size={20} />
      </button>
    </div>
  )
}
