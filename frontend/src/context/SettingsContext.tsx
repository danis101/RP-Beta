import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { FormattingPatterns, FormattingColors } from '../lib/formatting'
import { defaultPatterns, defaultColors } from '../lib/formatting'
import type { ApiProfile } from '../types'
import { settingsApi } from '../services/sync'
import { useI18n } from '../i18n'
import { useAuth } from './AuthContext'

/**
 * Ustawienia aplikacji.
 *
 * Zrodlo prawdy: serwer (/settings). localStorage zostaje jako cache
 * per-user (klucz `rp-settings:<userId>`), zeby:
 *   - przyspieszyc start (bez "mrugania" domyslnymi wartosciami)
 *   - NIE przeciekac miedzy kontami na tej samej przegladarce
 *
 * Wczesniejsza wersja uzywala globalnego klucza `rp-settings` — to powodowalo
 * ze po zalogowaniu nowego usera jego cache startowy zawieral dane poprzedniego
 * (w tym profile API z apiKey). Teraz klucz jest per-user, a stary globalny
 * klucz jest jednorazowo czyszczony przy starcie (bez migracji - swiadomie,
 * zeby nie przypisac cudzych ustawien do pierwszego zalogowanego usera).
 *
 * Cykl zycia:
 *   1. Mount: wczytaj z `rp-settings:<userId>` (natychmiast, bez czekania)
 *   2. Rownolegle: fetch z serwera
 *      - sukces: podmienia stan (serwer > cache)
 *      - brak na serwerze (pierwszy login): wgrywa biezace (cache/defaults)
 *   3. Zmiany: setState lokalnie + PUT do serwera w tle (optimistic)
 *   4. WS event 'settings.changed': refreshFromServer (stabilny useCallback)
 *
 * Timer debounce jest czyszczony przy odmontowaniu providera (logout),
 * zeby opozniony zapis nie polecial juz po sesji.
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

/** Prefiks klucza cache w localStorage. Pelny klucz: `rp-settings:<userId>`. */
const SETTINGS_KEY_PREFIX = 'rp-settings:'
/** Stary, globalny klucz (sprzed podzialu per-user). Czyszczony przy starcie. */
const LEGACY_SETTINGS_KEY = 'rp-settings'

function settingsKeyFor(userId: string): string {
  return `${SETTINGS_KEY_PREFIX}${userId}`
}

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
 * Wczytuje cache z localStorage dla danego usera.
 * Stary globalny klucz jest usuwany (bez migracji — bezpieczniej dla izolacji kont).
 */
function loadFromLocalStorage(userId: string): AppSettings | null {
  if (!userId) return null

  // Jednorazowo usun stary globalny klucz, zeby nie wrocil przez inna sciezke.
  try {
    if (localStorage.getItem(LEGACY_SETTINGS_KEY) !== null) {
      localStorage.removeItem(LEGACY_SETTINGS_KEY)
    }
  } catch {
    // localStorage moze byc niedostepny — ignorujemy.
  }

  const raw = localStorage.getItem(settingsKeyFor(userId))
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
    try {
      localStorage.removeItem(settingsKeyFor(userId))
    } catch {
      /* ignore */
    }
    return null
  }
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const userId = user?.id ?? ''

  const [settings, setSettings] = useState<AppSettings>(
    () => loadFromLocalStorage(userId) ?? defaultSettings(),
  )
  const [loading, setLoading] = useState(true)

  // Ref na najswiezsze settings - do unikania stale closure w debounced save.
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  // Debounce timera PUT (zmiany szybkie - np. suwak - nie zapisujemy kazdej).
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** Zapis do localStorage pod kluczem tego usera. */
  const persistLocal = useCallback((next: AppSettings): AppSettings => {
    if (!userId) return next
    try {
      localStorage.setItem(settingsKeyFor(userId), JSON.stringify(next))
    } catch {
      // Quota / tryb prywatny — ignorujemy, settings i tak pojda na serwer.
    }
    return next
  }, [userId])

  /** Zapisz na serwer z debounce 500ms (chroni przed spamem przy suwakach). */
  const scheduleSave = (): void => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void settingsApi.save(settingsRef.current).catch((err) => {
        console.warn('Zapis ustawien na serwer nie powiodl sie:', err)
      })
    }, 500)
  }

  // Cleanup: przy odmontowaniu (logout) anuluj zalegly zapis.
  // Bez tego debounce mogl wystrzelic po sesji i wyslac PUT bez tokenu.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [])

  // Przy mount: fetch z serwera. Provider jest montowany tylko gdy user istnieje
  // (patrz main.tsx → Root), wiec mount == swiezy login.
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
          // Serwer nie ma - wgrywamy to co mamy lokalnie.
          // Uwaga: to sa WYLACZNIE ustawienia tego usera (cache per-user lub
          // defaults), wiec nie ma ryzyka przecieku miedzy kontami.
          await settingsApi.save(settingsRef.current)
        }
      } catch (err) {
        // Blad sieci - zostajemy z cache, sprobujemy pozniej.
        console.warn('Nie udalo sie pobrac ustawien z serwera:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [persistLocal])

  /**
   * Reczne dociagniecie z serwera (wywolywane przez WS listener w App).
   * useCallback z dep [persistLocal] — stabilny dopoki userId sie nie zmieni,
   * a userId zmienia sie tylko przez pelny remount providera (login/logout).
   * Dzieki temu efekt App nie re-sie reconnectuje WS przy kazdym renderze.
   */
  const refreshFromServer = useCallback(async (): Promise<void> => {
    try {
      const remote = await settingsApi.get()
      if (remote) {
        setSettings(persistLocal(remote))
      }
    } catch (err) {
      console.warn('Refresh ustawien z serwera nie powiodl sie:', err)
    }
  }, [persistLocal])

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

