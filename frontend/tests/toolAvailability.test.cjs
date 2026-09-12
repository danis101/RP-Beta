const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

let OpenAIAdapter, buildToolDeclarations, getTool
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
  ;({ OpenAIAdapter, buildToolDeclarations, getTool } = compiled.exports)
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
