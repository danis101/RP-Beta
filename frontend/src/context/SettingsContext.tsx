import { createContext, useContext, useState, type ReactNode } from 'react'
import type { FormattingPatterns, FormattingColors } from '../lib/formatting'
import { defaultPatterns, defaultColors } from '../lib/formatting'
import type { ApiProfile } from '../types'

/**
 * Ustawienia aplikacji (poza encjami).
 *
 * Uwaga: stylePresets i lorebooks WYPROWADZONE z tego kontekstu w Etapie 2 —
 * te są teraz encjami na serwerze (przez stylesApi/lorebooksApi w App.tsx).
 *
 * Po Etapie 2 (Settings przez API) ten plik zostanie przepisany.
 * Teraz: dane device-specific (AI profile, formatting, prompty) zostają
 * w localStorage, bo są specyficzne dla urządzenia / nie zsynchronizowane.
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
  updateSettings: (partial: Partial<AppSettings>) => void
  updateAiProfile: (profile: ApiProfile) => void
  addAiProfile: (profile: ApiProfile) => void
  deleteAiProfile: (id: string) => void
  setActiveAiProfile: (id: string) => void
  setDefaultStyle: (id: string) => void
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
  return `Jesteś asystentem podsumowującym historię rozmowy. Otrzymujesz dotychczasowe podsumowanie oraz nowe wiadomości. Twoim zadaniem jest zaktualizować podsumowanie, dodając najważniejsze wydarzenia, decyzje, fakty i zmiany w relacjach między postaciami. Zachowaj zwięzłość (max 200 słów) i trzymaj się faktów. Nie dodawaj własnych komentarzy ani ocen.`
}

function defaultImageGenRefinerPrompt(): string {
  return `Jesteś ekspertem od promptów do generowania obrazów. Otrzymujesz kartę postaci (JSON) oraz fragment rozmowy. Twoim zadaniem jest napisać JEDEN spójny, szczegółowy pozytywny prompt do modelu tekst-do-obrazu, opisujący postać dokładnie tak, jak wygląda w karcie (twarz, sylwetka, włosy, oczy, strój, cechy charakterystyczne) oraz bieżącą scenę z rozmowy.

Zwróć WYŁĄCZNIE sam prompt, bez komentarzy. Rozpocznij go od tagu stylu, np.:
[STYLE: Photorealistic] ...opis...

Jeśli potrzebujesz, możesz dodać [FORMAT: portrait|landscape|square]. Nie dodawaj nic poza promptem.`
}

function loadSettings(): AppSettings {
  const raw = localStorage.getItem(SETTINGS_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<AppSettings> & {
        baseUrl?: string
        apiKey?: string
        model?: string
        temperature?: number
      }

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
        formatting: parsed.formatting ?? defaultPatterns,
        formattingColors: parsed.formattingColors ?? defaultColors,
        defaultPersonaId: parsed.defaultPersonaId ?? '',
        aiProfiles,
        activeAiProfileId: parsed.activeAiProfileId ?? aiProfiles[0]?.id ?? '',
        hideThinking: parsed.hideThinking ?? false,
        defaultStyleId: parsed.defaultStyleId ?? '',
        summarizerEnabled: parsed.summarizerEnabled ?? false,
        summarizerModel: parsed.summarizerModel ?? '',
        summarizerPrompt: parsed.summarizerPrompt ?? defaultSummarizerPrompt(),
        summarizerMessageCount: parsed.summarizerMessageCount ?? 30,
        summarizerThreshold: parsed.summarizerThreshold ?? 10,
        webSearchEnabled: parsed.webSearchEnabled ?? false,
        webSearchEngine: parsed.webSearchEngine ?? 'searxng',
        webSearchUrl: parsed.webSearchUrl ?? 'http://192.168.100.80:8080',
        webSearchApiKey: parsed.webSearchApiKey ?? '',
        webSearchMaxResults: parsed.webSearchMaxResults ?? 5,
        webSearchShowResults: parsed.webSearchShowResults ?? true,
        webSearchCooldown: parsed.webSearchCooldown ?? 2,
        imageGenEnabled: parsed.imageGenEnabled ?? false,
        imageGenBaseUrl: parsed.imageGenBaseUrl ?? '',
        imageGenResponseFormat: parsed.imageGenResponseFormat ?? 'url',
        imageGenRefinerProfileId: parsed.imageGenRefinerProfileId ?? '',
        imageGenRefinerPrompt: parsed.imageGenRefinerPrompt ?? defaultImageGenRefinerPrompt(),
        imageGenContextMessages: parsed.imageGenContextMessages ?? 6,
      }
    } catch (e) {
      console.warn('Błąd parsowania ustawień, używam domyślnych:', e)
      localStorage.removeItem(SETTINGS_KEY)
    }
  }

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

const SettingsContext = createContext<SettingsContextType | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(loadSettings)

  const persist = (next: AppSettings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
    return next
  }

  const updateSettings = (partial: Partial<AppSettings>) => {
    setSettings((prev) => persist({ ...prev, ...partial }))
  }

  const updateAiProfile = (profile: ApiProfile) => {
    setSettings((prev) => persist({ ...prev, aiProfiles: prev.aiProfiles.map((p) => (p.id === profile.id ? profile : p)) }))
  }

  const addAiProfile = (profile: ApiProfile) => {
    setSettings((prev) => persist({ ...prev, aiProfiles: [...prev.aiProfiles, profile] }))
  }

  const deleteAiProfile = (id: string) => {
    setSettings((prev) => {
      const profiles = prev.aiProfiles.filter((p) => p.id !== id)
      const activeId = prev.activeAiProfileId === id ? profiles[0]?.id ?? '' : prev.activeAiProfileId
      return persist({ ...prev, aiProfiles: profiles, activeAiProfileId: activeId })
    })
  }

  const setActiveAiProfile = (id: string) => {
    setSettings((prev) => persist({ ...prev, activeAiProfileId: id }))
  }

  const setDefaultStyle = (id: string) => {
    setSettings((prev) => persist({ ...prev, defaultStyleId: id }))
  }

  return (
    <SettingsContext.Provider
      value={{
        settings,
        updateSettings,
        updateAiProfile,
        addAiProfile,
        deleteAiProfile,
        setActiveAiProfile,
        setDefaultStyle,
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
