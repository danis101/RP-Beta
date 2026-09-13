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
  'sync/src/generation/store.ts', 'sync/src/generation/runner.ts', 'sync/src/generation/searchWorkflow.ts', 'sync/src/generation/imageWorkflow.ts', 'sync/src/generation/summaryPlan.ts',
  '--module', 'commonjs', '--target', 'ES2022', '--lib', 'ES2022,DOM', '--strict', '--skipLibCheck', '--rootDir', '.', '--outDir', output,
], { cwd: path.join(__dirname, '../..'), stdio: 'pipe' })
const { GenerationStore } = require(path.join(output, 'sync/src/generation/store.js'))
const { GenerationRunner } = require(path.join(output, 'sync/src/generation/runner.js'))
const { publicJob } = require(path.join(output, 'sync/src/generation/store.js'))
const { searchWorkflow } = require(path.join(output, 'sync/src/generation/searchWorkflow.js'))
const { parseSearchResults, searchFollowUp } = require(path.join(output, 'shared/llm/webSearch.js'))
const { runImage } = require(path.join(output, 'sync/src/generation/imageWorkflow.js'))
const { createImageGenerator } = require(path.join(output, 'shared/llm/imageGen.js'))
const { prepareSummary } = require(path.join(output, 'sync/src/generation/summaryPlan.js'))
const { resolveModelImages, validModelMessage } = require(path.join(output, 'shared/llm/messages.js'))

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

test('image pipeline checkpoints exact refined prompt before generation and saves before publishing', async t => {
  const { store, request, readChat } = setup(t)
  const job = store.start('a', { ...request, operation: 'image', image: {} }).job
  let published
  const done = new Promise(resolve => { published = resolve })
  const runner = new GenerationRunner(store, published)
  const events = []
  runner.start(job, () => assert.fail('no chat model for manual image'), async (signal, report) => ({
    content: '', thinking: '', phase: 'image-result', toolCall: await runImage({
      refine: async () => { events.push('refine'); return ' [STYLE: original] exact prompt ' },
      generate: async prompt => {
        events.push('generate')
        assert.equal(prompt, '[STYLE: original] exact prompt')
        assert.equal(publicJob(store.get('a', job.id)).toolCall.prompt, prompt)
        assert.equal(readChat().messages.length, 1)
        return { status: 'done', blob: new Blob(['image'], { type: 'image/png' }) }
      },
      save: async () => { events.push('save'); assert.equal(readChat().messages.length, 1); return 'blob-id' },
    }, signal, report),
  }))
  await done
  assert.deepEqual(events, ['refine', 'generate', 'save'])
  assert.equal(readChat().messages[1].variants[0].toolCall.imageBlobId, 'blob-id')
  assert.equal(readChat().messages[1].variants[0].content, '')
  await new Promise(resolve => setImmediate(resolve))
})

test('image regeneration verifies saved prompt, bypasses refiner and adds one variant', async t => {
  const { store, request, readChat, writeChat } = setup(t)
  const chat = readChat()
  chat.messages.push({ id: 'image', role: 'assistant', variants: [{ content: '', toolCall: { type: 'image', status: 'done', prompt: ' exact saved prompt ', imageBlobId: 'old' } }], selectedVariant: 0, timestamp: 15 })
  writeChat(chat)
  const regen = { ...request, operation: 'image', mode: 'regenerate', targetMessageId: 'image', expectedUpdatedAt: 21, image: { prompt: 'forged' } }
  assert.throws(() => store.start('a', regen), /Prompt regeneracji/)
  regen.image.prompt = ' exact saved prompt '
  store.start('a', regen); store.update('a', regen.id, 'running', '', '')
  const tool = await runImage({
    refine: () => assert.fail('regeneration must not refine'),
    generate: async prompt => { assert.equal(prompt, regen.image.prompt); return { status: 'done', blob: new Blob(['new']) } },
    save: async () => 'new-blob',
  }, new AbortController().signal, () => {}, regen.image.prompt)
  assert.equal(store.complete('a', regen.id, '', '', tool), true)
  assert.equal(readChat().messages[1].variants.length, 2)
  assert.equal(readChat().messages[1].variants[0].toolCall.imageBlobId, 'old')
  assert.equal(readChat().messages[1].variants[1].toolCall.imageBlobId, 'new-blob')
})

