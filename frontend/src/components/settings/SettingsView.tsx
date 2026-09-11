import { useState } from 'react'
import { BrainCircuit, Languages, TextCursorInput, Palette, Database, Wrench } from 'lucide-react'
import AIModelsView from './AIModelsView'
import LanguageSettings from './LanguageSettings'
import FormattingSettings from './FormattingSettings'
import StyleSettings from './StyleSettings'
import MemorySettings from './MemorySettings'
import ToolsSettings from './ToolsSettings'
import { useI18n } from '../../i18n'
import type { StylePreset } from '../../types'

type SettingsTab = 'ai' | 'style' | 'formatting' | 'language' | 'memory' | 'tools'

interface SettingsViewProps {
  stylePresets: StylePreset[]
  onSaveStyle: (preset: StylePreset) => void
  onDeleteStyle: (id: string) => void
}

/** Ustawienia z sub-nawigacją po lewej i przewijaną zawartością po prawej. */
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
  ]

  return (
    <main className="flex min-w-0 flex-1 overflow-hidden bg-surface-dark">
      <div className="flex w-52 shrink-0 flex-col gap-1 border-r border-edge bg-surface p-3">
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
        ) : (
          <ToolsSettings />
        )}
      </div>
    </main>
  )
}
