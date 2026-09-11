import { useRef, useState } from 'react'
import {
  Plus, Upload, Download, Trash2, GripVertical, ChevronDown, ChevronUp, Star,
} from 'lucide-react'
import { useI18n } from '../../i18n'
import { useSettings } from '../../context/SettingsContext'
import type { PromptBlock, StyleConfig, StylePreset } from '../../types'
import { defaultStyle } from '../../lib/style'

const MARKER_OPTIONS: Array<{ identifier: string; label: string }> = [
  { identifier: 'charDescription', label: 'Opis postaci (charDescription)' },
  { identifier: 'charPersonality', label: 'Osobowość postaci (charPersonality)' },
  { identifier: 'scenario', label: 'Scenariusz (scenario)' },
  { identifier: 'personaDescription', label: 'Opis persony (personaDescription)' },
  { identifier: 'dialogueExamples', label: 'Przykłady rozmów (dialogueExamples)' },
  { identifier: 'longTermMemory', label: 'Pamięć długotrwała (longTermMemory)' },
  { identifier: 'chatHistory', label: 'Historia czatu (chatHistory)' },
  { identifier: 'worldInfoBefore', label: 'Lorebook przed (worldInfoBefore)' },
  { identifier: 'worldInfoAfter', label: 'Lorebook po (worldInfoAfter)' },
]

const MARKER_IDENTIFIERS = new Set(MARKER_OPTIONS.map((m) => m.identifier))

function normalizeImportedBlocks(prompts: PromptBlock[]): PromptBlock[] {
  return prompts.map((block) => {
    if (MARKER_IDENTIFIERS.has(block.identifier)) {
      return { ...block, marker: true, content: '' }
    }
    return block
  })
}

interface StyleSettingsProps {
  stylePresets: StylePreset[]
  onSaveStyle: (preset: StylePreset) => void
  onDeleteStyle: (id: string) => void
}

