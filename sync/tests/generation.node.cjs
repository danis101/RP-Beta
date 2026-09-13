// Node 24 smoke tests of the actual lifecycle SQL/runner, without Bun or Docker.
const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const output = mkdtempSync(path.join(tmpdir(), 'rp-generation-test-'))
after(() => {
  if (path.dirname(output) === path.resolve(tmpdir()) && path.basename(output).startsWith('rp-generation-test-')) rmSync(output, { recursive: true, force: true })
})
writeFileSync(path.join(output, 'package.json'), '{"type":"commonjs"}')
execFileSync(process.execPath, [
  require.resolve('../../frontend/node_modules/typescript/bin/tsc'),
  'sync/src/generation/store.ts', 'sync/src/generation/runner.ts', 'sync/src/generation/searchWorkflow.ts',
  '--module', 'commonjs', '--target', 'ES2022', '--lib', 'ES2022,DOM', '--strict', '--skipLibCheck', '--rootDir', '.', '--outDir', output,
], { cwd: path.join(__dirname, '../..'), stdio: 'pipe' })
const { GenerationStore } = require(path.join(output, 'sync/src/generation/store.js'))
const { GenerationRunner } = require(path.join(output, 'sync/src/generation/runner.js'))
const { publicJob } = require(path.join(output, 'sync/src/generation/store.js'))
const { searchWorkflow } = require(path.join(output, 'sync/src/generation/searchWorkflow.js'))
const { parseSearchResults, searchFollowUp } = require(path.join(output, 'shared/llm/webSearch.js'))

