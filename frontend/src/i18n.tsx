import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

type Locale = 'pl' | 'en'
type TranslationKey = string

interface I18nContextType {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: TranslationKey) => string
}

const I18nContext = createContext<I18nContextType | null>(null)

// Dynamiczne ładowanie tłumaczeń
const locales: Record<Locale, Record<string, string>> = {
  pl: {},
  en: {},
}

async function loadLocale(locale: Locale): Promise<void> {
  if (locales[locale] && Object.keys(locales[locale]).length > 0) return
  try {
    const module = await import(`./locales/${locale}.json`)
    locales[locale] = module.default
  } catch (error) {
    console.error(`Nie udało się załadować tłumaczeń dla języka "${locale}":`, error)
    // Fallback: puste obiekty, klucze będą wyświetlane jako same klucze
    if (!locales[locale]) locales[locale] = {}
  }
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('pl')
  const [ready, setReady] = useState(false)

  const setLocale = async (newLocale: Locale) => {
    setLocaleState(newLocale)
    await loadLocale(newLocale)
    localStorage.setItem('rp-locale', newLocale)
  }

  useEffect(() => {
    const saved = localStorage.getItem('rp-locale') as Locale | null
    const initial = saved === 'pl' || saved === 'en' ? saved : 'pl'
    setLocaleState(initial)
    loadLocale(initial).then(() => setReady(true))
  }, [])

  const t = (key: TranslationKey): string => {
    const translation = locales[locale]?.[key]
    if (translation) return translation
    // Fallback – spróbuj w języku angielskim
    const fallback = locales.en?.[key]
    if (fallback) return fallback
    // Jeśli nie ma – zwróć sam klucz
    return key
  }

  if (!ready) {
    return <div className="flex h-screen items-center justify-center bg-surface-dark text-[13px] text-[#75757f]">Ładowanie języka…</div>
  }

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextType {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider')
  }
  return ctx
}

export type { Locale }
