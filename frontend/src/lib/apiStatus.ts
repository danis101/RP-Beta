import { useSyncExternalStore } from 'react'
import type { ApiProfile } from '../types'
import { OpenAIAdapter } from '../services/api'

/**
 * Globalny status aktywności API + załadowania modelu.
 *
 * Trzy stany (zgodnie z ustaleniem):
 *  - 'ok'        — API odpowiada i model jest gotowy (LM Studio: state=loaded;
 *                  generyczny backend: wystarczy że API odpowiedziało + model ustawiony)
 *  - 'no-model'  — API odpowiada, ale model nie wybrany / nie znaleziony / niezaładowany
 *  - 'offline'   — API nie odpowiada (błąd sieci / HTTP / timeout)
 *  - 'unknown'   — stan początkowy, sprawdzanie w toku
 *
 * Sprawdzanie tylko aktywnego profilu, poll co 60 s (konfigurowalny).
 * Stan trzymamy w module-level store + useSyncExternalStore,
 * żeby nie ciągnąć go przez Context i nie re-renderować całego drzewa.
 */

export type ApiStatus = 'ok' | 'no-model' | 'offline' | 'unknown'
export type ApiBackend = 'lmstudio' | 'generic'

export interface ApiStatusSnapshot {
  status: ApiStatus
  backend?: ApiBackend
  modelId?: string
  lastCheck: number
  error?: string
}

let snapshot: ApiStatusSnapshot = {
  status: 'unknown',
  lastCheck: 0,
}

const listeners = new Set<() => void>()
let currentAbort: AbortController | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

function emit(next: Partial<ApiStatusSnapshot>): void {
  snapshot = { ...snapshot, ...next, lastCheck: Date.now() }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): ApiStatusSnapshot {
  return snapshot
}

/** React hook – subskrybuje aktualny status API/modelu. */
export function useApiStatus(): ApiStatusSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Sprawdza aktywny profil:
 *  - LM Studio (jeśli /api/v0/models odpowie): realny stan załadowania modelu,
 *  - generyczny OpenAI-compat: samo „API żyje”.
 */
export async function checkApiStatus(profile: ApiProfile | undefined): Promise<void> {
  if (currentAbort) currentAbort.abort()
  const abort = new AbortController()
  currentAbort = abort

  if (!profile || !profile.baseUrl.trim()) {
    emit({ status: 'offline', backend: undefined, modelId: undefined, error: 'Brak Base URL' })
    return
  }

  const adapter = new OpenAIAdapter({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
  })

  const selectedModel = profile.model.trim()

  try {
    const result = await adapter.listModels(abort.signal)
    if (abort.signal.aborted) return

    const backend = result.backend ?? 'generic'

    if (!selectedModel) {
      emit({ status: 'no-model', backend, modelId: undefined, error: undefined })
      return
    }

    if (backend === 'lmstudio') {
      const found = result.models.find((m) => m.id === selectedModel)
      if (found?.status === 'loaded') {
        emit({ status: 'ok', backend, modelId: selectedModel, error: undefined })
      } else {
        emit({ status: 'no-model', backend, modelId: selectedModel, error: undefined })
      }
      return
    }

    // Generyczny backend – skoro odpowiedział i model jest ustawiony, uznajemy go za gotowy.
    emit({ status: 'ok', backend, modelId: selectedModel, error: undefined })
  } catch (err) {
    if (abort.signal.aborted) return
    emit({
      status: 'offline',
      backend: undefined,
      modelId: undefined,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Uruchamia pętlę sprawdzania statusu co `intervalMs` ms.
 * Pierwsze sprawdzenie następuje natychmiast (przed pierwszym interwałem).
 * Zwraca funkcję zatrzymującą.
 */
export function startApiStatusPolling(
  getProfile: () => ApiProfile | undefined,
  intervalMs = 60_000,
): () => void {
  stopApiStatusPolling()

  const tick = () => {
    void checkApiStatus(getProfile())
  }

  tick()
  pollTimer = setInterval(tick, intervalMs)

  return stopApiStatusPolling
}

export function stopApiStatusPolling(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (currentAbort) {
    currentAbort.abort()
    currentAbort = null
  }
}
