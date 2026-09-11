import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useSettings } from '../../context/SettingsContext'

/**
 * Zwijalna sekcja ustawień.
 * Zwijanie/rozwijanie (chevron) jest NIEZALEŻNE od włącznika (toggle) —
 * stan zwinięcia nie wpływa na enabled/disabled funkcji.
 */
function CollapsibleSection({
  title,
  description,
  toggle,
  checked,
  onToggle,
  children,
}: {
  title: string
  description: string
  toggle?: boolean
  checked?: boolean
  onToggle?: (checked: boolean) => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(true)

  return (
    <div className="rounded-xl border border-edge bg-surface">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3.5 text-left"
      >
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[#f2f2f4]">{title}</div>
          <div className="text-[11.5px] text-[#75757f]">{description}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {toggle !== undefined && (
            <label
              className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onToggle?.(e.target.checked)}
                className="peer sr-only"
              />
              <div className={`relative h-6 w-11 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-[#2a2a31]'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
              </div>
            </label>
          )}
          <ChevronDown size={16} className={`shrink-0 text-[#8a8a94] transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && <div className="border-t border-edge px-4 py-4">{children}</div>}
    </div>
  )
}

/** Ustawienia narzędzi (web search, image generation). */
export default function ToolsSettings() {
  const { t } = useI18n()
  const { settings, updateSettings } = useSettings()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-6 pb-4 pt-6">
        <h1 className="text-[17px] font-semibold text-[#f2f2f4]">Narzędzia</h1>
        <p className="mt-1 text-[12px] text-[#75757f]">Konfiguracja narzędzi takich jak wyszukiwanie web i generowanie obrazów.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
        <div className="max-w-xl space-y-4">
          {/* Web Search */}
          <CollapsibleSection
            title={t('toolsWebSearch')}
            description={t('toolsWebSearchDesc')}
            toggle
            checked={settings.webSearchEnabled}
            onToggle={(v) => updateSettings({ webSearchEnabled: v })}
          >
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('toolsWebSearchEngine')}</label>
                <select
                  value={settings.webSearchEngine}
                  onChange={(e) => updateSettings({ webSearchEngine: e.target.value })}
                  className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                >
                  <option value="searxng">SearXNG</option>
                  <option value="google">Google (wymaga API key)</option>
                  <option value="bing">Bing (wymaga API key)</option>
                  <option value="custom">Własny endpoint</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('toolsWebSearchUrl')}</label>
                <input
                  value={settings.webSearchUrl}
                  onChange={(e) => updateSettings({ webSearchUrl: e.target.value })}
                  placeholder="http://192.168.100.80:8080"
                  className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('toolsWebSearchApiKey')}</label>
                <input
                  value={settings.webSearchApiKey ?? ''}
                  onChange={(e) => updateSettings({ webSearchApiKey: e.target.value })}
                  placeholder={t('toolsWebSearchApiKeyPlaceholder')}
                  className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('toolsWebSearchMaxResults')}</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.webSearchMaxResults}
                  onChange={(e) => updateSettings({ webSearchMaxResults: parseInt(e.target.value) || 5 })}
                  className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                />
              </div>

              <div className="border-t border-edge pt-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[12.5px] text-[#b8bdd0]">{t('toolsWebSearchShowResults')}</div>
                    <div className="text-[11px] text-[#6a6a72]">{t('toolsWebSearchShowResultsDesc')}</div>
                  </div>
                  <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full">
                    <input
                      type="checkbox"
                      checked={settings.webSearchShowResults}
                      onChange={(e) => updateSettings({ webSearchShowResults: e.target.checked })}
                      className="peer sr-only"
                    />
                    <div className={`relative h-6 w-11 rounded-full transition-colors ${settings.webSearchShowResults ? 'bg-accent' : 'bg-[#2a2a31]'}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${settings.webSearchShowResults ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                    </div>
                  </label>
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('toolsWebSearchCooldown')}</label>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    step={0.5}
                    value={settings.webSearchCooldown}
                    onChange={(e) => updateSettings({ webSearchCooldown: parseFloat(e.target.value) || 2 })}
                    className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                  />
                  <p className="mt-1 text-[11px] text-[#6a6a72]">{t('toolsWebSearchCooldownDesc')}</p>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          {/* Image Generation */}
          <CollapsibleSection
            title={t('toolsImageGen')}
            description={t('toolsImageGenDesc')}
            toggle
            checked={settings.imageGenEnabled}
            onToggle={(v) => updateSettings({ imageGenEnabled: v })}
          >
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('imageGenBaseUrl')}</label>
                <input
                  value={settings.imageGenBaseUrl}
                  onChange={(e) => updateSettings({ imageGenBaseUrl: e.target.value })}
                  placeholder="http://192.168.100.80:8080"
                  className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                />
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('imageGenResponseFormat')}</label>
                <select
                  value={settings.imageGenResponseFormat}
                  onChange={(e) => updateSettings({ imageGenResponseFormat: e.target.value as 'url' | 'b64_json' })}
                  className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                >
                  <option value="url">URL</option>
                  <option value="b64_json">Base64 (b64_json)</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('imageGenContextMessages')}</label>
                <input
                  type="number"
                  min={1}
                  max={40}
                  value={settings.imageGenContextMessages}
                  onChange={(e) => updateSettings({ imageGenContextMessages: parseInt(e.target.value) || 6 })}
                  className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                />
                <p className="mt-1 text-[11px] text-[#6a6a72]">{t('imageGenContextMessagesDesc')}</p>
              </div>

              <div className="border-t border-edge pt-3">
                <div className="text-[12.5px] text-[#b8bdd0]">{t('imageGenRefinerTitle')}</div>
                <p className="mt-0.5 text-[11px] text-[#6a6a72]">{t('imageGenRefinerDesc')}</p>

                <div className="mt-3">
                  <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('imageGenRefinerModel')}</label>
                  <select
                    value={settings.imageGenRefinerProfileId}
                    onChange={(e) => updateSettings({ imageGenRefinerProfileId: e.target.value })}
                    className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                  >
                    <option value="">{t('imageGenRefinerUseChat')}</option>
                    {settings.aiProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('imageGenRefinerPrompt')}</label>
                  <textarea
                    value={settings.imageGenRefinerPrompt}
                    onChange={(e) => updateSettings({ imageGenRefinerPrompt: e.target.value })}
                    rows={6}
                    className="w-full resize-y rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] leading-relaxed text-[#e8e8eb] outline-none focus:border-accent"
                  />
                </div>
              </div>
            </div>
          </CollapsibleSection>
        </div>
      </div>
    </div>
  )
}