import { useSyncExternalStore } from 'react'
import type { ApiProfile } from '../types'
import { OpenAIAdapter } from '../services/api'

/**
 * Globalny status aktywności API + załadowania modelu.
 *
 * Trzy stany:
 *  - 'ok'        — API odpowiada i model jest gotowy
 *  - 'no-model'  — API odpowiada, ale model nie wybrany / nie znaleziony
 *  - 'offline'   — API nie odpowiada (błąd sieci / HTTP / timeout)
 *  - 'unknown'   — stan początkowy, sprawdzanie w toku
 *
 * Timeout: każdy check ma własny AbortController z limitem 8s. Bez tego
 * wolny/no-responding endpoint blokuje kolejny tick pollingu i nagromadzają
 * się wiszące requesty (Bun/undici domyślnie czeka ~135s).
 *
 * Poll co 60s. Stan w module-level store + useSyncExternalStore,
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

/** Timeout jednego sprawdzenia (ms). Krótszy niż poll interval, żeby nie było kolejki. */
const CHECK_TIMEOUT_MS = 8_000

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
 * Sprawdza aktywny profil. Timeout 8s na cały check (oba endpointy razem).
 */
export async function checkApiStatus(profile: ApiProfile | undefined): Promise<void> {
  if (currentAbort) currentAbort.abort()
  const abort = new AbortController()
  currentAbort = abort

  // Twardy timeout — nawet jeśli fetch sam nie dostanie aborcji, my się poddamy.
  const timeoutId = setTimeout(() => {
    if (!abort.signal.aborted) abort.abort()
  }, CHECK_TIMEOUT_MS)

  const cleanup = () => {
    clearTimeout(timeoutId)
  }

  if (!profile || !profile.baseUrl.trim()) {
    cleanup()
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
    if (abort.signal.aborted) {
      cleanup()
      return
    }

    const backend = result.backend ?? 'generic'

    if (!selectedModel) {
      cleanup()
      emit({ status: 'no-model', backend, modelId: undefined, error: undefined })
      return
    }

    if (backend === 'lmstudio') {
      const found = result.models.find((m) => m.id === selectedModel)
      if (found?.status === 'loaded') {
        cleanup()
        emit({ status: 'ok', backend, modelId: selectedModel, error: undefined })
      } else {
        cleanup()
        emit({ status: 'no-model', backend, modelId: selectedModel, error: undefined })
      }
      return
    }

    // Generyczny backend – skoro odpowiedział i model jest ustawiony, uznajemy go za gotowy.
    cleanup()
    emit({ status: 'ok', backend, modelId: selectedModel, error: undefined })
  } catch (err) {
    cleanup()
    if (abort.signal.aborted) {
      // Timeout albo przerwane przez kolejny check — raportujemy jako offline.
      emit({
        status: 'offline',
        backend: undefined,
        modelId: undefined,
        error: `Timeout po ${CHECK_TIMEOUT_MS} ms`,
      })
      return
    }
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
 * Pierwsze sprawdzenie następuje natychmiast.
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

