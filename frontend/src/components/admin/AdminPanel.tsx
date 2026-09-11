import { useEffect, useState } from 'react'
import { Plus, Trash2, ShieldCheck, Loader2, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { useAuth } from '../../context/AuthContext'
import { adminApi, type AdminUser } from '../../services/sync'

/**
 * Panel administratora — zarządzanie kontami.
 * Widoczny tylko dla usera z isAdmin=true (sprawdzane w AuthContext + przy wejściu).
 */
export default function AdminPanel() {
  const { t } = useI18n()
  const { user: currentUser } = useAuth()

  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Formularz nowego usera
  const [adding, setAdding] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await adminApi.listUsers()
      setUsers(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const handleCreate = async () => {
    if (!newUsername.trim() || !newPassword || creating) return
    setCreating(true)
    setFormError(null)

    try {
      const created = await adminApi.createUser(newUsername.trim(), newPassword, false)
      setUsers((prev) => [...prev, created])
      setNewUsername('')
      setNewPassword('')
      setAdding(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string, username: string) => {
    if (!window.confirm(t('adminDeleteConfirm').replace('{name}', username))) return
    try {
      await adminApi.deleteUser(id)
      setUsers((prev) => prev.filter((u) => u.id !== id))
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err))
    }
  }

  const formatDate = (ts: number) =>
    new Date(ts).toLocaleString('pl-PL', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-dark">
      <div className="flex shrink-0 items-center gap-3 border-b border-edge bg-surface px-6 py-4">
        <div className="flex-1">
          <h1 className="text-[17px] font-semibold text-[#f2f2f4]">{t('adminTitle')}</h1>
          <p className="mt-0.5 text-[12px] text-[#75757f]">{t('adminSubtitle')}</p>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover"
          >
            <Plus size={14} /> {t('adminAddUser')}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-2xl space-y-3">
          {adding && (
            <div className="rounded-xl border border-edge bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-[13px] font-medium text-[#f2f2f4]">{t('adminNewUser')}</h2>
                <button
                  onClick={() => {
                    setAdding(false)
                    setFormError(null)
                  }}
                  className="rounded-lg p-1 text-[#8a8a94] hover:bg-surface-light hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="space-y-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
                    {t('adminUsername')}
                  </span>
                  <input
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    autoFocus
                    className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-medium text-[#8a8a94]">
                    {t('adminPassword')}
                  </span>
                  <input
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full rounded-lg border border-[#2a2a31] bg-surface-dark px-3 py-2 text-[13px] text-[#e8e8eb] outline-none focus:border-accent"
                  />
                  <span className="mt-1 block text-[11px] text-[#6a6a72]">{t('adminPasswordHint')}</span>
                </label>

                {formError && (
                  <p className="rounded-lg bg-[#2a1a1a] px-3 py-2 text-[12px] text-[#e05b5b]">
                    {formError}
                  </p>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => {
                      setAdding(false)
                      setFormError(null)
                    }}
                    className="rounded-lg px-3 py-2 text-[12.5px] text-[#8a8a94] hover:bg-surface-light"
                  >
                    {t('editorCancel')}
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={creating || !newUsername.trim() || !newPassword}
                    className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
                  >
                    {creating && <Loader2 size={13} className="animate-spin" />}
                    {t('adminCreate')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-edge p-8 text-[13px] text-[#75757f]">
              <Loader2 size={14} className="animate-spin" />
              {t('statusLoading')}
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-[#2a1a1a] px-4 py-3 text-[12.5px] text-[#e05b5b]">
              {error}
            </div>
          )}

          {!loading && !error && users.length === 0 && (
            <div className="rounded-xl border border-dashed border-edge p-8 text-center text-[13px] text-[#75757f]">
              {t('adminNoUsers')}
            </div>
          )}

          {!loading &&
            users.map((u) => {
              const isSelf = u.id === currentUser?.id
              return (
                <div
                  key={u.id}
                  className="flex items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-3"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[13px] font-semibold uppercase text-accent">
                    {u.username.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13.5px] font-medium text-[#f2f2f4]">
                        {u.username}
                      </span>
                      {u.isAdmin && (
                        <span className="flex items-center gap-1 rounded bg-[#1e2436] px-1.5 py-0.5 text-[10px] font-medium text-accent">
                          <ShieldCheck size={10} />
                          admin
                        </span>
                      )}
                      {isSelf && (
                        <span className="rounded bg-surface-light px-1.5 py-0.5 text-[10px] text-[#8a8a94]">
                          {t('adminYou')}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#5a5f78]">
                      {t('adminCreatedAt')}: {formatDate(u.createdAt)}
                    </div>
                  </div>
                  {!isSelf && (
                    <button
                      onClick={() => handleDelete(u.id, u.username)}
                      title={t('adminDelete')}
                      className="rounded-lg p-2 text-[#5a5f78] transition-colors hover:bg-[#2a1a1a] hover:text-[#e05b5b]"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              )
            })}
        </div>
      </div>
    </main>
  )
}
