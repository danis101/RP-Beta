import { useEffect, useRef, useState } from 'react'
import { X, Plus, Trash2, Star } from 'lucide-react'
import type { Persona } from '../../types'
import { useSettings } from '../../context/SettingsContext'
import Avatar from '../ui/Avatar'

interface PersonaManagerProps {
  personas: Persona[]
  activePersona: Persona
  onSave: (persona: Persona) => void
  onDelete: (id: string) => void
  onClose: () => void
}

/** Menedżer person: lista, edycja, dodawanie, usuwanie, ustawianie domyślnej. */
export default function PersonaManager({
  personas,
  activePersona,
  onSave,
  onDelete,
  onClose,
}: PersonaManagerProps) {
  const { settings, updateSettings } = useSettings()
  const [editing, setEditing] = useState<Persona | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftDesc, setDraftDesc] = useState('')
  const [draftAvatar, setDraftAvatar] = useState<string | undefined>(undefined)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  const startNew = () => {
    setEditing({ id: crypto.randomUUID(), name: '', description: '' })
    setDraftName('')
    setDraftDesc('')
    setDraftAvatar(undefined)
  }

  const startEdit = (p: Persona) => {
    setEditing(p)
    setDraftName(p.name)
    setDraftDesc(p.description ?? '')
    setDraftAvatar(p.avatar)
  }

  const handleAvatar = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setDraftAvatar(reader.result as string)
    reader.readAsDataURL(file)
  }

  const save = () => {
    if (!editing || !draftName.trim()) return
    onSave({
      ...editing,
      name: draftName.trim(),
      description: draftDesc,
      avatar: draftAvatar,
    })
    setEditing(null)
  }

  const setDefault = (id: string) => {
    updateSettings({ defaultPersonaId: id })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-edge bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <h2 className="flex-1 text-[15px] font-semibold text-[#f2f2f4]">Persony</h2>
          <button onClick={startNew} className="rounded-lg p-2 text-[#8a8a94] hover:bg-surface-light hover:text-white">
            <Plus size={16} />
          </button>
          <button onClick={onClose} className="rounded-lg p-2 text-[#8a8a94] hover:bg-surface-light hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {editing ? (
            <div className="space-y-3 rounded-xl border border-edge bg-surface-light p-4">
              <button
                onClick={() => fileRef.current?.click()}
                className="mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-edge bg-surface-dark text-[#6a6a72] hover:border-accent"
              >
                {draftAvatar ? (
                  <img src={draftAvatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[10.5px]">Avatar</span>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleAvatar(e.target.files[0])}
              />

              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder="Imię persony"
                className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
              />
              <textarea
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                rows={4}
                placeholder="Opis — osobowość, wygląd… (trafia do system promptu jako [Użytkownik])"
                className="w-full resize-y rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] leading-relaxed text-[#e8e8eb] outline-none focus:border-accent"
              />

              <div className="flex justify-end gap-2">
                <button onClick={() => setEditing(null)} className="rounded-lg px-3 py-1.5 text-[12.5px] text-[#8a8a94] hover:bg-surface-light">
                  Anuluj
                </button>
                <button
                  onClick={save}
                  disabled={!draftName.trim()}
                  className="rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
                >
                  Zapisz
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {personas.map((p) => {
                const isActive = p.id === activePersona.id
                const isDefault = settings.defaultPersonaId === p.id
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                      isActive ? 'bg-[#1e2436]' : 'hover:bg-surface-light'
                    }`}
                  >
                    <button onClick={() => startEdit(p)} className="shrink-0">
                      <Avatar src={p.avatar} name={p.name} size="md" />
                    </button>
                    <button onClick={() => startEdit(p)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-[13.5px] font-medium text-[#f2f2f4]">{p.name}</div>
                      <div className="truncate text-[11.5px] text-[#75757f]">
                        {p.description?.slice(0, 50) || 'Brak opisu'}
                      </div>
                    </button>
                    {isActive && <span className="text-[10.5px] font-semibold text-accent">aktywna</span>}
                    <button
                      onClick={() => setDefault(p.id)}
                      title="Ustaw jako domyślną"
                      className={`rounded-lg p-1.5 ${
                        isDefault ? 'text-[#ffcc00]' : 'text-[#5a5f78] hover:text-white'
                      }`}
                    >
                      <Star size={14} fill={isDefault ? 'currentColor' : 'none'} />
                    </button>
                    {personas.length > 1 && (
                      <button
                        onClick={() => onDelete(p.id)}
                        className="rounded-lg p-1.5 text-[#5a5f78] hover:text-[#e05b5b]"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
