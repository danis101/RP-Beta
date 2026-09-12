import { useState } from 'react'
import { Eye, EyeOff, Link2, Loader2, Circle, Info, CheckCircle2, Plus, Trash2, ChevronDown } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useSettings, defaultAiProfile } from '../../context/SettingsContext'
import type { ModelInfo } from '../../services/api'
import { OpenAIAdapter } from '../../services/api'
import type { ApiProfile } from '../../types'

const statusColor: Record<ModelInfo['status'], string> = {
  loaded: 'text-[#34c759]',
  available: 'text-[#ffcc00]',
  unavailable: 'text-[#4a4a52]',
}

/** Widok Modele AI: profile API, connect, lista modeli, sampler, vision. */
export default function AIModelsView() {
  const { t } = useI18n()
  const { settings, updateSettings, updateAiProfile, addAiProfile, deleteAiProfile, setActiveAiProfile } = useSettings()
  const [showKey, setShowKey] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [samplerOpen, setSamplerOpen] = useState(false)
  const [visionOpen, setVisionOpen] = useState(false)

  const activeProfile = settings.aiProfiles.find((p) => p.id === settings.activeAiProfileId) ?? settings.aiProfiles[0]

  if (!activeProfile) return null

  const updateActive = (partial: Partial<ApiProfile>) => {
    updateAiProfile({ ...activeProfile, ...partial })
  }

  const updateSampler = (partial: Partial<ApiProfile['sampler']>) => {
    updateActive({ sampler: { ...activeProfile.sampler, ...partial } })
  }

  const handleConnect = async () => {
    setLoading(true)
    setError(null)
    setConnected(false)

    try {
      const adapter = new OpenAIAdapter({
        baseUrl: activeProfile.baseUrl,
        apiKey: activeProfile.apiKey,
        model: activeProfile.model,
      })
      const result = await adapter.listModels()
      setModels(result.models)
      setConnected(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setModels([])
    } finally {
      setLoading(false)
    }
  }

  const handleAddProfile = () => {
    addAiProfile(defaultAiProfile())
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-dark">
      {/* Nagłówek — zawsze widoczny */}
      <div className="flex shrink-0 items-center gap-3 border-b border-edge bg-surface px-6 py-4">
        <div className="flex-1">
          <h1 className="text-[17px] font-semibold text-[#f2f2f4]">{t('settingsAITitle')}</h1>
          <p className="mt-0.5 text-[12px] text-[#75757f]">{t('settingsAISubtitle')}</p>
        </div>
        <button
          onClick={handleAddProfile}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light"
        >
          <Plus size={14} /> {t('aiNewProfile')}
        </button>
      </div>

      {/* Treść z możliwością przewijania */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="max-w-3xl space-y-5 p-6">
          {/* Wybór profilu */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('aiProfile')}</label>
            <div className="flex items-center gap-2">
              <select
                value={activeProfile.id}
                onChange={(e) => setActiveAiProfile(e.target.value)}
                className="flex-1 rounded-lg border border-[#2a2a31] bg-surface px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
              >
                {settings.aiProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name || 'Bez nazwy'} {p.model ? `(${p.model})` : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const name = window.prompt(t('aiProfileNamePrompt'), activeProfile.name)
                  if (name !== null) updateActive({ name })
                }}
                className="rounded-lg border border-edge px-3 py-2 text-[12.5px] text-[#8a8a94] hover:bg-surface-light"
              >
                {t('aiRename')}
              </button>
              {settings.aiProfiles.length > 1 && (
                <button
                  onClick={() => deleteAiProfile(activeProfile.id)}
                  className="rounded-lg border border-edge p-2 text-[#8a8a94] hover:bg-[#2a1a1a] hover:text-[#e05b5b]"
                  title={t('aiDeleteProfile')}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Base URL + API key */}
          <div className="space-y-2">
            <SettingsField
              label={t('settingsBaseUrl')}
              value={activeProfile.baseUrl}
              onChange={(v) => updateActive({ baseUrl: v })}
              placeholder="http://192.168.1.100:1234"
            />
            <p className="flex items-start gap-1.5 text-[11.5px] text-[#6a6a72]">
              <Info size={13} className="mt-0.5 shrink-0" />
              {t('settingsBaseUrlHint')}
            </p>

            <SettingsField
              label={t('settingsApiKey')}
              value={activeProfile.apiKey}
              onChange={(v) => updateActive({ apiKey: v })}
              placeholder="sk-..."
              type={showKey ? 'text' : 'password'}
              right={
                <button
                  onClick={() => setShowKey((prev) => !prev)}
                  className="rounded p-1 text-[#8a8a94] hover:text-white"
                  title={showKey ? 'Ukryj klucz' : 'Pokaż klucz'}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              }
            />
          </div>

          {/* Connect + lista modeli */}
          <div className="space-y-2">
            <button
              onClick={handleConnect}
              disabled={loading || !activeProfile.baseUrl.trim()}
              className="flex items-center gap-2 rounded-lg border border-edge px-3.5 py-2.5 text-[12.5px] font-medium text-[#b8bdd0] transition-colors hover:bg-surface-light disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
              {t('settingsConnect')}
            </button>

            {connected && (
              <div className="flex items-center gap-2 rounded-lg border border-[#1f3a2a] bg-[#16241b] px-3 py-2 text-[12px] text-[#7ee2a0]">
                <CheckCircle2 size={14} />
                {t('settingsConnected')}
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-[#2a1a1a] px-3 py-2 text-[12px] text-[#e05b5b]">{error}</p>
            )}

            {models.length > 0 && (
              <div className="mt-3 space-y-1 rounded-xl border border-edge bg-surface p-2">
                <p className="px-2 pb-2 pt-1 text-[11px] font-medium text-[#8a8a94]">
                  {t('settingsAvailableModels')}
                </p>
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => updateActive({ model: m.id })}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] transition-colors ${
                      activeProfile.model === m.id ? 'bg-[#1e2436] text-white' : 'text-[#b8bdd0] hover:bg-surface-light'
                    }`}
                  >
                    <Circle size={10} className={`shrink-0 fill-current ${statusColor[m.status]}`} />
                    <span className="min-w-0 flex-1 truncate">{m.id}</span>
                    {activeProfile.model === m.id && <span className="text-[10.5px] font-semibold text-accent">✓</span>}
                  </button>
                ))}
              </div>
            )}

            {activeProfile.model && (
              <p className="pt-1 text-[11.5px] text-[#8a8a94]">
                {t('settingsActiveModel')}: <span className="font-medium text-[#b8bdd0]">{activeProfile.model}</span>
              </p>
            )}
          </div>

          {/* Sampler */}
          <div className="overflow-hidden rounded-xl border border-edge bg-surface">
            <button
              onClick={() => setSamplerOpen((prev) => !prev)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-[13px] font-medium text-[#f2f2f4] hover:bg-surface-light"
            >
              {t('aiSampler')}
              <ChevronDown size={15} className={`text-[#8a8a94] transition-transform ${samplerOpen ? 'rotate-180' : ''}`} />
            </button>

            {samplerOpen && (
              <div className="space-y-3 border-t border-edge p-4">
                <NumberField
                  label="Temperature"
                  value={activeProfile.sampler.temperature}
                  onChange={(v) => updateSampler({ temperature: v })}
                  min={0}
                  max={2}
                  step={0.1}
                />
                <NumberField
                  label="Top P"
                  value={activeProfile.sampler.topP}
                  onChange={(v) => updateSampler({ topP: v })}
                  min={0}
                  max={1}
                  step={0.05}
                />
                <NumberField
                  label="Top K"
                  value={activeProfile.sampler.topK}
                  onChange={(v) => updateSampler({ topK: v })}
                  min={0}
                  max={200}
                  step={1}
                />
                <NumberField
                  label="Frequency penalty"
                  value={activeProfile.sampler.frequencyPenalty}
                  onChange={(v) => updateSampler({ frequencyPenalty: v })}
                  min={-2}
                  max={2}
                  step={0.1}
                />
                <NumberField
                  label="Presence penalty"
                  value={activeProfile.sampler.presencePenalty}
                  onChange={(v) => updateSampler({ presencePenalty: v })}
                  min={-2}
                  max={2}
                  step={0.1}
                />
              </div>
            )}
          </div>

          {/* Vision */}
          <div className="overflow-hidden rounded-xl border border-edge bg-surface">
            <button
              onClick={() => setVisionOpen((prev) => !prev)}
              className="flex w-full items-center justify-between px-4 py-3 text-left text-[13px] font-medium text-[#f2f2f4] hover:bg-surface-light"
            >
              Vision (obrazy)
              <ChevronDown size={15} className={`text-[#8a8a94] transition-transform ${visionOpen ? 'rotate-180' : ''}`} />
            </button>

            {visionOpen && (
              <div className="space-y-4 border-t border-edge p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <div className="text-[12.5px] text-[#b8bdd0]">Włącz obsługę vision</div>
                    <div className="text-[11px] text-[#6a6a72]">Wysyłanie obrazów w wiadomościach.</div>
                  </div>
                  <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full">
                    <input
                      type="checkbox"
                      checked={activeProfile.visionEnabled}
                      onChange={(e) => updateActive({ visionEnabled: e.target.checked })}
                      className="peer sr-only"
                    />
                    <div
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        activeProfile.visionEnabled ? 'bg-accent' : 'bg-[#2a2a31]'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                          activeProfile.visionEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                        }`}
                      />
                    </div>
                  </label>
                </div>

                {activeProfile.visionEnabled && (
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
                      Model vision
                      {loading && <span className="ml-2 text-[10px] text-[#6a6a72]">(ładowanie...)</span>}
                    </label>
                    {models.length > 0 ? (
                      <select
                        value={activeProfile.visionModel ?? ''}
                        onChange={(e) => updateActive({ visionModel: e.target.value || undefined })}
                        className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                      >
                        <option value="">Użyj głównego modelu ({activeProfile.model})</option>
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.id} {m.status === 'loaded' ? '✅' : m.status === 'available' ? '○' : '⚠️'}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex items-center gap-2">
                        <p className="text-[12px] text-[#75757f]">
                          {connected ? 'Brak modeli – połącz się z API.' : 'Połącz się z API, aby pobrać listę modeli.'}
                        </p>
                        {!connected && (
                          <button
                            onClick={handleConnect}
                            disabled={loading || !activeProfile.baseUrl.trim()}
                            className="rounded-lg border border-edge px-3 py-1.5 text-[11px] text-[#8a8a94] hover:bg-surface-light disabled:opacity-50"
                          >
                            {loading ? '...' : 'Pobierz listę'}
                          </button>
                        )}
                      </div>
                    )}
                    <p className="mt-1 text-[11px] text-[#6a6a72]">
                      {models.length > 0
                        ? `Wybierz model vision lub zostaw puste, aby użyć głównego.`
                        : 'Połącz się z API, aby wybrać model vision z listy.'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Zaawansowane */}
          <div className="space-y-3 rounded-xl border border-edge bg-surface p-4">
            <h3 className="text-[13px] font-medium text-[#f2f2f4]">{t('aiAdvanced')}</h3>

            <NumberField
              label={t('aiMaxTokens')}
              value={activeProfile.maxTokens}
              onChange={(v) => updateActive({ maxTokens: v })}
              min={1}
              max={8192}
              step={1}
            />
            <NumberField
              label={t('aiContextLength')}
              value={activeProfile.contextLength}
              onChange={(v) => updateActive({ contextLength: v })}
              min={512}
              max={131072}
              step={512}
            />
            <NumberField
              label={t('aiMemoryMessages')}
              value={activeProfile.memoryMessages}
              onChange={(v) => updateActive({ memoryMessages: v })}
              min={0}
              max={200}
              step={1}
            />

            <div className="flex items-center justify-between gap-2">
              <div className="flex-1">
                <div className="text-[12.5px] text-[#b8bdd0]">{t('aiStreaming')}</div>
                <div className="text-[11px] text-[#6a6a72]">{t('aiStreamingHint')}</div>
              </div>
              <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full">
                <input
                  type="checkbox"
                  checked={activeProfile.streamingEnabled}
                  onChange={(e) => updateActive({ streamingEnabled: e.target.checked })}
                  className="peer sr-only"
                />
                <div
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    activeProfile.streamingEnabled ? 'bg-accent' : 'bg-[#2a2a31]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      activeProfile.streamingEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                    }`}
                  />
                </div>
              </label>
            </div>

            <label className="flex cursor-pointer items-center justify-between gap-3 border-t border-edge py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-[#b8bdd0]">{t('aiInitialUserMessage')}</div>
                <div className="text-[11px] text-[#6a6a72]">{t('aiInitialUserMessageHint')}</div>
              </div>
              <input
                type="checkbox"
                aria-label={t('aiInitialUserMessage')}
                checked={activeProfile.initialUserMessageEnabled ?? false}
                onChange={(event) => updateActive({ initialUserMessageEnabled: event.target.checked })}
                className="h-5 w-5 shrink-0 accent-accent"
              />
            </label>

            <div className="flex items-center justify-between gap-2 border-t border-edge pt-3">
              <div className="flex-1">
                <div className="text-[12.5px] text-[#b8bdd0]">{t('aiHideThinking')}</div>
                <div className="text-[11px] text-[#6a6a72]">{t('aiHideThinkingHint')}</div>
              </div>
              <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full">
                <input
                  type="checkbox"
                  checked={settings.hideThinking}
                  onChange={(e) => updateSettings({ hideThinking: e.target.checked })}
                  className="peer sr-only"
                />
                <div
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    settings.hideThinking ? 'bg-accent' : 'bg-[#2a2a31]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      settings.hideThinking ? 'translate-x-[22px]' : 'translate-x-0.5'
                    }`}
                  />
                </div>
              </label>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

function SettingsField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  right,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  right?: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{label}</span>
      <div className="relative">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={type}
          className="w-full rounded-lg border border-[#2a2a31] bg-surface px-3 py-2 pr-10 text-[13px] text-[#e8e8eb] outline-none transition-colors placeholder:text-[#6a6a72] focus:border-accent"
        />
        {right && <div className="absolute right-2 top-1/2 -translate-y-1/2">{right}</div>}
      </div>
    </label>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  value?: number
  onChange: (v: number) => void
  min: number
  max: number
  step: number
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{label}</span>
      <input
        type="number"
        value={value ?? ''}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value)
          if (!Number.isNaN(parsed)) onChange(parsed)
        }}
        min={min}
        max={max}
        step={step}
        className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
      />
    </label>
  )
}
