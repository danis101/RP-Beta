import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { FormattingPatterns, FormattingColors } from '../lib/formatting'
import { defaultPatterns, defaultColors } from '../lib/formatting'
import type { ApiProfile } from '../types'
import { settingsApi } from '../services/sync'
import { useI18n } from '../i18n'

/**
 * Ustawienia aplikacji.
 *
 * Zrodlo prawdy: serwer (/settings). localStorage zostaje jako cache
 * (przyspiesza start i unika "mrugania" domyslnymi wartosciami zanim
 * przyjdzie odpowiedz z serwera).
 *
 * Cykl zycia:
 *   1. Mount: probuje wczytac z localStorage (natychmiast, bez czekania)
 *   2. Rownolegle: fetch z serwera
 *      - sukces: podmienia stan (serwer > localStorage)
 *      - brak settings na serwerze (pierwszy login po aktualizacji):
 *        wgrywa lokalne/defaults na serwer
 *   3. Zmiany: setState lokalnie + PUT do serwera w tle (optimistic)
 *   4. WS event 'settings.changed' z innego urzadzenia: refetch
 *
 * Loading state: dopoki nie ma ani localStorage ani serwera - pokazuje
 * spinner. Zwykle trwa <100ms (localStorage natychmiast, serwer szybko).
 */

export interface AppSettings {
  formatting: FormattingPatterns
  formattingColors: FormattingColors
  defaultPersonaId: string
  aiProfiles: ApiProfile[]
  activeAiProfileId: string
  hideThinking: boolean
  defaultStyleId: string
  summarizerEnabled: boolean
  summarizerModel: string
  summarizerPrompt: string
  summarizerMessageCount: number
  summarizerThreshold: number
  webSearchEnabled: boolean
  webSearchEngine: string
  webSearchUrl: string
  webSearchApiKey?: string
  webSearchMaxResults: number
  webSearchShowResults: boolean
  webSearchCooldown: number
  imageGenEnabled: boolean
  imageGenBaseUrl: string
  imageGenResponseFormat: 'url' | 'b64_json'
  imageGenRefinerProfileId: string
  imageGenRefinerPrompt: string
  imageGenContextMessages: number
}

interface SettingsContextType {
  settings: AppSettings
  loading: boolean
  updateSettings: (partial: Partial<AppSettings>) => void
  updateAiProfile: (profile: ApiProfile) => void
  addAiProfile: (profile: ApiProfile) => void
  deleteAiProfile: (id: string) => void
  setActiveAiProfile: (id: string) => void
  setDefaultStyle: (id: string) => void
  /** Reczne dociagniecie z serwera (uzywane przez WS listener w App). */
  refreshFromServer: () => Promise<void>
}

const SETTINGS_KEY = 'rp-settings'

function defaultAiProfile(): ApiProfile {
  return {
    id: crypto.randomUUID(),
    name: 'Default',
    baseUrl: '',
    apiKey: '',
    model: '',
    sampler: { temperature: 0.7, topP: 0.95, topK: 40, frequencyPenalty: 0, presencePenalty: 0 },
    maxTokens: 512,
    contextLength: 8192,
    streamingEnabled: true,
    memoryMessages: 20,
    visionEnabled: false,
    visionModel: '',
  }
}

function defaultSummarizerPrompt(): string {
  return `Jestes asystentem podsumowujacym historie rozmowy. Otrzymujesz dotychczasowe podsumowanie oraz nowe wiadomosci. Twoim zadaniem jest zaktualizowac podsumowanie, dodajac najwazniejsze wydarzenia, decyzje, fakty i zmiany w relacjach miedzy postaciami. Zachowaj zwiezlosc (max 200 slow) i trzymaj sie faktow. Nie dodawaj wlasnych komentarzy ani ocen.`
}

function defaultImageGenRefinerPrompt(): string {
  return `Jestes ekspertem od promptow do generowania obrazow. Otrzymujesz karte postaci (JSON) oraz fragment rozmowy. Twoim zadaniem jest napisac JEDEN spojny, szczegolowy pozytywny prompt do modelu tekst-do-obrazu, opisujacy postac dokladnie tak, jak wyglada w karcie (twarz, sylwetka, wlosy, oczy, stroj, cechy charakterystyczne) oraz biezaca scene z rozmowy.

Zwroc WYLACZNIE sam prompt, bez komentarzy. Rozpocznij go od tagu stylu, np.:
[STYLE: Photorealistic] ...opis...

Jesli potrzebujesz, mozesz dodac [FORMAT: portrait|landscape|square]. Nie dodawaj nic poza promptem.`
}

/** Defaults dla nowego usera (swiezo po loginie, brak settings na serwerze). */
function defaultSettings(): AppSettings {
  const initial = defaultAiProfile()
  return {
    formatting: defaultPatterns,
    formattingColors: defaultColors,
    defaultPersonaId: '',
    aiProfiles: [initial],
    activeAiProfileId: initial.id,
    hideThinking: false,
    defaultStyleId: '',
    summarizerEnabled: false,
    summarizerModel: '',
    summarizerPrompt: defaultSummarizerPrompt(),
    summarizerMessageCount: 30,
    summarizerThreshold: 10,
    webSearchEnabled: false,
    webSearchEngine: 'searxng',
    webSearchUrl: 'http://192.168.100.80:8080',
    webSearchApiKey: '',
    webSearchMaxResults: 5,
    webSearchShowResults: true,
    webSearchCooldown: 2,
    imageGenEnabled: false,
    imageGenBaseUrl: '',
    imageGenResponseFormat: 'url',
    imageGenRefinerProfileId: '',
    imageGenRefinerPrompt: defaultImageGenRefinerPrompt(),
    imageGenContextMessages: 6,
  }
}

