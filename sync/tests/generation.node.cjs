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
  'sync/src/generation/store.ts', 'sync/src/generation/runner.ts',
  '--module', 'commonjs', '--target', 'ES2022', '--lib', 'ES2022,DOM', '--strict', '--skipLibCheck', '--rootDir', '.', '--outDir', output,
], { cwd: path.join(__dirname, '../..'), stdio: 'pipe' })
const { GenerationStore } = require(path.join(output, 'sync/src/generation/store.js'))
const { GenerationRunner } = require(path.join(output, 'sync/src/generation/runner.js'))

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
  return { sql, store, request, readChat, writeChat }
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
