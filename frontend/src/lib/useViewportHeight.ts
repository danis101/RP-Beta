import { useEffect } from 'react'

/** Android moze zmniejszyc tylko visualViewport po otwarciu klawiatury. */
export function useViewportHeight(): void {
  useEffect(() => {
    const root = document.documentElement
    const viewport = window.visualViewport
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Nie zmieniamy ukladu podczas powiekszania strony gestem.
        if (viewport && viewport.scale !== 1) return
        root.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`)
        root.style.setProperty('--app-top', `${viewport?.offsetTop ?? 0}px`)
      })
    }
    update()
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      root.style.removeProperty('--app-height')
      root.style.removeProperty('--app-top')
    }
  }, [])
}
