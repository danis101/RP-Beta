import { useEffect, useState } from 'react'
import { useI18n } from '../../i18n'
import { useSettings } from '../../context/SettingsContext'
import { OpenAIAdapter } from '../../services/api'
import type { ModelInfo } from '../../services/api'

/** Ustawienia pamięci długotrwałej (summarizer). */
export default function MemorySettings() {
  const { t } = useI18n()
  const { settings, updateSettings } = useSettings()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeProfile = settings.aiProfiles.find((p) => p.id === settings.activeAiProfileId) ?? settings.aiProfiles[0]

  const fetchModels = async () => {
    if (!activeProfile?.baseUrl.trim()) {
      setError('Brak połączenia z API – skonfiguruj profil w zakładce Modele AI.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const adapter = new OpenAIAdapter({
        baseUrl: activeProfile.baseUrl,
        apiKey: activeProfile.apiKey,
        model: activeProfile.model,
      })
      const result = await adapter.listModels()
      setModels(result.models)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się pobrać listy modeli.')
      setModels([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeProfile?.baseUrl.trim()) {
      fetchModels()
    }
  }, [activeProfile?.baseUrl, activeProfile?.apiKey])

  const currentModel = settings.summarizerModel || ''

  return (
    <div className="p-6">
      <h1 className="text-[17px] font-semibold text-[#f2f2f4]">{t('memoryTitle')}</h1>
      <p className="mt-1 text-[12px] text-[#75757f]">{t('memoryDescription')}</p>

      <div className="mt-5 max-w-xl space-y-4">
        <div className="flex items-center justify-between gap-2 rounded-xl border border-edge bg-surface p-4">
          <div>
            <div className="text-[13px] font-medium text-[#f2f2f4]">{t('memoryEnabled')}</div>
            <div className="text-[11.5px] text-[#75757f]">{t('memoryEnabledDesc')}</div>
          </div>
          <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full">
            <input
              type="checkbox"
              checked={settings.summarizerEnabled}
              onChange={(e) => updateSettings({ summarizerEnabled: e.target.checked })}
              className="peer sr-only"
            />
            <div className={`relative h-6 w-11 rounded-full transition-colors ${settings.summarizerEnabled ? 'bg-accent' : 'bg-[#2a2a31]'}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${settings.summarizerEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
            </div>
          </label>
        </div>

        <div className="space-y-3 rounded-xl border border-edge bg-surface p-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
              {t('memoryModel')}
              {loading && <span className="ml-2 text-[10px] text-[#6a6a72]">(ładowanie...)</span>}
            </label>
            {error ? (
              <div className="flex items-center gap-2">
                <p className="text-[12px] text-[#e05b5b]">{error}</p>
                <button
                  onClick={fetchModels}
                  className="rounded-lg border border-edge px-2 py-1 text-[11px] text-[#8a8a94] hover:bg-surface-light"
                >
                  Spróbuj ponownie
                </button>
              </div>
            ) : models.length > 0 ? (
              <select
                value={currentModel}
                onChange={(e) => updateSettings({ summarizerModel: e.target.value })}
                className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
              >
                <option value="">Użyj domyślnego modelu ({activeProfile?.model || 'brak'})</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id} {m.status === 'loaded' ? '✅' : m.status === 'available' ? '○' : '⚠️'}
                  </option>
                ))}
              </select>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={currentModel}
                  onChange={(e) => updateSettings({ summarizerModel: e.target.value })}
                  placeholder={t('memoryModelPlaceholder')}
                  className="flex-1 rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                />
                <button
                  onClick={fetchModels}
                  disabled={loading}
                  className="rounded-lg border border-edge px-3 py-2 text-[12px] text-[#8a8a94] hover:bg-surface-light disabled:opacity-50"
                >
                  {loading ? '...' : 'Pobierz listę'}
                </button>
              </div>
            )}
            <p className="mt-1 text-[11px] text-[#6a6a72]">
              {models.length > 0
                ? `Znaleziono ${models.length} modeli. Wybierz lub wpisz własny.`
                : 'Zostaw puste, aby użyć modelu z aktywnego profilu API.'}
            </p>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('memoryPrompt')}</span>
            <textarea
              value={settings.summarizerPrompt}
              onChange={(e) => updateSettings({ summarizerPrompt: e.target.value })}
              rows={6}
              className="w-full resize-y rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 font-mono text-[12.5px] leading-relaxed text-[#e8e8eb] outline-none focus:border-accent"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 rounded-xl border border-edge bg-surface p-4">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('memoryMessageCount')}</span>
            <input
              type="number"
              min={1}
              max={200}
              value={settings.summarizerMessageCount}
              onChange={(e) => updateSettings({ summarizerMessageCount: parseInt(e.target.value) || 30 })}
              className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('memoryThreshold')}</span>
            <input
              type="number"
              min={1}
              max={100}
              value={settings.summarizerThreshold}
              onChange={(e) => updateSettings({ summarizerThreshold: parseInt(e.target.value) || 10 })}
              className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
            />
          </label>
        </div>
      </div>
    </div>
  )
}
