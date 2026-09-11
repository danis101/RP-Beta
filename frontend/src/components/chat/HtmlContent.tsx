import { useEffect, useRef } from 'react'

interface HtmlContentProps {
  html: string
  onImageClick?: (src: string) => void
}

/**
 * Renderuje sanityzowany HTML i deleguje kliknięcia w obrazy
 * do callbacku (otwiera lightbox).
 * Dzięki temu `<img>` z kart postaci działa jak miniaturka,
 * a kliknięcie powiększa.
 */
export default function HtmlContent({ html, onImageClick }: HtmlContentProps) {
  const ref = useRef<HTMLDivElement>(null)
  const callbackRef = useRef(onImageClick)

  useEffect(() => {
    callbackRef.current = onImageClick
  }, [onImageClick])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'IMG') {
        const img = target as HTMLImageElement
        callbackRef.current?.(img.src)
      }
    }

    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [])

  return <div ref={ref} className="card-html" dangerouslySetInnerHTML={{ __html: html }} />
}
