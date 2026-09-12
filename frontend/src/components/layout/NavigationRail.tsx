import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Users, Settings, BookOpen, LogOut, ShieldCheck, RefreshCw, MoreHorizontal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useI18n } from '../../i18n'
import type { Persona } from '../../types'
import { useAuth } from '../../context/AuthContext'
import Avatar from '../ui/Avatar'

export type AppView = 'chat' | 'cards' | 'settings' | 'lorebooks'

interface NavItem {
  id: AppView
  label: string
  icon: LucideIcon
}

interface NavigationRailProps {
  activeView: AppView
  onNavigate: (view: AppView, mobile?: boolean) => void
  persona: Persona
  onOpenPersonaManager: () => void
  onManualRefresh?: () => void
  refreshing?: boolean
}

export default function NavigationRail({
  activeView,
  onNavigate,
  persona,
  onOpenPersonaManager,
  onManualRefresh,
  refreshing = false,
}: NavigationRailProps) {
  const { t } = useI18n()
  const { user, logout } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  const topItems: NavItem[] = [
    { id: 'chat', label: t('navChat'), icon: MessageSquare },
    { id: 'cards', label: t('navCards'), icon: Users },
  ]

  const bottomItems: NavItem[] = [
    { id: 'lorebooks', label: t('lorebookTitle'), icon: BookOpen },
    { id: 'settings', label: t('navSettings'), icon: Settings },
  ]

  const renderButton = (item: NavItem, mobile = false) => {
    const Icon = item.icon
    const isActive = item.id === activeView

    return (
      <button
        key={item.id}
        title={item.label}
        aria-label={item.label}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => { setMoreOpen(false); onNavigate(item.id, mobile) }}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors ${
          isActive
            ? 'bg-accent text-white'
            : 'text-[#8a8a94] hover:bg-surface-light hover:text-white'
        }`}
      >
        <Icon size={20} />
      </button>
    )
  }

  // Preferujemy nowy format blob (avatarBlobId), fallback na stary base64 (avatar).
  const personaAvatarSrc = persona?.avatarBlobId ?? persona?.avatar

  return (
    <>
    <nav className="hidden min-h-0 w-16 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-edge bg-surface py-4 md:flex">
      {/* Persona u gory */}
      <button
        onClick={onOpenPersonaManager}
        title={persona?.name ?? 'Persona'}
        className="mb-1 rounded-full transition-transform hover:scale-105"
      >
        <Avatar src={personaAvatarSrc} name={persona?.name ?? '?'} size="md" />
      </button>

      {topItems.map((item) => renderButton(item))}

      <div className="mt-auto flex flex-col items-center gap-2">
        {bottomItems.map((item) => renderButton(item))}

        {onManualRefresh && (
          <button
            title={t('navRefresh')}
            onClick={onManualRefresh}
            disabled={refreshing}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[#8a8a94] transition-colors hover:bg-surface-light hover:text-white disabled:opacity-50"
          >
            <RefreshCw size={20} className={refreshing ? 'animate-spin' : ''} />
          </button>
        )}

        {user?.isAdmin && (
          <button
            title={t('navAdmin')}
            onClick={() => {
              window.location.hash = '#/admin'
            }}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[#8a8a94] transition-colors hover:bg-surface-light hover:text-white"
          >
            <ShieldCheck size={20} />
          </button>
        )}

        <button
          title={`${t('authLogout')} (${user?.username ?? ''})`}
          onClick={logout}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-[#8a8a94] transition-colors hover:bg-[#2a1a1a] hover:text-[#e05b5b]"
        >
          <LogOut size={20} />
        </button>
      </div>
    </nav>
    <nav aria-label={t('navMobile')} className="mobile-nav relative order-last z-30 flex shrink-0 items-center justify-around border-t border-edge bg-surface pt-1 md:hidden">
      {[...topItems, ...bottomItems].map((item) => renderButton(item, true))}
      <div ref={moreRef}>
        <button
          aria-label={t('navMore')}
          aria-expanded={moreOpen}
          aria-controls="mobile-nav-more"
          onClick={() => setMoreOpen((open) => !open)}
          className="flex h-11 w-11 items-center justify-center rounded-xl text-[#8a8a94] hover:bg-surface-light"
        ><MoreHorizontal size={22} /></button>
        {moreOpen && (
          <div id="mobile-nav-more" className="absolute bottom-full right-2 mb-2 max-h-[60dvh] w-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-edge bg-surface p-1 shadow-xl">
            <button onClick={() => { setMoreOpen(false); onOpenPersonaManager() }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-light">
              <Avatar src={personaAvatarSrc} name={persona?.name ?? '?'} size="sm" />
              <span className="truncate">{persona?.name ?? 'Persona'}</span>
            </button>
            {onManualRefresh && <button disabled={refreshing} onClick={() => { setMoreOpen(false); onManualRefresh() }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-light disabled:opacity-50">
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />{t('navRefresh')}
            </button>}
            {user?.isAdmin && <button onClick={() => { setMoreOpen(false); window.location.hash = '#/admin' }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-light">
              <ShieldCheck size={18} />{t('navAdmin')}
            </button>}
            <button onClick={logout} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-[#e05b5b] hover:bg-surface-light">
              <LogOut size={18} />{t('authLogout')}
            </button>
          </div>
        )}
      </div>
    </nav>
    </>
  )
}