/**
 * Wczytuje z localStorage. Mozliwe ze to stare dane z poprzednich wersji
 * (przed Etapem 2 - mialy stylePresets/lorebooks). Te pola sa ignorowane
 * (nie ma ich w AppSettings), a brakujace uzupelniamy defaults.
 */
function loadFromLocalStorage(): AppSettings | null {
  const raw = localStorage.getItem(SETTINGS_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      baseUrl?: string
      apiKey?: string
      model?: string
      temperature?: number
    }

    const defaults = defaultSettings()

    let aiProfiles: ApiProfile[] = parsed.aiProfiles ?? []
    if ((!aiProfiles || aiProfiles.length === 0) && parsed.baseUrl) {
      const migrated = defaultAiProfile()
      migrated.baseUrl = parsed.baseUrl ?? ''
      migrated.apiKey = parsed.apiKey ?? ''
      migrated.model = parsed.model ?? ''
      if (parsed.temperature !== undefined) migrated.sampler.temperature = parsed.temperature
      aiProfiles = [migrated]
    }

    return {
      ...defaults,
      ...parsed,
      formatting: parsed.formatting ?? defaults.formatting,
      formattingColors: parsed.formattingColors ?? defaults.formattingColors,
      aiProfiles: aiProfiles.length > 0 ? aiProfiles : defaults.aiProfiles,
      activeAiProfileId: parsed.activeAiProfileId ?? aiProfiles[0]?.id ?? defaults.activeAiProfileId,
    }
  } catch (e) {
    console.warn('Blad parsowania ustawien z localStorage:', e)
    localStorage.removeItem(SETTINGS_KEY)
    return null
  }
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()

  // Inicjalizacja: localStorage (jesli jest) albo defaults.
  // Stan poczatkowy jest natychmiastowy - brak mrugania.
  const [settings, setSettings] = useState<AppSettings>(() => loadFromLocalStorage() ?? defaultSettings())
  const [loading, setLoading] = useState(true)

  // Ref na najswiezsze settings - do unikania stale closure w debounced save.
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // Debounce timera PUT (zmiany szybkie - np. suwak - nie zapisujemy kazdej).
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistLocal = (next: AppSettings): AppSettings => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    return next
  }

  /** Zapisz na serwer z debounce 500ms (chroni przed spamem przy suwakach). */
  const scheduleSave = (): void => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void settingsApi.save(settingsRef.current).catch((err) => {
        console.warn('Zapis ustawien na serwer nie powiodl sie:', err)
      })
    }, 500)
  }

  // Przy mount: fetch z serwera.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const remote = await settingsApi.get()
        if (cancelled) return

        if (remote) {
          // Serwer ma settings - uzywamy ich (zrodlo prawdy).
          setSettings(persistLocal(remote))
        } else {
          // Serwer nie ma - wgrywamy to co mamy lokalnie (migracja).
          await settingsApi.save(settingsRef.current)
        }
      } catch (err) {
        // Blad sieci - zostajemy z localStorage, sprobujemy pozniej.
        console.warn('Nie udalo sie pobrac ustawien z serwera:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  /** Reczne dociagniecie z serwera (wywolywane przez WS listener w App). */
  const refreshFromServer = async (): Promise<void> => {
    try {
      const remote = await settingsApi.get()
      if (remote) {
        setSettings(persistLocal(remote))
      }
    } catch (err) {
      console.warn('Refresh ustawien z serwera nie powiodl sie:', err)
    }
  }

  const updateSettings = (partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = persistLocal({ ...prev, ...partial })
      scheduleSave()
      return next
    })
  }

  const updateAiProfile = (profile: ApiProfile) => {
    setSettings((prev) => {
      const next = persistLocal({
        ...prev,
        aiProfiles: prev.aiProfiles.map((p) => (p.id === profile.id ? profile : p)),
      })
      scheduleSave()
      return next
    })
  }

  const addAiProfile = (profile: ApiProfile) => {
    setSettings((prev) => {
      const next = persistLocal({ ...prev, aiProfiles: [...prev.aiProfiles, profile] })
      scheduleSave()
      return next
    })
  }

  const deleteAiProfile = (id: string) => {
    setSettings((prev) => {
      const profiles = prev.aiProfiles.filter((p) => p.id !== id)
      const activeId = prev.activeAiProfileId === id ? profiles[0]?.id ?? '' : prev.activeAiProfileId
      const next = persistLocal({ ...prev, aiProfiles: profiles, activeAiProfileId: activeId })
      scheduleSave()
      return next
    })
  }

  const setActiveAiProfile = (id: string) => {
    setSettings((prev) => {
      const next = persistLocal({ ...prev, activeAiProfileId: id })
      scheduleSave()
      return next
    })
  }

  const setDefaultStyle = (id: string) => {
    setSettings((prev) => {
      const next = persistLocal({ ...prev, defaultStyleId: id })
      scheduleSave()
      return next
    })
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-dark text-[13px] text-[#75757f]">
        {t('settingsLoading')}
      </div>
    )
  }

  return (
    <SettingsContext.Provider
      value={{
        settings,
        loading,
        updateSettings,
        updateAiProfile,
        addAiProfile,
        deleteAiProfile,
        setActiveAiProfile,
        setDefaultStyle,
        refreshFromServer,
      }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextType {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings must be used within SettingsProvider')
  }
  return ctx
}

export { defaultAiProfile }