test('manual image accepts an assistant anchor or an empty conversation and detects concurrent additions', t => {
  const { store, request, readChat, writeChat } = setup(t)
  const chat = readChat(); chat.messages = []; writeChat(chat)
  const input = { ...request, operation: 'image', targetMessageId: 'chat', expectedUpdatedAt: 21, image: {} }
  store.start('a', input); store.update('a', input.id, 'running', '', '')
  assert.equal(store.complete('a', input.id, '', '', { type: 'image', status: 'done', label: 'image', imageBlobId: 'blob' }), true)
  const anchor = readChat().messages[0]
  store.start('a', { ...input, id: 'second', targetMessageId: anchor.id, expectedUpdatedAt: anchor._updatedAt })
  store.update('a', 'second', 'running', '', '')
  const changed = readChat(); changed.messages.push({ id: 'new', role: 'user', variants: [{ content: 'new' }] }); writeChat(changed)
  assert.equal(store.complete('a', 'second', '', '', { type: 'image', status: 'done', label: 'image', imageBlobId: 'second' }), false)
  assert.equal(store.get('a', 'second').status, 'conflict')
})

test('image cancellation after refiner never starts generator; processing never submits a duplicate', async () => {
  const controller = new AbortController()
  await assert.rejects(runImage({ refine: async () => { controller.abort(); return 'prompt' }, generate: () => assert.fail('cancelled'), save: () => assert.fail('cancelled') }, controller.signal, () => {}))
  let calls = 0, checkpoint
  await assert.rejects(runImage({ refine: async () => 'prompt', generate: async () => { calls++; return { status: 'processing' } }, save: () => assert.fail('no image') },
    new AbortController().signal, state => { checkpoint = state }), /processing/)
  assert.equal(calls, 1)
  assert.equal(checkpoint.toolCall.prompt, 'prompt')
})

test('shared image transport preserves bridge POST and handles URL and base64 responses', async () => {
  for (const format of ['url', 'b64_json']) {
    const requests = []
    const generate = createImageGenerator(() => null, async (url, init) => {
      requests.push({ url, init })
      return init?.method === 'POST' ? Response.json({ data: [format === 'url' ? { url: 'http://bridge.test/cdn/picture.png' } : { b64_json: btoa('image') }] })
        : new Response('image', { headers: { 'Content-Type': 'image/png' } })
    })
    const result = await generate('[STYLE: original] prompt', { baseUrl: 'http://bridge.test', responseFormat: format })
    assert.equal(result.status, 'done')
    assert.equal(await result.blob.text(), 'image')
    assert.deepEqual(JSON.parse(requests[0].init.body), { prompt: '[STYLE: original] prompt', n: 1, response_format: format })
    assert.equal(requests.length, format === 'url' ? 2 : 1)
    if (format === 'url') assert.equal(requests[1].url, '/images-proxy/cdn/picture.png')
  }
})

test('chat image tool runs once, preserves model text, and respects the image toggle', async () => {
  for (const enabled of [true, false]) {
    let calls = 0
    const result = await searchWorkflow({ messages: [{ role: 'user', content: 'draw' }], enabled: () => false, showResults: true,
      imageEnabled: () => enabled,
      image: async (_signal, progress) => { calls++; progress({ content: '', thinking: '', phase: 'refiner' }); return { type: 'image', label: 'image', status: 'done', imageBlobId: 'blob' } },
      open: async () => sse('Here is the scene.', [searchCall('generate_image')]), search: () => assert.fail('no search'),
    })(new AbortController().signal, () => {})
    assert.equal(calls, enabled ? 1 : 0)
    assert.equal(result.content, 'Here is the scene.')
    assert.equal(result.toolCall?.imageBlobId, enabled ? 'blob' : undefined)
  }
})

