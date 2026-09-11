import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

export interface ConflictBanner {
  /** Unikalny ID (do kluczowania w liscie, jesli kiedys bedzie ich wiele). */
  id: string
  /** Krotki tytul, np. "Ta konwersacja zmienila sie na innym urzadzeniu". */
  title: string
  /** Opcjonalny podtytul. */
  description?: string
  /** Akcja "Odswiez" - co ma sie stac gdy user kliknie. */
  onRefresh?: () => void
  /** Akcja "Zamknij". */
  onDismiss?: () => void
}

interface ConflictContextValue {
  banners: ConflictBanner[]
  pushBanner: (banner: Omit<ConflictBanner, 'id'>) => void
  dismissBanner: (id: string) => void
}

const ConflictContext = createContext<ConflictContextValue | null>(null)

/**
 * Globalna warstwa powiadomien o konfliktach sync.
 *
 * Gdy zapis encji zwroci 409 (ktos zmodyfikowal ja na innym urzadzeniu),
 * App.tsx pushuje banner tutaj, a komponent <ConflictBanners /> wyswietla
 * go na gorze ekranu. User klika "Odswiez" (przyjmuje wersje z serwera)
 * albo zamyka banner.
 */
export function ConflictProvider({ children }: { children: ReactNode }) {
  const [banners, setBanners] = useState<ConflictBanner[]>([])

  const pushBanner = useCallback((banner: Omit<ConflictBanner, 'id'>) => {
    const id = crypto.randomUUID()
    setBanners((prev) => [...prev, { ...banner, id }])
  }, [])

  const dismissBanner = useCallback((id: string) => {
    setBanners((prev) => prev.filter((b) => b.id !== id))
  }, [])

  return (
    <ConflictContext.Provider value={{ banners, pushBanner, dismissBanner }}>
      {children}
    </ConflictContext.Provider>
  )
}

export function useConflict(): ConflictContextValue {
  const ctx = useContext(ConflictContext)
  if (!ctx) throw new Error('useConflict must be used within ConflictProvider')
  return ctx
}
