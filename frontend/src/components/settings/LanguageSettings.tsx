import { useI18n } from '../../i18n'

/** Ustawienia języka interfejsu. */
export default function LanguageSettings() {
  const { locale, setLocale, t } = useI18n()

  return (
    <div className="p-6">
      <h1 className="text-[17px] font-semibold text-[#f2f2f4]">{t('settingsLanguageTitle')}</h1>
      <p className="mt-1 text-[12px] text-[#75757f]">{t('settingsLanguageHint')}</p>

      <div className="mt-5 flex gap-2">
        <button
          onClick={() => setLocale('pl')}
          className={`rounded-lg px-4 py-2 text-[12.5px] font-medium transition-colors ${
            locale === 'pl'
              ? 'bg-accent text-white'
              : 'border border-edge text-[#8a8a94] hover:bg-surface-light'
          }`}
        >
          Polski
        </button>
        <button
          onClick={() => setLocale('en')}
          className={`rounded-lg px-4 py-2 text-[12.5px] font-medium transition-colors ${
            locale === 'en'
              ? 'bg-accent text-white'
              : 'border border-edge text-[#8a8a94] hover:bg-surface-light'
          }`}
        >
          English
        </button>
        <div className="ml-4 flex items-center text-[11.5px] text-[#6a6a72]">
          <span>➕ Dodaj nowy język → plik w <code className="rounded bg-surface px-1.5 py-0.5 text-[10.5px]">src/locales/</code></span>
        </div>
      </div>
    </div>
  )
}
