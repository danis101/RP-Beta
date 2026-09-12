// Polyfill MUSI byc zaimportowany jako pierwszy - zanim jakikolwiek inny
// modul zdazy wywolac crypto.randomUUID() na etapie ladowania.
import './lib/cryptoPolyfill'

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { I18nProvider, useI18n } from './i18n'
import { AuthProvider, useAuth } from './context/AuthContext'
import { SettingsProvider } from './context/SettingsContext'
import { ConflictProvider } from './context/ConflictContext'
import LoginScreen from './components/auth/LoginScreen'
import './index.css'
import { useViewportHeight } from './lib/useViewportHeight'

/**
 * Router sesji:
 *  - loading  -> ekran "laczenie z serwerem" (weryfikacja tokenu z localStorage)
 *  - brak user -> LoginScreen
 *  - zalogowany -> ConflictProvider + SettingsProvider + App
 *
 * ConflictProvider opakowuje tylko App (po loginie), bo tylko tam
 * moga wystapic konflikty sync.
 */
function Root() {
  useViewportHeight()
  const { t } = useI18n()
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-dark text-[13px] text-[#75757f]">
        {t('authConnecting')}
      </div>
    )
  }

  if (!user) {
    return <LoginScreen />
  }

  return (
    <ConflictProvider>
      <SettingsProvider>
        <App />
      </SettingsProvider>
    </ConflictProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </I18nProvider>
  </React.StrictMode>,
)
