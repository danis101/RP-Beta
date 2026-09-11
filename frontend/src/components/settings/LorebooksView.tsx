import { useRef, useState } from 'react'
import { Plus, Upload, Trash2, ChevronDown } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { Lorebook } from '../../types'
import { defaultLorebook, lorebookFromRaw } from '../../lib/lorebook'
import LorebookEditor from './LorebookEditor'

interface LorebooksViewProps {
  lorebooks: Lorebook[]
  onSave: (lorebook: Lorebook) => void
  onDelete: (id: string) => void
}

/** Zakładka Lorebooki — lista, import, edycja wpisów. Dane przez API (props z App). */
export default function LorebooksView({ lorebooks, onSave, onDelete }: LorebooksViewProps) {
  const { t } = useI18n()
  const [activeId, setActiveId] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleAdd = () => {
    const lorebook = defaultLorebook()
    onSave(lorebook)
    setActiveId(lorebook.id)
  }

  const importFile = async (file: File) => {
    try {
      const text = await file.text()
      const raw = JSON.parse(text)
      const fileBaseName = file.name.replace(/\.json$/i, '')
      const lorebook = lorebookFromRaw(raw, fileBaseName)
      onSave(lorebook)
      setActiveId(lorebook.id)
    } catch (error) {
      console.error('Import lorebooka:', error)
      alert(t('lorebookImportError'))
    }
  }

  const active = lorebooks.find((l) => l.id === activeId)

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-dark">
      <div className="flex shrink-0 items-center gap-3 border-b border-edge bg-surface px-6 py-4">
        <div className="flex-1">
          <h1 className="text-[17px] font-semibold text-[#f2f2f4]">{t('lorebookTitle')}</h1>
          <p className="mt-0.5 text-[12px] text-[#75757f]">{t('lorebookSubtitle')}</p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-[12.5px] text-[#b8bdd0] transition-colors hover:bg-surface-light"
        >
          <Upload size={14} /> {t('lorebookImport')}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
        />
        <button
          onClick={handleAdd}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          <Plus size={14} /> {t('lorebookNew')}
        </button>
      </div>

      {active ? (
        <LorebookEditor
          lorebook={active}
          onChange={onSave}
          onBack={() => setActiveId(null)}
          onDelete={() => {
            onDelete(active.id)
            setActiveId(null)
          }}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {lorebooks.length === 0 ? (
            <div className="rounded-xl border border-dashed border-edge p-8 text-center text-[13px] text-[#75757f]">
              {t('lorebookEmpty')}
            </div>
          ) : (
            <div className="max-w-3xl space-y-2">
              {lorebooks.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setActiveId(l.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-3 text-left transition-colors hover:border-accent/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-[#f2f2f4]">{l.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-[#75757f]">
                      {l.entries.length} {t('lorebookEntries')} · scanDepth {l.scanDepth}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDelete(l.id)
                    }}
                    className="rounded-lg p-2 text-[#5a5f78] hover:text-[#e05b5b]"
                  >
                    <Trash2 size={14} />
                  </button>
                  <ChevronDown size={14} className="text-[#5a5f78]" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  )
}
