const { test, before } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')

let OpenAIAdapter, ReasoningParser
before(async () => {
  const { build } = await import('vite')
  const bundle = await build({
    configFile: false, envFile: false, logLevel: 'silent',
    build: {
      ssr: path.join(__dirname, 'fixtures/reasoning.ts'), write: false, minify: false,
      rollupOptions: { output: { format: 'cjs' } },
    },
  })
  const compiled = new Module(__filename, module)
  compiled.paths = module.paths
  compiled._compile(bundle.output.find(item => item.type === 'chunk' && item.isEntry).code, __filename)
  ;({ OpenAIAdapter, ReasoningParser } = compiled.exports)
})

for (const [input, expectedContent, expectedThinking] of [
  ['[THINK]Draft İ Ł[/THINK]Answer', 'Answer', 'Draft İ Ł'],
  ['<think>Draft</think>Answer', 'Answer', 'Draft'],
  [' \n<THINK>First</THINK>[THINK]Second[/THINK]Answer', 'Answer', 'FirstSecond'],
  ['[THINK]unfinished', '', 'unfinished'],
  ['<think>unfinished</thi', '', 'unfinished</thi'],
  ['Plain answer', 'Plain answer', ''],
  ['Here is <think>an example</think>.', 'Here is <think>an example</think>.', ''],
  ['`[THINK]example[/THINK]`', '`[THINK]example[/THINK]`', ''],
  ['<div>HTML</div>', '<div>HTML</div>', ''],
  ['[THI', '[THI', ''],
]) {
  test(`reasoning split is independent of chunk boundaries: ${input}`, () => {
    for (let split = 0; split <= input.length; split++) {
      let content = '', thinking = ''
      const parser = new ReasoningParser(text => { content += text }, text => { thinking += text })
      parser.push(input.slice(0, split))
      parser.push(input.slice(split))
      parser.finish()
      assert.equal(content, expectedContent)
      assert.equal(thinking, expectedThinking)
    }
  })
}

const config = { baseUrl: 'http://model.test', apiKey: '', model: 'local-model' }
const params = { messages: [{ role: 'user', content: 'hello' }] }
for (const streaming of [false, true]) {
  for (const message of [
    { content: '[THINK]Draft[/THINK]Answer' },
    { content: '<think>Draft</think>Answer' },
    { content: 'Answer', reasoning_content: 'Draft' },
    { content: 'Answer', reasoning: 'Draft' },
    { content: 'Answer', thinking: 'Draft' },
    { content: 'Answer', reasoning_content: '', reasoning: 'Draft' },
  ]) {
    test(`adapter preserves separate thinking (stream=${streaming}): ${JSON.stringify(message)}`, async t => {
      t.mock.method(globalThis, 'fetch', async () => {
        if (!streaming) return Response.json({ choices: [{ message }] })
        const chunks = []
        for (const [field, value] of Object.entries(message)) {
          for (const character of value) chunks.push(`data: ${JSON.stringify({ choices: [{ delta: { [field]: character } }] })}\n\n`)
        }
        return new Response(chunks.join('') + 'data: [DONE]\n\n')
      })
      const adapter = new OpenAIAdapter(config)
      let content = '', thinking = '', done = 0
      if (streaming) {
        await adapter.streamMessage(params, {
          onToken: text => { content += text }, onThinking: text => { thinking += text },
          onDone: () => { done++ }, onError: error => { throw error },
        })
        assert.equal(done, 1)
      } else {
        content = await adapter.sendMessage({ ...params, onThinking: text => { thinking += text } })
      }
      assert.equal(content, 'Answer')
      assert.equal(thinking, 'Draft')
    })
  }
}

test('nonstream chat retains reasoning-only output separately; refiner keeps its text fallback', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: { content: '[THINK]Draft[/THINK]' } }] }))
  const adapter = new OpenAIAdapter(config)
  let thinking = ''
  assert.equal(await adapter.sendMessage({ ...params, onThinking: text => { thinking += text } }), '')
  assert.equal(thinking, 'Draft')
  assert.equal(await adapter.sendMessage(params), 'Draft')
})

test('nonstream tool calls retain their arguments and reasoning', async t => {
  const calls = [{ id: 'call', type: 'function', function: { name: 'generate_image', arguments: '{"description":"scene"}' } }]
  t.mock.method(globalThis, 'fetch', async () => Response.json({ choices: [{ message: {
    content: '[THINK]Draft[/THINK]', tool_calls: calls,
  } }] }))
  let thinking = ''
  const result = await new OpenAIAdapter(config).sendMessage({ ...params, onThinking: text => { thinking += text } })
  assert.deepEqual(JSON.parse(result), { content: '', tool_calls: calls })
  assert.equal(thinking, 'Draft')
})
