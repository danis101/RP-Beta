import { useEffect, useRef, useState } from 'react'
import { conversationsApi } from '../services/sync'
import { generationApi, isGenerationActive, type GenerationJob, type StartGeneration } from '../services/sync/generation'
import type { Conversation } from '../types'

/** The observer can disappear at any time. Only an explicit Stop cancels execution. */
export function useGenerationJob(conversationId: string | null, userId: string | undefined,
  onConversation: (conversation: Conversation, completed: boolean) => void) {
  const [job, setJob] = useState<GenerationJob | null>(null)
  const [notice, setNotice] = useState('')
  const [operationNotice, setOperationNotice] = useState('')
  const [checking, setChecking] = useState(true)
  const [starting, setStarting] = useState(false)
  const [summaryActive, setSummaryActive] = useState(false)
  const callback = useRef(onConversation)
  callback.current = onConversation
  const scope = `${userId ?? ''}:${conversationId ?? ''}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const startLock = useRef(false)
  const mutations = useRef(0)
  const admission = useRef<{ id: string; stop: boolean } | null>(null)
  const wake = useRef<() => void>(() => {})

  useEffect(() => {
    setJob(null)
    setNotice('')
    setOperationNotice('')
    setChecking(true)
    setSummaryActive(false)
    if (!conversationId || !userId) { setChecking(false); return }
    let disposed = false
    let pending = false
    let timer: ReturnType<typeof setTimeout>
    let applied = ''
    let pollDelay = 1500
    const controller = new AbortController()
    const poll = async () => {
      if (disposed || pending) return
      clearTimeout(timer)
      pending = true
      const version = mutations.current
      try {
        const { items } = await generationApi.list(conversationId, controller.signal)
        if (disposed || version !== mutations.current) return
        const latest = items.find(item => isGenerationActive(item) && item.operation !== 'summary') ?? items.find(isGenerationActive) ?? items[0] ?? null
        setSummaryActive(items.some(item => isGenerationActive(item) && item.operation === 'summary'))
        if (latest && admission.current && latest.id === admission.current.id && admission.current.stop && isGenerationActive(latest)) {
          await generationApi.cancel(latest.id)
          // Fetch the resulting state on the next poll, including its durable output.
          return
        }
        // Fetch the durable conversation before removing the streaming preview.
        const readKey = latest?.operation === 'summary' && isGenerationActive(latest) ? `${latest.id}:summary` : `${latest?.id}:${latest?.revision}`
        if ((!latest || !isGenerationActive(latest) || latest.operation === 'summary') && applied !== readKey) {
          const conversation = await conversationsApi.get(conversationId)
          if (disposed || version !== mutations.current) return
          callback.current(conversation, latest?.status === 'succeeded')
          applied = readKey
        }
        setJob(latest)
        pollDelay = isGenerationActive(latest) ? 1500 : 10000
        setNotice('')
        setChecking(false)
      } catch (error) {
        pollDelay = 3000
        if (!disposed) setNotice(`Nie udało się odczytać stanu zadania. Ponawiam połączenie. ${error instanceof Error ? error.message : ''}`)
      } finally {
        pending = false
        if (!disposed) timer = setTimeout(poll, pollDelay)
      }
    }
    wake.current = () => { void poll() }
    // A completed job may have expired while this tab was asleep. The durable
    // conversation still needs refreshing even when the job list is empty.
    const resume = () => { if (!document.hidden) { applied = ''; void poll() } }
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', resume)
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
      controller.abort()
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [conversationId, userId])

  const start = async (input: StartGeneration) => {
    if (startLock.current) throw new Error('Trwa już wysyłanie zadania.')
    startLock.current = true
    admission.current = { id: input.id, stop: false }
    mutations.current++
    setStarting(true)
    const initialScope = scopeRef.current
    try {
      const result = await generationApi.start(input)
      if (scopeRef.current === initialScope) { setJob(result); setNotice(''); setOperationNotice('') }
    } catch (error) {
      // The POST may have arrived even when its response was lost. Do not retry
      // under a new id or fall back to browser generation; discover it by polling.
      if (scopeRef.current === initialScope) {
        setChecking(true)
        setOperationNotice(`Nie potwierdzono uruchomienia zadania. Sprawdź stan rozmowy przed ponowieniem. ${error instanceof Error ? error.message : ''}`)
      }
    } finally {
      startLock.current = false
      mutations.current++
      setStarting(false)
      wake.current()
    }
  }

  const cancel = async () => {
    if (admission.current && startLock.current) admission.current.stop = true
    if (!job || !isGenerationActive(job)) return
    mutations.current++
    const initialScope = scopeRef.current
    try {
      const result = await generationApi.cancel(job.id)
      mutations.current++
      if (scopeRef.current === initialScope) { setJob(result); setOperationNotice('') }
      wake.current()
    } catch (error) {
      mutations.current++
      if (scopeRef.current === initialScope) setOperationNotice(`Nie potwierdzono zatrzymania. Spróbuj ponownie. ${error instanceof Error ? error.message : ''}`)
    }
  }
  // Avoid displaying the previous conversation's state during an effect transition.
  const visibleJob = job?.conversationId === conversationId ? job : null
  return { job: visibleJob, summaryActive, notice: notice || operationNotice,
    busy: checking || starting || (isGenerationActive(visibleJob) && visibleJob?.operation !== 'summary'), start, cancel }
}
