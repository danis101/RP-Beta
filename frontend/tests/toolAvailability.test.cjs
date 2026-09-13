const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

let OpenAIAdapter, buildToolDeclarations, getTool, prepareChatMessages
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
  ;({ OpenAIAdapter, buildToolDeclarations, getTool, prepareChatMessages } = compiled.exports)
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
  const prepared = prepareChatMessages(messages, 'Alice')
  assert.deepEqual(prepared, [messages[0], { role: 'user', content: 'Start new chat as Alice.' }, ...messages.slice(1)])
  assert.deepEqual(messages, snapshot)
  assert.deepEqual(prepareChatMessages(prepared, 'Alice'), prepared)
})

test('user-first histories are preserved; initial greeting regeneration gets a user turn', () => {
  for (const messages of [
    [{ role: 'user', content: 'hello' }],
    [{ role: 'system', content: 'prompt' }, { role: 'user', content: 'hello' }],
  ]) {
    assert.deepEqual(prepareChatMessages(messages, 'Alice'), messages)
  }
  assert.deepEqual(prepareChatMessages([{ role: 'assistant', content: 'Hello' }], 'Alice'), [
    { role: 'user', content: 'Start new chat as Alice.' }, { role: 'assistant', content: 'Hello' },
  ])
  for (const messages of [[], [{ role: 'system', content: 'prompt' }]]) {
    assert.deepEqual(prepareChatMessages(messages, 'Alice'), [...messages, { role: 'user', content: 'Start new chat as Alice.' }])
  }
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
    const params = { messages: prepareChatMessages([...history, ...followUp], 'Alice'), tools }
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

test('normalization preserves block text and ordering; later system stays in the same user turn', () => {
  const messages = [
    { role: 'system', content: '  Lore A\n' }, { role: 'system', content: 'Lore B' },
    { role: 'system', content: 'Character prompt' }, { role: 'assistant', content: 'Greeting' },
    { role: 'user', content: 'Question' }, { role: 'system', content: 'Depth injection' },
  ]
  const snapshot = structuredClone(messages)
  const merged = prepareChatMessages(messages, 'Alice')
  assert.deepEqual(merged, [
    { role: 'system', content: '  Lore A\n\n\nLore B\n\nCharacter prompt' },
    { role: 'user', content: 'Start new chat as Alice.' },
    messages[3], { role: 'user', content: 'Question\n\nDepth injection' },
  ])
  assert.deepEqual(messages, snapshot)
  assert.deepEqual(prepareChatMessages(merged, 'Alice'), merged)
})

test('logged RP pattern becomes alternating turns with no late system or missing blocks', () => {
  const messages = [
    { role: 'system', content: 'lore A' }, { role: 'system', content: 'character' },
    { role: 'assistant', content: 'greeting' }, { role: 'user', content: 'question' },
    { role: 'assistant', content: 'answer' }, { role: 'user', content: 'next question' },
    { role: 'system', content: 'style A' }, { role: 'system', content: 'anatomy' },
    { role: 'user', content: 'persona' }, { role: 'user', content: 'card details' },
    { role: 'system', content: 'character rule' }, { role: 'user', content: 'history marker' },
    { role: 'system', content: 'current time' }, { role: 'system', content: 'image instructions' },
  ]
  const prepared = prepareChatMessages(messages, 'Alice')
  assert.deepEqual(prepared.map(message => message.role), ['system', 'user', 'assistant', 'user', 'assistant', 'user'])
  assert.equal(prepared[5].content, messages.slice(5).map(message => message.content).join('\n\n'))
  assert.equal(prepared[0].content, 'lore A\n\ncharacter')
})

test('injections between older turns stay there; adjacent assistant and user text is retained', () => {
  const prepared = prepareChatMessages([
    { role: 'user', content: 'one' }, { role: 'user', content: 'two' },
    { role: 'assistant', content: 'reply' }, { role: 'assistant', content: 'continuation' },
    { role: 'system', content: 'depth instruction' }, { role: 'user', content: 'three' },
    { role: 'assistant', content: 'later reply' }, { role: 'user', content: 'latest' },
  ], 'Alice')
  assert.deepEqual(prepared, [
    { role: 'user', content: 'one\n\ntwo' }, { role: 'assistant', content: 'reply\n\ncontinuation' },
    { role: 'user', content: 'depth instruction\n\nthree' }, { role: 'assistant', content: 'later reply' },
    { role: 'user', content: 'latest' },
  ])
})

test('vision attachments survive instructions before and after a multimodal user message', () => {
  const imageA = { type: 'image_url', image_url: { url: 'data:image/png;base64,AA', detail: 'high' } }
  const imageB = { type: 'image_url', image_url: { url: 'data:image/png;base64,BB' } }
  const messages = [
    { role: 'user', content: 'before' },
    { role: 'user', content: [{ type: 'text', text: 'look' }, imageA, imageB] },
    { role: 'system', content: 'after' },
  ]
  const snapshot = structuredClone(messages)
  const prepared = prepareChatMessages(messages, 'Alice')
  assert.equal(prepared.length, 1)
  assert.equal(prepared[0].role, 'user')
  assert.deepEqual(prepared[0].content, [
    { type: 'text', text: 'before' }, { type: 'text', text: '\n\n' },
    { type: 'text', text: 'look' }, imageA, imageB,
    { type: 'text', text: '\n\n' }, { type: 'text', text: 'after' },
  ])
  assert.deepEqual(messages, snapshot)
  assert.deepEqual(prepareChatMessages(prepared, 'Alice'), prepared)
})

test('multiple tool calls, separate results and tool-only assistant content remain intact', () => {
  const call = id => ({ id, type: 'function', function: { name: 'web_search', arguments: '{"query":"test"}' } })
  const messages = [
    { role: 'system', content: 'prompt' }, { role: 'user', content: 'search' },
    { role: 'assistant', content: null, tool_calls: [call('a'), call('b')] },
    { role: 'tool', tool_call_id: 'a', content: 'first' }, { role: 'tool', tool_call_id: 'b', content: 'second' },
    { role: 'assistant', content: 'more', tool_calls: [call('c')] },
    { role: 'tool', tool_call_id: 'c', content: 'third' }, { role: 'assistant', content: 'answer' },
    { role: 'user', content: 'next' },
  ]
  assert.deepEqual(prepareChatMessages(messages, 'Alice'), messages)
})

test('web search follow-up instructions are normalized after appending, without dropping results', () => {
  const messages = [
    { role: 'system', content: 'character' }, { role: 'user', content: 'search please' },
    { role: 'system', content: '[Search results]\n1. Result\nSource: https://example.test' },
  ]
  assert.deepEqual(prepareChatMessages(messages, 'Alice'), [
    messages[0], { role: 'user', content: `${messages[1].content}\n\n${messages[2].content}` },
  ])
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
