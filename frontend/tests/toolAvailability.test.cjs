const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

let OpenAIAdapter, buildToolDeclarations, getTool, addInitialUserMessage, mergeInitialSystemMessages
before(async () => {
  // Vite compiles the real browser modules (including import.meta.env) for Node.
  // No files, model requests or application server are needed.
  const { build } = await import('vite')
  const bundle = await build({
    configFile: false, envFile: false, logLevel: 'silent',
    build: {
      ssr: path.join(__dirname, 'fixtures/toolAvailability.ts'),
      write: false, minify: false,
      rollupOptions: { output: { format: 'cjs' } },
    },
  })
  const compiled = new Module(__filename, module)
  compiled.paths = module.paths
  compiled._compile(bundle.output.find(item => item.type === 'chunk' && item.isEntry).code, __filename)
  ;({ OpenAIAdapter, buildToolDeclarations, getTool, addInitialUserMessage, mergeInitialSystemMessages } = compiled.exports)
})

for (const [webSearchEnabled, imageGenEnabled, names] of [
  [false, false, []],
  [true, false, ['web_search']],
  [false, true, ['generate_image']],
  [true, true, ['web_search', 'generate_image']],
]) {
  for (const streaming of [false, true]) {
    test(`request and execution permissions: search=${webSearchEnabled}, image=${imageGenEnabled}, streaming=${streaming}`, async (t) => {
      const settings = { webSearchEnabled, imageGenEnabled }
      const tools = buildToolDeclarations(settings)
      assert.deepEqual(tools.map(tool => tool.function.name), names)
      for (const name of ['web_search', 'generate_image']) {
        assert.equal(Boolean(getTool(name, settings)), names.includes(name))
      }
      const requests = []
      t.mock.method(globalThis, 'fetch', async (_url, init) => {
        requests.push(JSON.parse(init.body))
        return streaming
          ? new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')
          : Response.json({ choices: [{ message: { content: 'ok' } }] })
      })
      const adapter = new OpenAIAdapter({ baseUrl: 'http://model.test', apiKey: '', model: 'local-model' })
      const params = { messages: [{ role: 'user', content: 'test' }], tools }
      if (streaming) {
        let result = ''
        let done = false
        await adapter.streamMessage(params, {
          onToken: token => { result += token }, onDone: () => { done = true },
          onError: error => { throw error },
        })
        assert.equal(result, 'ok')
        assert.equal(done, true)
      } else {
        assert.equal(await adapter.sendMessage(params), 'ok')
      }
      assert.equal(requests.length, 1)
      assert.deepEqual(requests[0].messages, params.messages)
      if (names.length) {
        assert.deepEqual(requests[0].tools, tools)
        assert.equal(requests[0].tool_choice, 'auto')
      } else {
        assert.equal('tools' in requests[0], false)
        assert.equal('tool_choice' in requests[0], false)
      }
    })
  }
}

test('text-only calls (refiner/summary) omit tools by default', async (t) => {
  let body
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    body = JSON.parse(init.body)
    return Response.json({ choices: [{ message: { content: 'refined prompt' } }] })
  })
  const adapter = new OpenAIAdapter({ baseUrl: 'http://model.test', apiKey: '', model: 'refiner' })
  assert.equal(await adapter.sendMessage({ messages: [{ role: 'user', content: 'scene' }] }), 'refined prompt')
  assert.equal('tools' in body, false)
  assert.equal('tool_choice' in body, false)
})

test('initial user compatibility preserves greeting and history, and is idempotent', () => {
  const messages = [
    { role: 'system', content: 'Character description' },
    { role: 'assistant', content: 'Hello!' },
    { role: 'user', content: 'test' },
    { role: 'assistant', content: 'reply' },
    { role: 'user', content: 'now?' },
  ]
  const snapshot = structuredClone(messages)
  for (const enabled of [undefined, false]) {
    assert.equal(addInitialUserMessage(messages, enabled, 'Alice'), messages)
  }
  const prepared = addInitialUserMessage(messages, true, 'Alice')
  assert.deepEqual(prepared, [messages[0], { role: 'user', content: 'Start new chat as Alice.' }, ...messages.slice(1)])
  assert.deepEqual(messages, snapshot)
  assert.equal(addInitialUserMessage(prepared, true, 'Alice'), prepared)
})

test('initial user compatibility leaves user-first, empty and tool-first histories unchanged', () => {
  for (const messages of [
    [], [{ role: 'system', content: 'prompt' }],
    [{ role: 'user', content: 'hello' }],
    [{ role: 'system', content: 'prompt' }, { role: 'user', content: 'hello' }],
    [{ role: 'assistant', content: '', tool_calls: [{ id: 'call', type: 'function', function: { name: 'web_search', arguments: '{}' } }] }],
    [{ role: 'tool', tool_call_id: 'call', content: 'result' }],
  ]) {
    assert.equal(addInitialUserMessage(messages, true, 'Alice'), messages)
  }
  assert.deepEqual(addInitialUserMessage([{ role: 'assistant', content: 'Hello' }], true, 'Alice'), [
    { role: 'user', content: 'Start new chat as Alice.' }, { role: 'assistant', content: 'Hello' },
  ])
})

