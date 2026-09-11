import { useEffect, useRef, useState } from 'react'
import { X, Plus, Trash2, Loader2, Pencil, Check } from 'lucide-react'
import type { Persona } from '../../types'
import { useSettings } from '../../context/SettingsContext'
import { uploadBlobFromFile } from '../../services/sync'
import Avatar from '../ui/Avatar'

interface PersonaManagerProps {
  personas: Persona[]
  /** Persona aktywnej konwersacji (moze byc inna niz domyslna). */
  activePersona: Persona
  onSave: (persona: Persona) => void
  onDelete: (id: string) => void
  onClose: () => void
}

/**
 * Manager person.
 *
 * Workflow (kazdy element ma jedna, jasna role):
 *   - klik w wiersz     -> ustaw jako DOMYSLNA (badge + podswietlenie)
 *   - olowek (zawsze widoczny) -> edycja imienia/opisu/avatara
 *   - kosz (przy hover)  -> usun
 *   - plus w naglowku    -> nowa persona
 *
 * Wiersze moga miec dwa niezalezne wskazniki:
 *   - "domyslna" (zolta gwiazdka przy nazwie) -> persona dla NOWYCH konwersacji
 *   - "aktywna" (niebieski napis)             -> persona uzywana w OTWARTEJ konwersacji
 * W typowym uzyciu oba sa takie same. Roznia sie gdy user zmienil
 * persone w konkretnej konwersacji przez menu (⋮ -> Persona).
 */
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
  const [draftAvatarBlobId, setDraftAvatarBlobId] = useState<string | undefined>(undefined)
  const [draftAvatarLegacy, setDraftAvatarLegacy] = useState<string | undefined>(undefined)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
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
    setDraftAvatarBlobId(undefined)
    setDraftAvatarLegacy(undefined)
  }

  const startEdit = (p: Persona) => {
    setEditing(p)
    setDraftName(p.name)
    setDraftDesc(p.description ?? '')
    setDraftAvatarBlobId(p.avatarBlobId ?? undefined)
    setDraftAvatarLegacy(p.avatar)
  }

  const handleAvatar = async (file: File) => {
    setUploadingAvatar(true)
    try {
      const blobId = await uploadBlobFromFile(file)
      setDraftAvatarBlobId(blobId)
      setDraftAvatarLegacy(undefined)
    } catch (err) {
      console.error('Upload avatara nie powiodl sie:', err)
      alert(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingAvatar(false)
    }
  }

  const save = () => {
    if (!editing || !draftName.trim()) return
    onSave({
      ...editing,
      name: draftName.trim(),
      description: draftDesc,
      avatarBlobId: draftAvatarBlobId ?? null,
      avatar: draftAvatarLegacy,
    })
    setEditing(null)
  }

  /** Klik w wiersz - ustaw jako domyslna. */
  const handleRowClick = (p: Persona) => {
    updateSettings({ defaultPersonaId: p.id })
  }

  const draftAvatarSrc = draftAvatarBlobId ?? draftAvatarLegacy

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-edge bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
          <h2 className="flex-1 text-[15px] font-semibold text-[#f2f2f4]">Persony</h2>
          <button onClick={startNew} className="rounded-lg p-2 text-[#8a8a94] hover:bg-surface-light hover:text-white" title="Nowa persona">
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
                disabled={uploadingAvatar}
                title="Kliknij aby zmienic avatar"
                className="mx-auto flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border border-edge bg-surface-dark text-[#6a6a72] hover:border-accent disabled:opacity-60"
              >
                {uploadingAvatar ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : draftAvatarSrc ? (
                  <Avatar src={draftAvatarSrc} name={draftName || '?'} size="lg" className="!h-20 !w-20 !rounded-full" />
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
                placeholder="Imie persony"
                autoFocus
                className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
              />
              <textarea
                value={draftDesc}
                onChange={(e) => setDraftDesc(e.target.value)}
                rows={4}
                placeholder="Opis - osobowosc, wyglad... (trafia do system promptu jako [Uzytkownik])"
                className="w-full resize-y rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] leading-relaxed text-[#e8e8eb] outline-none focus:border-accent"
              />

              <div className="flex justify-end gap-2">
                <button onClick={() => setEditing(null)} className="rounded-lg px-3 py-1.5 text-[12.5px] text-[#8a8a94] hover:bg-surface-light">
                  Anuluj
                </button>
                <button
                  onClick={save}
                  disabled={!draftName.trim() || uploadingAvatar}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
                >
                  <Check size={13} />
                  Zapisz
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {personas.map((p) => {
                const isActiveInConversation = p.id === activePersona.id
                const isDefault = settings.defaultPersonaId === p.id
                const avatarSrc = p.avatarBlobId ?? p.avatar

                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleRowClick(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleRowClick(p)
                      }
                    }}
                    title={isDefault ? 'Domyslna persona' : 'Kliknij, aby ustawic jako domyslna'}
                    className={`group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                      isDefault
                        ? 'bg-[#1e2436] ring-1 ring-inset ring-accent/40'
                        : 'hover:bg-surface-light'
                    }`}
                  >
                    <div className="shrink-0">
                      <Avatar src={avatarSrc} name={p.name} size="md" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium text-[#f2f2f4]">{p.name}</span>
                        {isDefault && (
                          <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-[#ffcc00]">
                            domyslna
                          </span>
                        )}
                        {isActiveInConversation && !isDefault && (
                          <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-wide text-accent">
                            aktywna
                          </span>
                        )}
                      </div>
                      <div className="truncate text-[11.5px] text-[#75757f]">
                        {p.description?.slice(0, 50) || 'Brak opisu'}
                      </div>
                    </div>
                    {/* Olowek - zawsze widoczny, jedyna sciezka do edycji. */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        startEdit(p)
                      }}
                      title="Edytuj"
                      className="shrink-0 rounded-lg p-1.5 text-[#8a8a94] transition-colors hover:bg-surface hover:text-white"
                    >
                      <Pencil size={14} />
                    </button>
                    {/* Kosz - przy hover, zeby nie zasmiecal. */}
                    {personas.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(p.id)
                        }}
                        title="Usun"
                        className="shrink-0 rounded-lg p-1.5 text-[#5a5f78] opacity-0 transition-opacity hover:bg-[#2a1a1a] hover:text-[#e05b5b] group-hover:opacity-100"
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
