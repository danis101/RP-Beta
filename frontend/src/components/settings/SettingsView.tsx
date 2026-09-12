import { useState } from 'react'
import { BrainCircuit, Languages, TextCursorInput, Palette, Database, Wrench, User } from 'lucide-react'
import AIModelsView from './AIModelsView'
import LanguageSettings from './LanguageSettings'
import FormattingSettings from './FormattingSettings'
import StyleSettings from './StyleSettings'
import MemorySettings from './MemorySettings'
import ToolsSettings from './ToolsSettings'
import AccountSettings from './AccountSettings'
import { useI18n } from '../../i18n'
import type { StylePreset } from '../../types'

type SettingsTab = 'ai' | 'style' | 'formatting' | 'language' | 'memory' | 'tools' | 'account'

interface SettingsViewProps {
  stylePresets: StylePreset[]
  onSaveStyle: (preset: StylePreset) => void
  onDeleteStyle: (id: string) => void
}

/** Sekcje ustawien: dropdown na telefonie, boczna nawigacja na desktopie. */
export default function SettingsView({ stylePresets, onSaveStyle, onDeleteStyle }: SettingsViewProps) {
  const { t } = useI18n()
  const [tab, setTab] = useState<SettingsTab>('ai')

  const items: Array<{ id: SettingsTab; label: string; icon: typeof BrainCircuit }> = [
    { id: 'ai', label: t('settingsAITab'), icon: BrainCircuit },
    { id: 'style', label: t('settingsStyleTab'), icon: Palette },
    { id: 'formatting', label: t('settingsFormattingTab'), icon: TextCursorInput },
    { id: 'language', label: t('settingsLanguageTab'), icon: Languages },
    { id: 'memory', label: t('settingsMemoryTab'), icon: Database },
    { id: 'tools', label: t('settingsToolsTab'), icon: Wrench },
    { id: 'account', label: t('settingsAccountTab'), icon: User },
  ]

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-dark md:flex-row">
      <div className="shrink-0 border-b border-edge bg-surface px-3 py-2 md:hidden">
        <select
          aria-label={t('navSettings')}
          value={tab}
          onChange={(event) => setTab(event.target.value as SettingsTab)}
          className="min-h-11 w-full min-w-0 rounded-lg border border-edge bg-surface-dark px-3 py-2 text-base text-[#e8e8eb] outline-none focus:border-accent"
        >
          {items.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </div>
      <div className="hidden min-h-0 w-52 shrink-0 flex-col gap-1 overflow-y-auto border-r border-edge bg-surface p-3 md:flex">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = tab === item.id
          return (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors ${
                isActive ? 'bg-accent text-white' : 'text-[#8a8a94] hover:bg-surface-light hover:text-white'
              }`}
            >
              <Icon size={16} />
              {item.label}
            </button>
          )
        })}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        {tab === 'ai' ? (
          <AIModelsView />
        ) : tab === 'style' ? (
          <StyleSettings
            stylePresets={stylePresets}
            onSaveStyle={onSaveStyle}
            onDeleteStyle={onDeleteStyle}
          />
        ) : tab === 'formatting' ? (
          <FormattingSettings />
        ) : tab === 'language' ? (
          <LanguageSettings />
        ) : tab === 'memory' ? (
          <MemorySettings />
        ) : tab === 'tools' ? (
          <ToolsSettings />
        ) : (
          <AccountSettings />
        )}
      </div>
    </main>
  )
}