function setup(t) {
  const sql = new DatabaseSync(':memory:')
  t.after(() => sql.close())
  sql.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE entities(user_id TEXT,type TEXT,id TEXT,data_json TEXT,updated_at INTEGER,deleted_at INTEGER,PRIMARY KEY(user_id,type,id));
    INSERT INTO users VALUES('a'),('b');`)
  const port = {
    exec: value => sql.exec(value), query: value => sql.prepare(value),
    run: (value, args = []) => sql.prepare(value).run(...args),
    transaction: fn => () => { sql.exec('BEGIN IMMEDIATE'); try { const result = fn(); sql.exec('COMMIT'); return result } catch (error) { sql.exec('ROLLBACK'); throw error } },
  }
  const store = new GenerationStore(port)
  const target = { id: 'user-message', role: 'user', variants: [{ content: 'hello' }], selectedVariant: 0, timestamp: 10 }
  const conversation = { id: 'chat', messages: [target], longTermMemory: [], _deletedMessageIds: [] }
  sql.prepare("INSERT INTO entities VALUES('a','conversation','chat',?,20,NULL)").run(JSON.stringify(conversation))
  const request = { id: 'job', conversationId: 'chat', targetMessageId: target.id, mode: 'append', expectedUpdatedAt: 20, profileId: 'model', messages: [{ role: 'user', content: 'hello' }] }
  const readChat = () => JSON.parse(sql.prepare("SELECT data_json FROM entities WHERE user_id='a'").get().data_json)
  const writeChat = chat => sql.prepare("UPDATE entities SET data_json=?,updated_at=updated_at+1 WHERE user_id='a'").run(JSON.stringify(chat))
  return { sql, port, store, request, readChat, writeChat }
}

test('admission is idempotent, scoped to owner, and rejects concurrent/stale requests', t => {
  const { store, request } = setup(t)
  assert.throws(() => store.start('a', { ...request, expectedUpdatedAt: 0 }), /zmienila/)
  assert.equal(store.start('a', request).created, true)
  assert.equal(store.start('a', request).created, false)
  assert.throws(() => store.start('a', { ...request, messages: [{ role: 'user', content: 'different' }] }), /identyfikator/)
  assert.throws(() => store.start('a', { ...request, id: 'second' }), /aktywne/)
  assert.equal(store.get('b', request.id), null)
  assert.equal(store.cancel('b', request.id), null)
})

test('completion updates current conversation once and preserves unrelated edits', t => {
  const { store, request, readChat, writeChat } = setup(t)
  store.start('a', request)
  store.update('a', request.id, 'running', 'part', '')
  const chat = readChat()
  chat.longTermMemory.push({ id: 'new-memory', content: 'keep me' })
  writeChat(chat)
  assert.equal(store.complete('a', request.id, 'answer', 'thought'), true)
  assert.equal(store.complete('a', request.id, 'duplicate', ''), false)
  assert.equal(readChat().messages.length, 2)
  assert.equal(readChat().longTermMemory[0].content, 'keep me')
  assert.deepEqual(readChat().messages[1].variants, [{ content: 'answer', thinking: 'thought' }])
  assert.equal(store.start('a', request).created, false)
})

test('deleted target is never revived; cancelled and restarted jobs never publish', t => {
  const { store, request, readChat, writeChat } = setup(t)
  store.start('a', request)
  store.update('a', request.id, 'running', 'part', '')
  const chat = readChat()
  chat._deletedMessageIds.push(request.targetMessageId)
  writeChat(chat)
  assert.equal(store.complete('a', request.id, 'answer', ''), false)
  assert.equal(store.get('a', request.id).status, 'conflict')
  assert.equal(store.get('a', request.id).content, 'answer')
  chat._deletedMessageIds = []
  writeChat(chat)
  const second = { ...request, id: 'second', expectedUpdatedAt: 22 }
  store.start('a', second)
  store.cancel('a', second.id)
  assert.equal(store.complete('a', second.id, 'answer', ''), false)
  store.start('a', { ...second, id: 'third' })
  store.recover()
  assert.equal(store.get('a', 'third').status, 'interrupted')
  assert.equal(readChat().messages.length, 1)
})

test('runner executes after start returns and explicit cancellation aborts only its own task', async t => {
  const { store, request, readChat } = setup(t)
  let published
  const finished = new Promise(resolve => { published = resolve })
  const runner = new GenerationRunner(store, published)
  const job = store.start('a', request).job
  let stream, signal
  runner.start(job, async value => {
    signal = value
    return new Response(new ReadableStream({ start(controller) { stream = controller } }))
  })
  assert.equal(store.get('a', job.id).status, 'running')
  assert.equal(signal.aborted, false)
  stream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n'))
  await finished
  assert.equal(readChat().messages[1].variants[0].content, 'answer')
  const rev = store.get('a', job.id).updated_at
  assert.ok(rev >= job.created_at)
  const currentVersion = JSON.parse(JSON.stringify(readChat()))
  // A separate pending job can be stopped before the model returns any bytes.
  const second = store.start('a', { ...request, id: 'second', mode: 'regenerate', targetMessageId: readChat().messages[1].id, expectedUpdatedAt: readChat().messages[1]._updatedAt }).job
  let cancelled
  const stopped = new Promise(resolve => { cancelled = resolve })
  runner.start(second, signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { reject(new Error('aborted')); cancelled() }, { once: true })))
  runner.cancel('a', second.id)
  await stopped
  assert.equal(store.get('a', second.id).status, 'cancelled')
  assert.deepEqual(readChat(), currentVersion)
  await new Promise(resolve => setImmediate(resolve))
})

test('regeneration appends a variant; concurrent target edits preserve result as a conflict', t => {
  const { store, request, readChat, writeChat } = setup(t)
  const chat = readChat()
  chat.messages.push({ id: 'assistant', role: 'assistant', variants: [{ content: 'old' }], selectedVariant: 0, timestamp: 15 })
  writeChat(chat)
  const regen = { ...request, mode: 'regenerate', targetMessageId: 'assistant', expectedUpdatedAt: 21 }
  store.start('a', regen)
  store.update('a', regen.id, 'running', '', '')
  assert.equal(store.complete('a', regen.id, 'new', ''), true)
  assert.deepEqual(readChat().messages[1].variants, [{ content: 'old' }, { content: 'new' }])
  const second = { ...regen, id: 'second', expectedUpdatedAt: readChat().messages[1]._updatedAt }
  store.start('a', second)
  store.update('a', second.id, 'running', '', '')
  const edited = readChat()
  edited.messages[1].variants[1].content = 'manual edit'
  writeChat(edited)
  assert.equal(store.complete('a', second.id, 'do not overwrite edit', ''), false)
  assert.equal(readChat().messages[1].variants[1].content, 'manual edit')
  assert.equal(store.get('a', second.id).status, 'conflict')
})

const searchResults = [{ title: 'Title', url: 'https://example.test', snippet: 'Fact', source: 'fixture' }]
const searchCall = (name = 'web_search', args = '{"query":"question"}') => ({ id: 'tool1', type: 'function', function: { name, arguments: args } })
const sse = (content, toolCalls = []) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content, tool_calls: toolCalls.map((call, index) => ({ ...call, index })) } }] })}\n\ndata: [DONE]\n\n`)

test('search workflow completes both model passes, preserves prompt order and publishes one message with sources', async t => {
  const { store, request, readChat } = setup(t)
  const messages = [{ role: 'system', content: 'SYSTEM\n\nLORE' }, { role: 'user', content: 'question' }]
  const job = store.start('a', { ...request, webSearch: true, messages }).job
  let published, searches = 0
  const done = new Promise(resolve => { published = resolve })
  const runner = new GenerationRunner(store, published)
  const payloads = []
  const workflow = searchWorkflow({ messages, enabled: () => true, showResults: true,
    open: async value => {
      payloads.push(value)
      // An additional tool call in pass two must not start a third pass.
      return sse(payloads.length === 1 ? 'Searching' : 'Final answer', [searchCall()])
    },
    search: async () => { searches++; assert.equal(publicJob(store.get('a', job.id)).phase, 'web-search'); return searchResults },
  })
  runner.start(job, () => { throw Error('plain path must not run') }, workflow)
  await done
  assert.equal(searches, 1)
  assert.equal(payloads.length, 2)
  assert.deepEqual(payloads[0], messages)
  assert.deepEqual(payloads[1], [messages[0], { role: 'user', content: `question\n\n${searchFollowUp('question', searchResults).content}` }])
  assert.equal(readChat().messages.length, 2)
  assert.deepEqual(readChat().messages[1].variants[0], { content: 'Final answer', toolCall: { type: 'websearch', label: 'question', results: searchResults } })
  assert.equal(publicJob(store.get('a', job.id)).toolCall.results[0].snippet, 'Fact')
  await new Promise(resolve => setImmediate(resolve))
})

