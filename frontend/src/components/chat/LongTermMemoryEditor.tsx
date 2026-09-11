import { useState } from 'react'
import { X, Plus, Trash2, Pencil, Check, X as XIcon } from 'lucide-react'
import type { LongTermMemoryEntry } from '../../types'
import { useI18n } from '../../i18n'

interface LongTermMemoryEditorProps {
  entries: LongTermMemoryEntry[]
  onUpdate: (entries: LongTermMemoryEntry[]) => void
  onClose: () => void
}

/** Modal do edycji pamięci długotrwałej. */
export default function LongTermMemoryEditor({ entries, onUpdate, onClose }: LongTermMemoryEditorProps) {
  const { t } = useI18n()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [newContent, setNewContent] = useState('')

  const startEdit = (entry: LongTermMemoryEntry) => {
    setEditingId(entry.id)
    setEditDraft(entry.content)
  }

  const commitEdit = (id: string) => {
    if (!editDraft.trim()) return
    onUpdate(entries.map((e) => (e.id === id ? { ...e, content: editDraft.trim() } : e)))
    setEditingId(null)
    setEditDraft('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft('')
  }

  const deleteEntry = (id: string) => {
    onUpdate(entries.filter((e) => e.id !== id))
  }

  const addEntry = () => {
    if (!newContent.trim()) return
    const newEntry: LongTermMemoryEntry = {
      id: crypto.randomUUID(),
      content: newContent.trim(),
      timestamp: Date.now(),
      messageIndex: -1,
    }
    onUpdate([...entries, newEntry])
    setNewContent('')
  }

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

        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-3">
          {entries.length === 0 && (
            <div className="rounded-xl border border-dashed border-edge p-6 text-center text-[13px] text-[#75757f]">
              {t('memoryEmpty')}
            </div>
          )}

          {entries.map((entry) => {
            const editing = editingId === entry.id
            return (
              <div key={entry.id} className="rounded-xl border border-edge bg-surface-light p-3.5">
                {editing ? (
                  <div className="space-y-2">
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={3}
                      autoFocus
                      className="w-full resize-y rounded-lg border border-accent bg-surface-dark px-3 py-2 text-[13px] leading-relaxed text-[#e8e8eb] outline-none"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button onClick={cancelEdit} className="rounded-md p-1 text-[#8a8a94] hover:bg-surface-light hover:text-white">
                        <XIcon size={14} />
                      </button>
                      <button onClick={() => commitEdit(entry.id)} className="rounded-md p-1 text-accent hover:bg-surface-light">
                        <Check size={14} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 text-[13px] leading-relaxed text-[#e8e8eb] whitespace-pre-wrap">{entry.content}</div>
                      <button onClick={() => startEdit(entry)} className="rounded p-1 text-[#8a8a94] hover:bg-surface hover:text-white">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => deleteEntry(entry.id)} className="rounded p-1 text-[#8a8a94] hover:bg-[#2a1a1a] hover:text-[#e05b5b]">
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="mt-1 text-[10.5px] text-[#5a5f78]">
                      {entry.messageIndex >= 0 ? `${t('memoryAfterMessage')}${entry.messageIndex + 1}` : t('memoryManual')} · {new Date(entry.timestamp).toLocaleString()}
                    </div>
                  </>
                )}
              </div>
            )
          })}

          <div className="rounded-xl border border-dashed border-edge bg-surface p-3.5">
            <div className="flex items-start gap-2">
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={2}
                placeholder={t('memoryAddPlaceholder')}
                className="min-h-0 flex-1 resize-y rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] leading-relaxed text-[#e8e8eb] outline-none focus:border-accent"
              />
              <button
                onClick={addEntry}
                disabled={!newContent.trim()}
                className="shrink-0 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
