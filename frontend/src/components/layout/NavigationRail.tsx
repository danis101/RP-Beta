import { MessageSquare, Users, Settings, BookOpen, LogOut, ShieldCheck, RefreshCw } from 'lucide-react'
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
  onNavigate: (view: AppView) => void
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

  const topItems: NavItem[] = [
    { id: 'chat', label: t('navChat'), icon: MessageSquare },
    { id: 'cards', label: t('navCards'), icon: Users },
  ]

  const bottomItems: NavItem[] = [
    { id: 'lorebooks', label: t('lorebookTitle'), icon: BookOpen },
    { id: 'settings', label: t('navSettings'), icon: Settings },
  ]

  const renderButton = (item: NavItem) => {
    const Icon = item.icon
    const isActive = item.id === activeView

    return (
      <button
        key={item.id}
        title={item.label}
        onClick={() => onNavigate(item.id)}
        className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
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
    <nav className="flex w-16 flex-col items-center gap-2 border-r border-edge bg-surface py-4">
      {/* Persona u gory */}
      <button
        onClick={onOpenPersonaManager}
        title={persona?.name ?? 'Persona'}
        className="mb-1 rounded-full transition-transform hover:scale-105"
      >
        <Avatar src={personaAvatarSrc} name={persona?.name ?? '?'} size="md" />
      </button>

      {topItems.map(renderButton)}

      <div className="mt-auto flex flex-col items-center gap-2">
        {bottomItems.map(renderButton)}

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
  )
}