test('search permissions are checked at execution; unsolicited image and unknown tools never execute', async () => {
  for (const enabled of [false, true]) {
    let searches = 0
    const result = await searchWorkflow({ messages: [{ role: 'user', content: 'hello' }], enabled: () => enabled, showResults: true,
      open: async () => sse('answer', enabled ? [searchCall('generate_image'), searchCall('unknown')] : [searchCall()]),
      search: async () => { searches++; return searchResults },
    })(new AbortController().signal, () => {})
    assert.equal(searches, 0)
    assert.equal(result.content, 'answer')
  }
})

test('empty results and invalid tool arguments do not add a follow-up; search errors keep existing error wording', async () => {
  for (const scenario of ['empty', 'invalid', 'error']) {
    let passes = 0, searches = 0
    const result = await searchWorkflow({ messages: [{ role: 'user', content: 'hello' }], enabled: () => true, showResults: true,
      open: async () => { passes++; return sse('answer', [searchCall('web_search', scenario === 'invalid' ? '{bad' : '{"query":"question"}')]) },
      search: async () => { searches++; if (scenario === 'error') throw Error('offline'); return [] },
    })(new AbortController().signal, () => {})
    assert.equal(passes, 1)
    assert.equal(searches, scenario === 'invalid' ? 0 : 1)
    assert.equal(result.content, scenario === 'error' ? 'answer\n\nBlad wykonania narzedzia: offline' : 'answer')
  }
})

test('Stop during search aborts the tool and prevents the follow-up and publication', async t => {
  const { store, request, readChat } = setup(t)
  const job = store.start('a', { ...request, webSearch: true }).job
  const runner = new GenerationRunner(store, () => assert.fail('cancelled job published'))
  let entered, passes = 0, toolSignal
  const started = new Promise(resolve => { entered = resolve })
  runner.start(job, () => assert.fail('plain path'), searchWorkflow({ messages: request.messages, enabled: () => true, showResults: true,
    open: async () => { passes++; return sse('Searching', [searchCall()]) },
    search: (_query, signal) => new Promise((_resolve, reject) => {
      toolSignal = signal; entered(); signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }),
  }))
  await started
  runner.cancel('a', job.id)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(toolSignal.aborted, true)
  assert.equal(passes, 1)
  assert.equal(store.get('a', job.id).status, 'cancelled')
  assert.equal(readChat().messages.length, 1)
})

test('search sources survive conflicts and restart; hidden sources are omitted from final variant', async t => {
  const { store, request, readChat, writeChat } = setup(t)
  const job = store.start('a', request).job
  store.update('a', job.id, 'running', 'partial', '')
  const tool = { type: 'websearch', label: 'question', results: searchResults }
  store.workflow('a', job.id, 'follow-up', tool)
  const chat = readChat(); chat.messages[0].variants[0].content = 'edited'; writeChat(chat)
  assert.equal(store.complete('a', job.id, 'answer', '', tool), false)
  assert.deepEqual(publicJob(store.get('a', job.id)).toolCall, tool)
  assert.equal(readChat().messages[0].variants[0].content, 'edited')
  const second = store.start('a', { ...request, id: 'second', expectedUpdatedAt: 21 }).job
  store.workflow('a', second.id, 'web-search', tool)
  store.recover()
  assert.equal(publicJob(store.get('a', second.id)).status, 'interrupted')
  assert.deepEqual(publicJob(store.get('a', second.id)).toolCall, tool)
  let passes = 0
  const result = await searchWorkflow({ messages: request.messages, enabled: () => true, showResults: false,
    open: async () => ++passes === 1 ? sse('', [searchCall()]) : sse('answer'), search: async () => searchResults,
  })(new AbortController().signal, () => {})
  assert.equal(result.content, 'answer')
  assert.equal(result.toolCall, undefined)
})

test('search parsing preserves result and infobox fallbacks and result limit', () => {
  assert.deepEqual(parseSearchResults({ results: [{ url: 'url', content: 'snippet', engine: 'engine' }, { title: 'excess' }] }, 1),
    [{ title: 'url', url: 'url', snippet: 'snippet', source: 'engine' }])
  assert.deepEqual(parseSearchResults({ infoboxes: [{ infobox: 'Title', id: 'url', content: 'Fact' }] }, 5),
    [{ title: 'Title', url: 'url', snippet: 'Fact', source: 'Infobox' }])
})

test('workflow migration preserves existing jobs and can be rerun', t => {
  const { sql, port, store, request } = setup(t)
  const job = store.start('a', request).job
  sql.exec('ALTER TABLE generation_jobs DROP COLUMN workflow_json')
  const migrated = new GenerationStore(port)
  assert.equal(migrated.get('a', job.id).request_json, job.request_json)
  assert.equal(migrated.get('a', job.id).workflow_json, '{}')
  new GenerationStore(port)
  assert.equal(migrated.get('a', job.id).status, 'queued')
})