for (const streaming of [false, true]) {
  test(`compatible greeting reaches API with tools intact (streaming=${streaming})`, async (t) => {
    let body
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      body = JSON.parse(init.body)
      return streaming ? new Response('data: [DONE]\n\n') : Response.json({ choices: [{ message: { content: 'ok' } }] })
    })
    const tools = buildToolDeclarations({ imageGenEnabled: true, webSearchEnabled: true })
    const toolCall = { id: 'call', type: 'function', function: { name: 'web_search', arguments: '{"query":"test"}' } }
    const history = [
      { role: 'system', content: 'lore' }, { role: 'system', content: 'prompt' }, { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'search' },
    ]
    const followUp = [
      { role: 'assistant', content: '', tool_calls: [toolCall] },
      { role: 'tool', tool_call_id: 'call', content: 'result' },
    ]
    const params = { messages: [...addInitialUserMessage(mergeInitialSystemMessages(history, true), true, 'Alice'), ...followUp], tools }
    const adapter = new OpenAIAdapter({ baseUrl: 'http://model.test', apiKey: '', model: 'local-model' })
    if (streaming) {
      await adapter.streamMessage(params, { onToken() {}, onDone() {}, onError(error) { throw error } })
    } else {
      await adapter.sendMessage(params)
    }
    assert.deepEqual(body.messages.map(message => message.role), ['system', 'user', 'assistant', 'user', 'assistant', 'tool'])
    assert.deepEqual(body.messages.slice(-2), followUp)
    assert.equal(body.messages[0].content, 'lore\n\nprompt')
    assert.deepEqual(body.tools, tools)
  })
}

test('system merge preserves exact block content and ordering without moving later instructions', () => {
  const messages = [
    { role: 'system', content: '  Lore A\n' }, { role: 'system', content: 'Lore B' },
    { role: 'system', content: 'Character prompt' }, { role: 'assistant', content: 'Greeting' },
    { role: 'user', content: 'Question' }, { role: 'system', content: 'Depth injection' },
  ]
  const snapshot = structuredClone(messages)
  for (const enabled of [false, undefined]) assert.equal(mergeInitialSystemMessages(messages, enabled), messages)
  const merged = mergeInitialSystemMessages(messages, true)
  assert.deepEqual(merged, [{ role: 'system', content: '  Lore A\n\n\nLore B\n\nCharacter prompt' }, ...messages.slice(3)])
  assert.deepEqual(messages, snapshot)
  assert.equal(mergeInitialSystemMessages(merged, true), merged)
  for (const input of [[], [{ role: 'user', content: 'Hi' }], [{ role: 'system', content: 'One' }]]) {
    assert.equal(mergeInitialSystemMessages(input, true), input)
  }
})

for (const wire of [
  'data: {"error":{"message":"roles must alternate"}}\n\ndata: [DONE]\n\n',
  'event: error\r\ndata: {"message":"roles must alternate"}\r\n\r\n',
  'data: {"error":"roles must alternate"}',
  '{"error":{"message":"roles must alternate"}}',
]) {
  test(`stream surfaces engine errors without completing a blank reply: ${wire.slice(0, 30)}`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(wire))
    const adapter = new OpenAIAdapter({ baseUrl: 'http://model.test', apiKey: '', model: 'local-model' })
    const errors = []
    let done = 0
    let tokens = ''
    await adapter.streamMessage({ messages: [{ role: 'user', content: 'test' }] }, {
      onToken: token => { tokens += token }, onDone: () => { done++ }, onError: error => errors.push(error),
    })
    assert.equal(done, 0)
    assert.equal(tokens, '')
    assert.equal(errors.length, 1)
    assert.match(errors[0].message, /roles must alternate/)
  })
}

test('stream handles fragmented CRLF events, reasoning, tools and final unterminated event', async (t) => {
  const wire = ': heartbeat\r\n\r\n' + [
    { choices: [{ delta: { reasoning_content: 'Thinking' } }] },
    { choices: [{ delta: { content: 'Cześć' } }] },
    { choices: [{ delta: { tool_calls: [{ id: 'call', function: { name: 'web_search', arguments: '{"query":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ function: { arguments: '"test"}' } }] } }] },
  ].map(event => `event: message\r\ndata: ${JSON.stringify(event)}`).join('\r\n\r\n')
  const bytes = new TextEncoder().encode(wire)
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({
    start(controller) {
      // Byte boundaries include UTF-8 characters and the CRLF event separator.
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
      controller.close()
    },
  })))
  const adapter = new OpenAIAdapter({ baseUrl: 'http://model.test', apiKey: '', model: 'local-model' })
  let content = '', thinking = '', calls, done = 0
  await adapter.streamMessage({ messages: [{ role: 'user', content: 'test' }] }, {
    onToken: token => { content += token }, onThinking: token => { thinking += token },
    onToolCalls: value => { calls = value }, onDone: () => { done++ }, onError: error => { throw error },
  })
  assert.equal(content, 'Cześć')
  assert.equal(thinking, 'Thinking')
  assert.equal(done, 1)
  assert.equal(calls[0].function.arguments, '{"query":"test"}')
})

test('execution lookup rejects unknown tools and rechecks toggles after declaration', () => {
  const settings = { webSearchEnabled: true, imageGenEnabled: true }
  const tools = buildToolDeclarations(settings)
  assert.equal(tools.length, 2)
  settings.imageGenEnabled = false
  assert.equal(getTool('generate_image', settings), undefined)
  assert.equal(getTool('web_search', settings).name, 'web_search')
  for (const name of ['unknown', 'constructor', '__proto__', 'toString']) {
    assert.equal(getTool(name, settings), undefined)
  }
})
