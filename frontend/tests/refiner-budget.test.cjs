const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function load(file) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8').replaceAll('import.meta.env.DEV', 'false'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, console,
    require: name => load(path.resolve(path.dirname(file), name + '.ts')) })
  return module.exports
}
const { buildImageRefinerMessages, refineImagePrompt } = load(path.join(__dirname, '../src/lib/refiner.ts'))
const { assertRefinerBudget } = load(path.join(__dirname, '../../shared/llm/refinerBudget.ts'))
const history = Array.from({ length: 6 }, (_, i) => ({ id: String(i), role: i % 2 ? 'assistant' : 'user',
  selectedVariant: 0, variants: [{ content: `TURN${i} ` + 'opis '.repeat(400) + ` END${i}` }] }))
const ctx = { character: { name: 'Character', description: 'card '.repeat(1100) },
  persona: { name: 'User', description: 'persona '.repeat(600) }, history, contextMessages: 6,
  contextLength: 32768, maxTokens: 2048, imageStyleDirective: 'watercolor' }

test('large profile preserves full card, persona and all six long turns in original order', () => {
  const [req] = buildImageRefinerMessages(ctx, 'system instruction')
  assert.equal(req.system, 'system instruction')
  assert.ok(req.user.includes(ctx.character.description.trim()))
  assert.ok(req.user.includes(ctx.persona.description.trim()))
  let position = -1
  history.forEach(m => {
    const next = req.user.indexOf(m.variants[0].content)
    assert.ok(next > position); position = next
  })
  assert.ok(req.user.includes('[STYLE: watercolor]'))
  assertRefinerBudget(req.system + req.user, ctx.contextLength, ctx.maxTokens)
})

test('small profile removes oldest whole turns while retaining newest user and AI in order', () => {
  const [req] = buildImageRefinerMessages({ ...ctx, character: { name: 'Character' }, persona: { name: 'User' },
    contextLength: 2600, maxTokens: 512 }, 'system')
  assert.ok(!req.user.includes('TURN0'))
  assert.ok(req.user.includes(history[4].variants[0].content))
  assert.ok(req.user.includes(history[5].variants[0].content))
  assert.ok(req.user.indexOf('TURN4') < req.user.indexOf('TURN5'))
  assertRefinerBudget(req.system + req.user, 2600, 512)
})

test('oversize snapshot does not block chat preparation but refuses refiner call without cutting latest turn', async () => {
  const small = { ...ctx, contextLength: 512 }
  const [req] = buildImageRefinerMessages(small, 'system')
  assert.ok(req.user.includes(history[5].variants[0].content))
  assert.throws(() => assertRefinerBudget(req.system + req.user, 512, 2048), /Refiner/)
  await assert.rejects(refineImagePrompt(small, 'system', { sendMessage: () => assert.fail('must not call model') }), /Refiner/)
})

test('output reservation and invalid limits count against input budget', () => {
  assert.doesNotThrow(() => assertRefinerBudget('x'.repeat(3000), 2048, 512))
  assert.throws(() => assertRefinerBudget('x'.repeat(3000), 2048, 1500), /Refiner/)
  for (const limit of [0, -1, NaN, Infinity]) assert.throws(() => assertRefinerBudget('hello', limit, 512), /Refiner/)
})
