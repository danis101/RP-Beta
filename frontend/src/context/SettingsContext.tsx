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
 * per-user (klucz `rp-settings:<userId>`).
 *
 * Cykl zycia: patrz komentarz w poprzedniej wersji pliku.
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
  /**
   * Lista styli obrazu zdefiniowana przez usera. Pokazywana w dropdownie
   * "Styl obrazu" w menu konwersacji (⋮). Wartosci sa przekazywane
   * bez zmian do refinera jako `[STYLE: <wartość>]`.
   *
   * Pusta lista = dropdown nieaktywny, user nie moze wybrac stylu
   * per-rozmowa (refiner sam decyduje).
   */
  imageGenCustomStyles: string[]
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

/**
 * Default prompt dla refinera obrazu. Wersja generyczna — bez tagow
 * specyficznych dla konkretnego backendu. Patrz `defaultSettings()` nizej
 * na wyjasnienie dlaczego.
 */
function defaultImageGenRefinerPrompt(): string {
  return `Jestes ekspertem Image Prompt Engineer. Otrzymujesz karte postaci, personę uzytkownika oraz fragment rozmowy. Twoim zadaniem jest napisac JEDEN spojny, szczegolowy prompt wizualny, opisujacy postac dokladnie tak jak wyglada w karcie (twarz, sylwetka, wlosy, oczy, stroj, cechy charakterystyczne) oraz biezaca scene z rozmowy.

## JĘZYK

CALY prompt musi byc po ANGIELSKU. Nie pisz promptu po polsku.

## TAGI (opcjonalne — jesli Twoj backend ich wymaga)

Jesli Twoj mostek/model wymaga tagow wyboru stylu lub formatu na poczatku promptu (np. [STYLE: ...] [FORMAT: ...], [MODE: ...], albo podobnych), umiesc je na SAMYM POCZATKU, dokladnie w formacie wymaganym przez backend.

Jesli backend nie wymaga tagow — pomin ten krok.

## WYMAGANY STYL OD USERA

Jesli w wiadomosci od systemu dostaniesz sekcje "WYMAGANY STYL", MUSISZ umiescic jej wartosc w tagu [STYLE: ...] na samym poczatku promptu. Nie zmieniaj wartosci, nie tlumacz jej.

## HIERARCHIA SZCZEGOLOW (buduj prompt dokladnie w tej kolejnosci)

a) Podmiot i akcja: szczegolowy opis postaci, poza, wyraz twarzy, ruch.
b) Mikro-detale i faktury: tekstury (np. "coarse wool", "polished titanium", "visible skin pores"). Bielizna i warstwy spodnie w pelni zasloniete odzieza wierzchnia.
c) Pierwszy plan i bezposrednie otoczenie: obiekty wokol postaci, interakcja swiatla z powierzchniami.
d) Tlo i glebia: odlegle otoczenie, mgla atmosferyczna, perspektywa.
e) Oswietlenie i atmosfera: fizyczne opisy swiatla, czastki atmosferyczne (kurz, para, deszcz).
f) Medium i render (zaleznie od stylu):
   - Realistic / Photorealistic: podaj korpus kamery, ogniskowa, przeslona, film.
   - Anime / Fantasy / Cartoon / ilustracja: opisz medium artystyczne (np. "digital illustration, crisp vector lineart, smooth cel shading").
g) Paleta i grading: harmonia kolorow, interakcja swiatla z kolorami.

## ZASADA PRESENCE-ONLY (BEZ NEGACJI)

NIGDY nie uzywaj slow "no", "without", "except" ani zadnych negacji do wykluczania elementow. Aby czegos uniknac, opisz jego zamiennik. Dla czystego wyniku bez znakow wodnych i tekstu zakotwicz prompt w profesjonalnym medium.

## ZAKAZANE SLOWA

NIE uzywaj pustych fraz typu "masterpiece", "ultra high quality", "8k".

## SWIADOMOSC PRZESTRZENNA

Wyraznie rozgranicz pierwszy plan, srodek i tlo.

## WYJSCIE

Zwroc WYLACZNIE sam prompt, gotowy do wyslania do mostka obrazow. Bez komentarzy, bez naglowkow sekcji, bez znacznikow markdown.`
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
    imageGenCustomStyles: [],
  }
}

/**
 * Wczytuje cache z localStorage dla danego usera.
 * Stary globalny klucz jest usuwany (bez migracji — bezpieczniej dla izolacji kont).
 */
function loadFromLocalStorage(userId: string): AppSettings | null {
  if (!userId) return null

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
      imageGenCustomStyles: Array.isArray(parsed.imageGenCustomStyles) ? parsed.imageGenCustomStyles : [],
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

  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persistLocal = useCallback((next: AppSettings): AppSettings => {
    if (!userId) return next
    try {
      localStorage.setItem(settingsKeyFor(userId), JSON.stringify(next))
    } catch {
      // Quota / tryb prywatny — ignorujemy, settings i tak pojda na serwer.
    }
    return next
  }, [userId])

  const scheduleSave = (): void => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      void settingsApi.save(settingsRef.current).catch((err) => {
        console.warn('Zapis ustawien na serwer nie powiodl sie:', err)
      })
    }, 500)
  }

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const remote = await settingsApi.get()
        if (cancelled) return

        if (remote) {
          setSettings(persistLocal({
            ...defaultSettings(),
            ...remote,
            imageGenCustomStyles: Array.isArray(remote.imageGenCustomStyles)
              ? remote.imageGenCustomStyles
              : [],
          }))
        } else {
          await settingsApi.save(settingsRef.current)
        }
      } catch (err) {
        console.warn('Nie udalo sie pobrac ustawien z serwera:', err)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [persistLocal])

  const refreshFromServer = useCallback(async (): Promise<void> => {
    try {
      const remote = await settingsApi.get()
      if (remote) {
        setSettings(persistLocal({
          ...defaultSettings(),
          ...remote,
          imageGenCustomStyles: Array.isArray(remote.imageGenCustomStyles)
            ? remote.imageGenCustomStyles
            : [],
        }))
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

