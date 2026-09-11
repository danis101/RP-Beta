import { useState } from 'react'
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { Lorebook, LorebookEntry } from '../../types'
import { defaultLorebookEntry } from '../../lib/lorebook'

interface LorebookEditorProps {
  lorebook: Lorebook
  onChange: (lorebook: Lorebook) => void
  onBack: () => void
  onDelete: () => void
}

/** Edytor pojedynczego lorebooka: nazwa, scanDepth, wpisy. */
export default function LorebookEditor({ lorebook, onChange, onBack, onDelete }: LorebookEditorProps) {
  const { t } = useI18n()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const update = (partial: Partial<Lorebook>) => {
    onChange({ ...lorebook, ...partial })
  }

  const updateEntry = (id: string, partial: Partial<LorebookEntry>) => {
    onChange({
      ...lorebook,
      entries: lorebook.entries.map((e) => (e.id === id ? { ...e, ...partial } : e)),
    })
  }

  const addEntry = () => {
    const entry = defaultLorebookEntry()
    entry.order = lorebook.entries.length
    onChange({ ...lorebook, entries: [...lorebook.entries, entry] })
    setExpandedId(entry.id)
  }

  const deleteEntry = (id: string) => {
    onChange({ ...lorebook, entries: lorebook.entries.filter((e) => e.id !== id) })
  }

  const positionOptions = [
    { value: 0, label: t('lorebookPosBeforeChar') },
    { value: 1, label: t('lorebookPosAfterChar') },
    { value: 2, label: t('lorebookPosBefore') },
    { value: 3, label: t('lorebookPosAfter') },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge bg-surface-light px-6 py-3">
        {/* Strzałka wstecz — wraca do listy, nie usuwa */}
        <button
          onClick={onBack}
          title={t('lorebookBack')}
          className="rounded-lg p-2 text-[#8a8a94] hover:bg-surface hover:text-white"
        >
          <ArrowLeft size={15} />
        </button>

        <div className="flex-1 space-y-2">
          <input
            value={lorebook.name}
            onChange={(e) => update({ name: e.target.value })}
            className="w-full max-w-md rounded-lg border border-[#2a2a31] bg-surface px-3 py-2 text-[13px] font-medium text-[#e8e8eb] outline-none focus:border-accent"
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-[11.5px] text-[#8a8a94]">
              scanDepth
              <input
                type="number"
                min={1}
                max={20}
                value={lorebook.scanDepth}
                onChange={(e) => update({ scanDepth: parseInt(e.target.value) || 4 })}
                className="w-16 rounded-lg border border-[#2a2a31] bg-surface px-2 py-1 text-[12px] text-[#e8e8eb] outline-none focus:border-accent"
              />
            </label>
            <button
              onClick={addEntry}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-accent-hover"
            >
              <Plus size={14} /> {t('lorebookAddEntry')}
            </button>
          </div>
        </div>

        {/* Usuwanie lorebooka — osobny przycisk kosza */}
        <button
          onClick={onDelete}
          title={t('lorebookDelete')}
          className="rounded-lg p-2 text-[#5a5f78] hover:bg-[#2a1a1a] hover:text-[#e05b5b]"
        >
          <Trash2 size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-6">
        {lorebook.entries.length === 0 ? (
          <div className="rounded-xl border border-dashed border-edge p-8 text-center text-[13px] text-[#75757f]">
            {t('lorebookNoEntries')}
          </div>
        ) : (
          lorebook.entries.map((entry) => {
            const expanded = expandedId === entry.id

            return (
              <div
                key={entry.id}
                className={`overflow-hidden rounded-xl border transition-colors ${
                  entry.enabled ? 'border-edge bg-surface' : 'border-edge bg-surface opacity-60'
                }`}
              >
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-[#f2f2f4]">
                        {entry.name || (entry.keys.length > 0 ? entry.keys.join(', ') : t('lorebookNoKeys'))}
                      </span>
                      {entry.constant && (
                        <span className="shrink-0 rounded bg-[#1e2436] px-1.5 py-0.5 text-[10px] font-medium text-accent">
                          constant
                        </span>
                      )}
                      {entry.useRegex && (
                        <span className="shrink-0 rounded bg-[#1e2436] px-1.5 py-0.5 text-[10px] font-medium text-accent">
                          regex
                        </span>
                      )}
                      <span className="shrink-0 text-[10.5px] text-[#5a5f78]">
                        {positionOptions.find((p) => p.value === entry.position)?.label.split(' ').slice(0, 2).join(' ') ?? `pos ${entry.position}`}
                      </span>
                    </div>
                  </button>
                  <label className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full">
                    <input
                      type="checkbox"
                      checked={entry.enabled}
                      onChange={(e) => updateEntry(entry.id, { enabled: e.target.checked })}
                      className="peer sr-only"
                    />
                    <div className={`relative h-6 w-11 rounded-full transition-colors ${entry.enabled ? 'bg-accent' : 'bg-[#2a2a31]'}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${entry.enabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
                    </div>
                  </label>
                  <button onClick={() => deleteEntry(entry.id)} className="rounded-lg p-1.5 text-[#5a5f78] hover:text-[#e05b5b]">
                    <Trash2 size={14} />
                  </button>
                  <button onClick={() => setExpandedId(expanded ? null : entry.id)} className="rounded-lg p-1.5 text-[#8a8a94] hover:text-white">
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                </div>

                {expanded && (
                  <div className="space-y-3 border-t border-edge p-4">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('lorebookEntryName')}</span>
                      <input
                        value={entry.name ?? ''}
                        onChange={(e) => updateEntry(entry.id, { name: e.target.value })}
                        placeholder={t('lorebookEntryNamePlaceholder')}
                        className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
                        {t('lorebookKeys')} {entry.useRegex ? '(regex)' : ''}
                      </span>
                      <input
                        value={entry.keys.join(', ')}
                        onChange={(e) =>
                          updateEntry(entry.id, {
                            keys: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                          })
                        }
                        className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                        placeholder="foch, focha"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('lorebookContent')}</span>
                      <textarea
                        value={entry.content}
                        onChange={(e) => updateEntry(entry.id, { content: e.target.value })}
                        rows={5}
                        className="w-full resize-y rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[12.5px] leading-relaxed text-[#e8e8eb] outline-none focus:border-accent"
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">{t('lorebookPosition')}</span>
                        <select
                          value={entry.position}
                          onChange={(e) => updateEntry(entry.id, { position: parseInt(e.target.value) })}
                          className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                        >
                          {positionOptions.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">depth</span>
                        <input
                          type="number"
                          min={0}
                          max={20}
                          value={entry.depth}
                          onChange={(e) => updateEntry(entry.id, { depth: parseInt(e.target.value) || 0 })}
                          className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                        />
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={entry.constant}
                          onChange={(e) => updateEntry(entry.id, { constant: e.target.checked })}
                        />
                        <span className="text-[12px] text-[#b8bdd0]">constant</span>
                      </label>

                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={entry.useRegex}
                          onChange={(e) => updateEntry(entry.id, { useRegex: e.target.checked })}
                        />
                        <span className="text-[12px] text-[#b8bdd0]">regex</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
