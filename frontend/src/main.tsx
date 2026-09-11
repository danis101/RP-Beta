import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { I18nProvider, useI18n } from './i18n'
import { AuthProvider, useAuth } from './context/AuthContext'
import { SettingsProvider } from './context/SettingsContext'
import LoginScreen from './components/auth/LoginScreen'
import './index.css'

/**
 * Router sesji:
 *  - loading  → ekran "łączenie z serwerem" (weryfikacja tokenu z localStorage)
 *  - brak user → LoginScreen
 *  - zalogowany → SettingsProvider + App
 *
 * SettingsProvider (na razie czyta z localStorage) opakowuje tylko App,
 * żeby ekran logowania nie uruchamiał niepotrzebnej logiki ustawień.
 */
function Root() {
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
    <SettingsProvider>
      <App />
    </SettingsProvider>
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
