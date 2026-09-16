import { useState } from 'react'
import { X, Trash2, Check } from 'lucide-react'
import type { LongTermMemoryEntry } from '../../types'
import { useI18n } from '../../i18n'

interface LongTermMemoryEditorProps {
  entry?: LongTermMemoryEntry
  onUpdate: (content: string | null) => void
  onClose: () => void
}

/** Modal do edycji pamięci długotrwałej. */
export default function LongTermMemoryEditor({ entry, onUpdate, onClose }: LongTermMemoryEditorProps) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(entry?.content ?? '')
  const save = () => { onUpdate(draft.trim() || null); onClose() }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-edge bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-5 py-3.5">
          <h2 className="flex-1 text-[15px] font-semibold text-[#f2f2f4]">{t('memoryEditorTitle')}</h2>
          <button onClick={onClose} className="rounded-lg p-2 text-[#8a8a94] hover:bg-surface-light hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {!entry && <p className="text-[13px] text-[#75757f]">{t('memoryEmpty')}</p>}
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={14}
            autoFocus
            placeholder={t('memoryAddPlaceholder')}
            className="min-h-[14rem] w-full resize-y rounded-xl border border-[#2a2a31] bg-surface-dark px-3 py-3 text-[13px] leading-relaxed text-[#e8e8eb] outline-none focus:border-accent"
          />
          <div className="flex justify-between gap-2">
            <button onClick={() => { onUpdate(null); onClose() }} disabled={!entry && !draft.trim()} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12.5px] text-[#e05b5b] hover:bg-[#2a1a1a] disabled:opacity-40">
              <Trash2 size={14} /> Usuń pamięć
            </button>
            <button onClick={save} className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-accent-hover">
              <Check size={14} /> Zapisz
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
