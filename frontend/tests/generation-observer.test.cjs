const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/hooks/useGenerationJob.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const active = { id: 'j1', conversationId: 'c1', status: 'running', revision: 1, content: 'partial', mode: 'append' }
const settle = () => new Promise(resolve => setImmediate(resolve))

// Deterministic hook host: effects, refs and state persist across explicit renders.
// Network and timers are controlled; the production observer itself is unmodified.
function host(api) {
  const slots = [], effects = [], listeners = new Map(), timers = new Map(), received = []
  let cursor = 0, timerId = 0, conversationId = 'c1'
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = initial
      return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
    },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useEffect(callback, deps) {
      const index = cursor++, old = slots[index]
      if (!old || deps.some((value, i) => value !== old.deps[i])) {
        old?.cleanup?.()
        slots[index] = { deps }
        effects.push(() => { slots[index].cleanup = callback() })
      }
    },
  }
  const surface = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    exports: module.exports, module, AbortController, console,
    window: surface, document: surface,
    setTimeout: fn => { timers.set(++timerId, fn); return timerId }, clearTimeout: id => timers.delete(id),
    require: name => name === 'react' ? react : name.endsWith('/generation')
      ? { generationApi: api, isGenerationActive: job => ['queued', 'running'].includes(job?.status) }
      : { conversationsApi: { get: async id => ({ id, messages: ['durable'] }) } },
  })
  return {
    received,
    render(id = conversationId) {
      conversationId = id
      cursor = 0
      const result = module.exports.useGenerationJob(id, 'u1', conversation => received.push(conversation))
      while (effects.length) effects.shift()()
      return result
    },
    async poll() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); await settle() },
    async resume() { listeners.get('visibilitychange')?.(); await settle() },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) },
  }
}

test('reload discovers active job; reconnect loads durable result exactly once without POST', async () => {
  let latest = active, starts = 0
  const h = host({ list: async () => ({ items: [latest] }), start: async () => { starts++ } })
  h.render(); await settle()
  assert.equal(h.render().job.content, 'partial')
  latest = { ...active, status: 'succeeded', revision: 3, content: 'complete' }
  await h.resume()
  assert.equal(h.render().busy, false)
  assert.equal(h.received.length, 1)
  await h.poll()
  assert.equal(h.received.length, 1)
  assert.equal(starts, 0)
  h.unmount()
})

test('offline polling preserves job; unmount never cancels server execution', async () => {
  let offline = false, cancels = 0
  const h = host({ list: async () => { if (offline) throw Error('offline'); return { items: [active] } }, cancel: async () => { cancels++ } })
  h.render(); await settle()
  offline = true
  await h.poll()
  assert.equal(h.render().busy, true)
  assert.match(h.render().notice, /Ponawiam/)
  h.unmount()
  assert.equal(cancels, 0)
})

test('explicit Stop preserves partial output and failed Stop remains visible', async () => {
  let fail = true, cancels = 0, latest = active
  const h = host({ list: async () => ({ items: [latest] }), cancel: async id => {
    assert.equal(id, 'j1'); cancels++
    if (fail) throw Error('offline')
    return latest = { ...active, status: 'cancelled', revision: 2 }
  } })
  h.render(); await settle()
  await h.render().cancel(); await settle()
  assert.match(h.render().notice, /Nie potwierdzono zatrzymania/)
  fail = false
  await h.render().cancel(); await settle()
  assert.equal(h.render().job.content, 'partial')
  assert.equal(h.render().job.status, 'cancelled')
  assert.equal(cancels, 2)
  h.unmount()
})

test('lost admission response discovers accepted job without a second generation', async () => {
  let latest = null, starts = 0
  const h = host({ list: async () => ({ items: latest ? [latest] : [] }), start: async () => {
    starts++; latest = active; throw Error('lost response')
  } })
  h.render(); await settle()
  await h.render().start({ id: 'j1' }); await settle()
  assert.equal(h.render().job.id, 'j1')
  assert.equal(starts, 1)
  h.unmount()
})

test('late poll from previous conversation cannot replace current conversation', async () => {
  let resolveOld
  const h = host({ list: id => id === 'c1' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve({ items: [] }) })
  h.render()
  h.render('c2'); await settle()
  resolveOld({ items: [active] }); await settle()
  assert.equal(h.render().job, null)
  assert.equal(h.render().busy, false)
  h.unmount()
})

test('Stop during admission cancels the admitted job even before its id reaches the UI', async () => {
  let accept, latest = null, cancels = 0
  const h = host({
    list: async () => ({ items: latest ? [latest] : [] }),
    start: () => new Promise(resolve => { accept = () => { latest = active; resolve(active) } }),
    cancel: async id => { assert.equal(id, 'j1'); cancels++; return latest = { ...active, status: 'cancelled', revision: 2 } },
  })
  h.render(); await settle()
  const starting = h.render().start({ id: 'j1' })
  await h.render().cancel()
  accept(); await starting; await settle(); await h.poll()
  assert.equal(cancels, 1)
  assert.equal(h.render().job.status, 'cancelled')
  h.unmount()
})

test('an old empty poll cannot erase a newly admitted job', async () => {
  let finishOld, delayed = false
  const h = host({ list: () => delayed ? new Promise(resolve => { finishOld = resolve }) : Promise.resolve({ items: [] }), start: async () => active })
  h.render(); await settle()
  delayed = true
  void h.poll()
  await h.render().start({ id: 'j1' })
  finishOld({ items: [] }); await settle()
  assert.equal(h.render().job.id, 'j1')
  assert.equal(h.render().busy, true)
  h.unmount()
})

test('active summary refreshes the published chat and leaves input available', async () => {
  const h = host({ list: async () => ({ items: [{ ...active, operation: 'summary', phase: 'summary' }] }) })
  h.render(); await settle()
  assert.equal(h.render().busy, false)
  assert.equal(h.render().summaryActive, true)
  assert.equal(h.received.length, 1)
  await h.poll()
  assert.equal(h.received.length, 1)
  h.unmount()
})