/** Zakładka Styl — presety stylów z blokami. Dane przez API (props z App). */
export default function StyleSettings({ stylePresets, onSaveStyle, onDeleteStyle }: StyleSettingsProps) {
  const { t } = useI18n()
  const { settings, setDefaultStyle } = useSettings()
  const [activePresetId, setActivePresetId] = useState<string>(
    settings.defaultStyleId || stylePresets[0]?.id || '',
  )
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const presets = stylePresets
  const activePreset = presets.find((p) => p.id === activePresetId)

  if (!activePreset) {
    const createEmpty = () => {
      const preset: StylePreset = {
        id: crypto.randomUUID(),
        name: 'Default',
        style: defaultStyle(),
      }
      onSaveStyle(preset)
      setActivePresetId(preset.id)
    }

    const importFile = async (file: File) => {
      try {
        const text = await file.text()
        const parsed = JSON.parse(text) as StyleConfig
        const preset: StylePreset = {
          id: crypto.randomUUID(),
          name: file.name.replace(/\.json$/i, ''),
          style: {
            ...defaultStyle(),
            ...parsed,
            prompts: normalizeImportedBlocks(Array.isArray(parsed.prompts) ? parsed.prompts : []),
            promptOrder: Array.isArray(parsed.promptOrder) ? parsed.promptOrder : [],
          },
        }
        onSaveStyle(preset)
        setActivePresetId(preset.id)
      } catch (error) {
        console.error('Import stylu:', error)
        alert(t('styleImportError'))
      }
    }

    return (
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-dark">
        <div className="flex shrink-0 items-center gap-3 border-b border-edge bg-surface px-6 py-4">
          <div className="flex-1">
            <h1 className="text-[17px] font-semibold text-[#f2f2f4]">{t('styleTitle')}</h1>
            <p className="mt-0.5 text-[12px] text-[#75757f]">{t('styleSubtitle')}</p>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light"
          >
            <Upload size={14} /> {t('styleImport')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
          />
          <button
            onClick={createEmpty}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            <Plus size={14} /> {t('styleNewPreset')}
          </button>
        </div>
        <div className="flex flex-1 items-center justify-center text-[13px] text-[#75757f]">
          {t('styleEmpty')}
        </div>
      </main>
    )
  }

  const style = activePreset.style

  const update = (next: StyleConfig) => {
    onSaveStyle({ ...activePreset, style: next })
  }

  const moveBlock = (from: number, to: number) => {
    if (to < 0 || to >= style.prompts.length) return
    const prompts = [...style.prompts]
    const [moved] = prompts.splice(from, 1)
    prompts.splice(to, 0, moved)
    update({ ...style, prompts })
  }

  const updateBlock = (identifier: string, partial: Partial<PromptBlock>) => {
    update({
      ...style,
      prompts: style.prompts.map((b) => (b.identifier === identifier ? { ...b, ...partial } : b)),
    })
  }

  const addBlock = () => {
    const block: PromptBlock = {
      identifier: crypto.randomUUID(),
      name: 'Nowy bloczek',
      content: '',
      systemPrompt: true,
      marker: false,
      role: 'system',
      injectionPosition: 0,
      injectionDepth: 4,
      forbidOverrides: false,
      enabled: true,
    }
    update({ ...style, prompts: [...style.prompts, block] })
    setExpandedId(block.identifier)
  }

  const deleteBlock = (identifier: string) => {
    update({ ...style, prompts: style.prompts.filter((b) => b.identifier !== identifier) })
  }

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text) as StyleConfig
      update({
        ...defaultStyle(),
        ...parsed,
        prompts: normalizeImportedBlocks(Array.isArray(parsed.prompts) ? parsed.prompts : []),
        promptOrder: Array.isArray(parsed.promptOrder) ? parsed.promptOrder : [],
      })
    } catch (error) {
      console.error('Import stylu:', error)
      alert(t('styleImportError'))
    }
  }

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(style, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${activePreset.name || 'style'}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const createPreset = () => {
    const preset: StylePreset = {
      id: crypto.randomUUID(),
      name: `Styl ${presets.length + 1}`,
      style: defaultStyle(),
    }
    onSaveStyle(preset)
    setActivePresetId(preset.id)
  }

  const renamePreset = () => {
    const name = window.prompt(t('stylePresetNamePrompt'), activePreset.name)
    if (name !== null) {
      onSaveStyle({ ...activePreset, name })
    }
  }

  const handleDeletePreset = () => {
    if (presets.length <= 1) return
    onDeleteStyle(activePreset.id)
    setActivePresetId(presets.find((p) => p.id !== activePreset.id)?.id ?? '')
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-dark">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-surface px-6 py-4">
        <div className="mr-auto min-w-0">
          <h1 className="text-[17px] font-semibold text-[#f2f2f4]">{t('styleTitle')}</h1>
          <p className="mt-0.5 text-[12px] text-[#75757f]">{t('styleSubtitle')}</p>
        </div>

        <select
          value={activePreset.id}
          onChange={(e) => setActivePresetId(e.target.value)}
          className="rounded-lg border border-[#2a2a31] bg-surface px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <button
          onClick={() => setDefaultStyle(activePreset.id)}
          title={t('styleSetDefault')}
          className={`rounded-lg p-2 ${
            settings.defaultStyleId === activePreset.id ? 'text-[#ffcc00]' : 'text-[#5a5f78] hover:text-white'
          }`}
        >
          <Star size={15} fill={settings.defaultStyleId === activePreset.id ? 'currentColor' : 'none'} />
        </button>
        <button onClick={renamePreset} className="rounded-lg border border-edge px-2.5 py-2 text-[12px] text-[#8a8a94] hover:bg-surface-light">
          {t('styleRename')}
        </button>
        {presets.length > 1 && (
          <button onClick={handleDeletePreset} className="rounded-lg border border-edge p-2 text-[#8a8a94] hover:bg-[#2a1a1a] hover:text-[#e05b5b]" title={t('styleDeletePreset')}>
            <Trash2 size={14} />
          </button>
        )}

        <button onClick={createPreset} className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-2 text-[12px] text-[#b8bdd0] hover:bg-surface-light">
          <Plus size={14} /> {t('styleNewPreset')}
        </button>
        <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-2 text-[12px] text-[#b8bdd0] hover:bg-surface-light">
          <Upload size={14} /> {t('styleImport')}
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && handleImportFile(e.target.files[0])} />
        <button onClick={handleExport} className="flex items-center gap-1.5 rounded-lg border border-edge px-2.5 py-2 text-[12px] text-[#b8bdd0] hover:bg-surface-light">
          <Download size={14} /> {t('styleExport')}
        </button>
        <button onClick={addBlock} className="flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-2 text-[12px] font-semibold text-white hover:bg-accent-hover">
          <Plus size={14} /> {t('styleAddBlock')}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {style.prompts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-edge p-8 text-center text-[13px] text-[#75757f]">
            {t('styleEmpty')}
          </div>
        ) : (
          <div className="max-w-3xl space-y-2">
            {style.prompts.map((block, index) => {
              const expanded = expandedId === block.identifier

              return (
                <div
                  key={block.identifier}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null && dragIndex !== index) {
                      moveBlock(dragIndex, index)
                    }
                    setDragIndex(null)
                  }}
                  className={`overflow-hidden rounded-xl border transition-colors ${
                    block.enabled ? 'border-edge bg-surface' : 'border-edge bg-surface opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <GripVertical size={15} className="shrink-0 cursor-grab text-[#5a5f78]" />
                    <button
                      onClick={() => setExpandedId(expanded ? null : block.identifier)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium text-[#f2f2f4]">
                          {block.name || 'Bez nazwy'}
                        </span>
                        {block.marker && (
                          <span className="shrink-0 rounded bg-[#1e2436] px-1.5 py-0.5 text-[10px] font-medium text-accent">
                            {MARKER_OPTIONS.find((m) => m.identifier === block.identifier)?.label.split(' ')[0] ?? 'marker'}
                          </span>
                        )}
                        <span className="shrink-0 text-[10.5px] text-[#5a5f78]">
                          {block.systemPrompt ? 'system' : 'chat'}
                        </span>
                      </div>
                    </button>
                    <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full">
                      <input
                        type="checkbox"
                        checked={block.enabled}
                        onChange={(e) => updateBlock(block.identifier, { enabled: e.target.checked })}
                        className="peer sr-only"
                      />
                      <div
                        className={`relative h-6 w-11 rounded-full transition-colors ${
                          block.enabled ? 'bg-accent' : 'bg-[#2a2a31]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                            block.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'
                          }`}
                        />
                      </div>
                    </label>
                    <button
                      onClick={() => deleteBlock(block.identifier)}
                      className="rounded-lg p-1.5 text-[#5a5f78] hover:text-[#e05b5b]"
                    >
                      <Trash2 size={14} />
                    </button>
                    <button
                      onClick={() => setExpandedId(expanded ? null : block.identifier)}
                      className="rounded-lg p-1.5 text-[#8a8a94] hover:text-white"
                    >
                      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  </div>

                  {expanded && (
                    <div className="space-y-3 border-t border-edge p-4">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('styleBlockName')}</span>
                        <input
                          value={block.name}
                          onChange={(e) => updateBlock(block.identifier, { name: e.target.value })}
                          className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                        />
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={block.marker}
                          onChange={(e) => {
                            const isMarker = e.target.checked
                            if (isMarker) {
                              updateBlock(block.identifier, {
                                marker: true,
                                identifier: 'charDescription',
                                content: '',
                                name: 'Opis postaci',
                              })
                            } else {
                              updateBlock(block.identifier, {
                                marker: false,
                                identifier: crypto.randomUUID(),
                                name: 'Nowy bloczek',
                              })
                            }
                          }}
                        />
                        <span className="text-[12.5px] text-[#b8bdd0]">{t('styleBlockMarker')}</span>
                      </label>

                      {block.marker && (
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
                            {t('styleBlockMarkerSource')}
                          </span>
                          <select
                            value={block.identifier}
                            onChange={(e) => {
                              const identifier = e.target.value
                              const option = MARKER_OPTIONS.find((m) => m.identifier === identifier)
                              updateBlock(block.identifier, {
                                identifier,
                                name: option?.label ?? block.name,
                              })
                            }}
                            className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                          >
                            {MARKER_OPTIONS.map((m) => (
                              <option key={m.identifier} value={m.identifier}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      {!block.marker && (
                        <label className="block">
                          <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('styleBlockContent')}</span>
                          <textarea
                            value={block.content ?? ''}
                            onChange={(e) => updateBlock(block.identifier, { content: e.target.value })}
                            rows={8}
                            className="w-full resize-y rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 font-mono text-[12.5px] leading-relaxed text-[#e8e8eb] outline-none focus:border-accent"
                          />
                        </label>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  )
}
