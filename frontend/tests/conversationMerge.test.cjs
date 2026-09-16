const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

// Compile the real modules with the project's TypeScript; no extra test dependency.
const output = mkdtempSync(path.join(tmpdir(), 'rp-merge-test-'))
after(() => rmSync(output, { recursive: true, force: true }))
writeFileSync(path.join(output, 'package.json'), '{"type":"commonjs"}')
execFileSync(process.execPath, [
  require.resolve('typescript/bin/tsc'),
  'src/lib/conversationMerge.ts', 'src/lib/messages.ts',
  '--module', 'commonjs', '--target', 'ES2020', '--strict', '--skipLibCheck',
  '--rootDir', '..', '--outDir', output,
], { cwd: path.join(__dirname, '..'), stdio: 'pipe' })
const { mergeConversations: merge } = require(path.join(output, 'frontend/src/lib/conversationMerge.js'))
const { updateMessage } = require(path.join(output, 'frontend/src/lib/messages.js'))

const message = (id, timestamp = 10, extra = {}) => ({
  id, role: 'assistant', variants: [{ content: id }], selectedVariant: 0, timestamp, ...extra,
})
const conversation = (messages = [], extra = {}) => ({
  id: 'conversation', characterId: 'character', messages, unread: 0,
  longTermMemory: [], lastSummarizedIndex: -1, ...extra,
})

test('keeps new messages from both devices, ordered by original creation time', () => {
  const local = conversation([message('shared'), message('local', 30)])
  const remote = conversation([message('remote', 20), message('shared')])
  assert.deepEqual(merge(local, remote).messages.map(m => m.id), ['shared', 'remote', 'local'])
})

test('newer edit wins from either device, without moving the message', () => {
  const old = message('shared')
  const edited = message('shared', 10, { _updatedAt: 40, variants: [{ content: 'edited' }] })
  for (const [local, remote] of [[old, edited], [edited, old]]) {
    assert.deepEqual(merge(conversation([local, message('later', 20)]), conversation([remote])).messages,
      [edited, message('later', 20)])
  }
})

test('independent edits to different messages survive one conflict', () => {
  const a = message('a', 10, { _updatedAt: 30 })
  const b = message('b', 20, { _updatedAt: 40 })
  assert.deepEqual(merge(conversation([a, message('b', 20)]), conversation([message('a'), b])).messages, [a, b])
})

test('legacy data uses creation time; equal versions prefer the server', () => {
  const local = message('a', 10, { variants: [{ content: 'local' }] })
  const remote = message('a', 10, { variants: [{ content: 'server' }] })
  assert.deepEqual(merge(conversation([local]), conversation([remote])).messages, [remote])
  assert.deepEqual(merge(conversation([{ ...local, _updatedAt: 11 }]), conversation([remote])).messages,
    [{ ...local, _updatedAt: 11 }])
  assert.deepEqual(merge(conversation([{ ...local, _updatedAt: 12 }]),
    conversation([{ ...remote, _updatedAt: 12 }])).messages, [{ ...remote, _updatedAt: 12 }])
})

test('deletion from either device wins even over a newer edit', () => {
  const deleted = conversation([], { _deletedMessageIds: ['a'] })
  const edited = conversation([message('a', 10, { _updatedAt: 1000 })])
  for (const [local, remote] of [[deleted, edited], [edited, deleted]]) {
    const result = merge(local, remote)
    assert.deepEqual(result.messages, [])
    assert.deepEqual(result._deletedMessageIds, ['a'])
  }
})

test('tombstones are retained, deduplicated and survive a later stale-device merge', () => {
  const result = merge(conversation([], { _deletedMessageIds: ['a', 'b'] }),
    conversation([], { _deletedMessageIds: ['b', 'c'] }))
  assert.deepEqual([...result._deletedMessageIds].sort(), ['a', 'b', 'c'])
  assert.deepEqual(merge(conversation([message('a'), message('b'), message('c')]), result).messages, [])
})

test('tombstone filters a message even when it exists in both snapshots', () => {
  const local = conversation([message('a')], { _deletedMessageIds: ['a'] })
  assert.deepEqual(merge(local, conversation([message('a')])).messages, [])
})

test('keeps winning variants, selected index, reasoning, attachments and image workflow metadata intact', () => {
  const edited = message('a', 10, {
    _updatedAt: 20, selectedVariant: 1,
    variants: [{ content: 'original' }, {
      content: '', thinking: 'reasoning', attachments: [{ type: 'image', blobId: 'attachment' }],
      toolCall: { type: 'image', status: 'done', prompt: 'exact refiner prompt', imageBlobId: 'image' },
    }],
  })
  assert.deepEqual(merge(conversation([edited]), conversation([message('a')])).messages, [edited])
})

test('keeps existing conversation settings and memory merge policy, and remote revision for retry', () => {
  const local = conversation([], { personaId: 'local', styleId: 'style', lorebookIds: ['lore'],
    longTermMemory: [{ id: 'memory', content: 'memory', timestamp: 1, messageIndex: 0 }], lastSummarizedIndex: 5 })
  const remote = conversation([], { personaId: 'remote', imageStyleId: 'image-style',
    _serverUpdatedAt: 100, _serverCreatedAt: 1, lastSummarizedIndex: 2 })
  const result = merge(local, remote)
  assert.equal(result.personaId, 'local')
  assert.equal(result.styleId, 'style')
  assert.deepEqual(result.lorebookIds, ['lore'])
  assert.equal(result.imageStyleId, 'image-style')
  assert.deepEqual(result.longTermMemory, local.longTermMemory)
  assert.equal(result.lastSummarizedIndex, 5)
  assert.equal(result._serverUpdatedAt, 100)
  assert.equal(result._serverCreatedAt, 1)
})

test('keeps one newest current memory block and collapses legacy history during a merge', () => {
  const local = conversation([], { longTermMemory: [
    { id: 'old', content: 'old state', timestamp: 1, messageIndex: 0 },
    { id: 'local', content: 'local state', timestamp: 20, messageIndex: 1 },
  ] })
  const remote = conversation([], { longTermMemory: [
    { id: 'remote', content: 'remote state', timestamp: 30, messageIndex: 2 },
  ] })
  assert.deepEqual(merge(local, remote).longTermMemory.map(entry => entry.content), ['remote state'])
  assert.deepEqual(merge(remote, local).longTermMemory.map(entry => entry.content), ['remote state'])
})

test('merge is repeatable and does not modify its inputs', () => {
  const local = conversation([message('a', 10, { _updatedAt: 30 })], { _deletedMessageIds: ['b'] })
  const remote = conversation([message('a'), message('b', 20)])
  const before = JSON.stringify([local, remote])
  const result = merge(local, remote)
  assert.equal(JSON.stringify([local, remote]), before)
  assert.deepEqual(merge(result, remote), result)
  assert.deepEqual(merge(result, result), result)
})

test('local message changes advance the version within one millisecond or after clock rollback', (t) => {
  t.mock.method(Date, 'now', () => 100)
  const old = message('a', 200)
  const first = updateMessage(old, { variants: [{ content: 'edit' }] })
  const second = updateMessage(first, { selectedVariant: 0 })
  assert.equal(first._updatedAt, 201)
  assert.equal(second._updatedAt, 202)
  assert.equal(second.timestamp, 200)
  assert.deepEqual(old, message('a', 200))
})