test('GC protects a conflict image for its owner, but not another user or a deleted chat', async t => {
  const { sql, port, store, request } = setup(t)
  sql.exec('ALTER TABLE entities ADD COLUMN blob_id TEXT; CREATE TABLE blobs(user_id TEXT,sha256 TEXT,created_at INTEGER)')
  const hash = 'a'.repeat(64)
  sql.prepare('INSERT INTO blobs VALUES(?,?,0)').run('a', hash)
  sql.prepare('INSERT INTO blobs VALUES(?,?,0)').run('b', hash)
  const job = store.start('a', request).job
  store.workflow('a', job.id, 'image-result', { type: 'image', label: 'image', status: 'done', imageBlobId: hash })
  store.update('a', job.id, 'conflict', '', '')
  const ts = require('../../frontend/node_modules/typescript')
  const code = ts.transpileModule(require('node:fs').readFileSync(path.join(__dirname, '../src/gc.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  const module = { exports: {} }, deleted = []
  require('node:vm').runInNewContext(code, {
    exports: module.exports, module, console,
    require: name => name === './db' ? { db: port } : name === './blobs' ? { deleteBlob: async (user, id) => { deleted.push([user, id]) } } : { MIN_BLOB_AGE_MS: 1000, SOFT_DELETE_RETENTION_MS: 1000, GC_INTERVAL_MS: 1000 },
  })
  await module.exports.runGarbageCollection()
  assert.deepEqual(deleted, [['b', hash]])
  deleted.length = 0
  sql.prepare("UPDATE entities SET deleted_at=? WHERE user_id='a'").run(Date.now())
  await module.exports.runGarbageCollection()
  assert.ok(deleted.some(([user]) => user === 'a'))
})

test('historical user generation appends at the current end without removing intervening turns', t => {
  const { store, request, readChat, writeChat } = setup(t)
  const chat = readChat()
  chat.messages.push({ id: 'later-answer', role: 'assistant', variants: [{ content: 'keep this' }], selectedVariant: 0 })
  writeChat(chat)
  const input = { ...request, expectedUpdatedAt: 21, historyTailId: 'later-answer' }
  store.start('a', input); store.update('a', input.id, 'running', '', '')
  assert.equal(store.complete('a', input.id, 'new answer from old user', ''), true)
  assert.deepEqual(readChat().messages.map(m => m.variants[0].content), ['hello', 'keep this', 'new answer from old user'])
  const current = readChat()
  const second = { ...input, id: 'second', expectedUpdatedAt: current.messages[2]._updatedAt, historyTailId: current.messages[2].id }
  store.start('a', second); store.update('a', second.id, 'running', '', '')
  current.messages.push({ id: 'another-user', role: 'user', variants: [{ content: 'intervening edit' }] }); writeChat(current)
  assert.equal(store.complete('a', second.id, 'conflicting answer', ''), false)
  assert.equal(readChat().messages.length, 4)
})

test('summary writes memory once and only advances to its actual captured boundary', t => {
  const { store, request, readChat, writeChat } = setup(t)
  const chat = readChat(); chat.lastSummarizedIndex = -1
  chat.messages.push({ id: 'answer', role: 'assistant', variants: [{ content: 'answer' }], selectedVariant: 0 })
  writeChat(chat)
  const input = { ...request, operation: 'summary', targetMessageId: 'answer', expectedUpdatedAt: 21 }
  store.start('a', input); store.update('a', input.id, 'running', '', '')
  const changed = readChat(); changed.messages.push({ id: 'new-user', role: 'user', variants: [{ content: 'new' }], selectedVariant: 0 }); writeChat(changed)
  assert.equal(store.complete('a', input.id, ' memory ', ''), true)
  assert.equal(store.complete('a', input.id, 'duplicate', ''), false)
  assert.equal(readChat().messages.length, 3)
  assert.equal(readChat().longTermMemory.length, 1)
  assert.equal(readChat().longTermMemory[0].content, 'memory')
  assert.equal(readChat().longTermMemory[0].messageIndex, 1)
  assert.equal(readChat().lastSummarizedIndex, 1)
})

test('summary conflicts preserve manual memory changes and edits to summarized messages', t => {
  for (const change of ['memory', 'message']) {
    const { store, request, readChat, writeChat } = setup(t)
    const input = { ...request, operation: 'summary' }
    store.start('a', input); store.update('a', input.id, 'running', '', '')
    const chat = readChat()
    if (change === 'memory') chat.longTermMemory.push({ id: 'manual', content: 'manual memory' })
    else chat.messages[0].variants[0].content = 'manual edit'
    writeChat(chat)
    assert.equal(store.complete('a', input.id, 'generated memory', ''), false)
    assert.equal(store.get('a', input.id).content, 'generated memory')
    assert.deepEqual(readChat(), chat)
  }
})

test('summary planning preserves threshold, message count, names, selected variants and existing memory', () => {
  const conversation = { lastSummarizedIndex: -1, messages: [
    { id: '1', role: 'user', variants: [{ content: 'first' }], selectedVariant: 0 },
    { id: '2', role: 'assistant', variants: [{ content: 'unused' }, { content: 'selected' }], selectedVariant: 1 },
  ], longTermMemory: [{ content: ' old memory ' }] }
  const settings = { summarizerEnabled: true, summarizerThreshold: 2, summarizerMessageCount: 1, summarizerPrompt: 'system unchanged' }
  const plan = prepareSummary(conversation, settings, { name: 'Character' }, { name: 'Persona' }, true)
  assert.equal(plan[0].content, 'system unchanged')
  assert.equal(plan[1].content, 'Aktualne podsumowanie:\nold memory\n\nOto nowe wiadomości:\n\nCharacter: selected\n\nZaktualizuj podsumowanie, uwzględniając nowe wydarzenia.')
  assert.equal(prepareSummary(conversation, { ...settings, summarizerEnabled: false }, { name: 'C' }, undefined, true), null)
  assert.equal(prepareSummary(conversation, { ...settings, summarizerThreshold: 3 }, { name: 'C' }, undefined, true), null)
  assert.ok(prepareSummary(conversation, { ...settings, summarizerEnabled: false }, { name: 'C' }, undefined, false))
})

test('vision resolves owned blobs without changing prompt ordering or original snapshot', async () => {
  const id = 'b'.repeat(64), calls = []
  const messages = [{ role: 'system', content: 'system\nlore' }, { role: 'user', content: [
    { type: 'text', text: 'before' }, { type: 'image_url', image_url: { url: `rp-blob:${id}` } },
    { type: 'text', text: 'after' }, { type: 'image_url', image_url: { url: `rp-blob:${id}` } },
  ] }]
  assert.ok(messages.every(validModelMessage))
  const output = await resolveModelImages(messages, async value => { calls.push(value); return 'data:image/png;base64,aW1n' })
  assert.deepEqual(calls, [id])
  assert.equal(output[0].content, messages[0].content)
  assert.equal(output[1].content[0].text, 'before')
  assert.equal(output[1].content[2].text, 'after')
  assert.equal(output[1].content[1].image_url.url, 'data:image/png;base64,aW1n')
  assert.equal(messages[1].content[1].image_url.url, `rp-blob:${id}`)
  await assert.rejects(resolveModelImages(messages, async () => { throw Error('not owned') }), /not owned/)
  assert.equal(validModelMessage({ role: 'user', content: [{ type: 'image_url', image_url: { url: 'http://arbitrary-server/image.png' } }] }), false)
  assert.equal(validModelMessage({ role: 'user', content: [{ type: 'image_url', image_url: { url: 'rp-blob:../other-user' } }] }), false)
})

test('summary has its own concurrency slot and does not block chat generation', t => {
  const { store, request } = setup(t)
  store.start('a', { ...request, id: 'summary', operation: 'summary' })
  assert.equal(store.start('a', request).created, true)
  assert.throws(() => store.start('a', { ...request, id: 'summary-duplicate', operation: 'summary' }), /aktywne/)
  assert.throws(() => store.start('a', { ...request, id: 'chat-duplicate' }), /aktywne/)
})

test('service launches automatic summary after publication without any browser callback', async t => {
  const { sql, port, request, readChat, writeChat } = setup(t)
  const chat = readChat(); chat.characterId = 'card'; chat.lastSummarizedIndex = -1; writeChat(chat)
  const put = (type, id, data) => sql.prepare('INSERT INTO entities VALUES(?,?,?,?,?,NULL)').run('a', type, id, JSON.stringify(data), 1)
  put('character', 'card', { id: 'card', name: 'Character' })
  put('settings', 'singleton', { summarizerEnabled: true, summarizerThreshold: 1, summarizerModel: 'summary-model', summarizerPrompt: 'summary system', aiProfiles: [{ id: 'model', model: 'chat-model', baseUrl: 'http://model.test', sampler: { temperature: 0.7 } }] })
  const ts = require('../../frontend/node_modules/typescript')
  const code = ts.transpileModule(require('node:fs').readFileSync(path.join(__dirname, '../src/generation/service.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }, payloads = [], events = []
  class PrivateRouter {
    use() {} post() {}
    request(_url, init) { payloads.push(JSON.parse(init.body)); return Promise.resolve(sse('updated memory')) }
  }
  require('node:vm').runInNewContext(code, {
    exports: module.exports, module, console, crypto: globalThis.crypto, Headers, AbortController, AbortSignal,
    require: name => {
      if (name === 'hono') return { Hono: PrivateRouter }
      if (name === '../db') return { db: port }
      if (name === '../ws') return { broadcast: (...args) => events.push(args) }
      if (name === '../proxy') return { makeProxyHandler: () => {} }
      if (name === '../blobs') return {}
      if (name === '../config') return { PROXY_TIMEOUT_POST_MS: 600000 }
      if (name.startsWith('.')) return require(path.resolve(output, 'sync/src/generation', name) + '.js')
      return require(name)
    },
  })
  const service = module.exports
  const job = service.generationStore.start('a', { ...request, expectedUpdatedAt: 21 }).job
  service.generationRunner.start(job, async () => sse('chat answer'))
  await new Promise(resolve => setImmediate(resolve))
  const saved = JSON.parse(sql.prepare("SELECT data_json FROM entities WHERE user_id='a' AND type='conversation'").get().data_json)
  assert.equal(saved.messages.length, 2)
  assert.equal(saved.longTermMemory[0].content, 'updated memory')
  assert.equal(saved.lastSummarizedIndex, 1)
  assert.equal(payloads.length, 1)
  assert.equal(payloads[0].model, 'summary-model')
  assert.equal(payloads[0].temperature, 0.7)
  assert.equal(payloads[0].tools, undefined)
  assert.match(payloads[0].messages[1].content, /Character: chat answer/)
  assert.equal(events.length, 2)
  assert.equal(service.generationStore.list('a', 'chat').filter(j => j.status === 'succeeded').length, 2)
})
