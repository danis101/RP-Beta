// Lokalny podglad prawdziwego builda z danymi w RAM. Bez bazy, Dockera i uslug AI.
// Uruchom: npm run build, potem node tests/mobile-preview.cjs. Login: test / test.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const dist = path.resolve(__dirname, '../dist')
const now = Date.now()
const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#354879"/><text x="40" y="240" fill="white" font-size="40">Obraz testowy</text></svg>').toString('base64')
const characters = Array.from({ length: 18 }, (_, i) => ({
  id: `character-${i}`, name: i === 0 ? 'Długa rozmowa testowa' : `Postać ${i + 1}`,
  status: 'online', role: 'Test układu', firstMes: 'Wiadomość powitalna',
  _serverCreatedAt: now, _serverUpdatedAt: now,
}))
const conversations = characters.map((character, i) => ({
  id: `conversation-${i}`, characterId: character.id, unread: 0,
  longTermMemory: [], lastSummarizedIndex: -1,
  messages: Array.from({ length: i === 0 ? 35 : 2 }, (_, j) => ({
    id: `message-${i}-${j}`, role: j % 2 ? 'user' : 'assistant', timestamp: now - (35 - j + i * 100) * 60000,
    variants: [{ content: `Wiadomość ${j + 1}. ` + 'To jest długa wiadomość do sprawdzania przewijania na małym ekranie. '.repeat(5),
      ...(j === 34 ? { attachments: [{ type: 'image', data: svg }] } : {}),
    }, { content: 'Drugi wariant odpowiedzi do sprawdzenia.' }], selectedVariant: 0,
  })), _serverCreatedAt: now, _serverUpdatedAt: now,
}))
const entities = { characters, conversations, personas: [{ id: 'persona', name: 'Tester' }], styles: [], lorebooks: [] }
let settings = {
  language: 'pl', defaultPersonaId: 'persona', activeAiProfileId: 'mock',
  aiProfiles: [{ id: 'mock', name: 'Test lokalny', baseUrl: '', apiKey: '', model: '', sampler: {}, streamingEnabled: true, visionEnabled: true }],
  imageGenEnabled: true, summarizerEnabled: false,
}
const user = { id: 'mobile-preview', username: 'test', isAdmin: true }
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const send = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }
  let body = ''
  for await (const chunk of req) body += chunk
  if (url.pathname === '/auth/login') return send({ token: 'local-preview-only', user })
  if (url.pathname === '/auth/me') return send(user)
  if (url.pathname === '/settings') {
    if (req.method === 'PUT') settings = JSON.parse(body)
    return send({ settings, updatedAt: now, ok: true })
  }
  const [, type, id] = url.pathname.split('/')
  if (entities[type]) {
    const list = entities[type]
    if (!id) return send({ items: list })
    const index = list.findIndex(item => item.id === id)
    if (req.method === 'PUT') {
      const saved = { ...JSON.parse(body), _serverUpdatedAt: Date.now() }
      if (index < 0) list.push(saved)
      else list[index] = saved
      return send(saved)
    }
    if (req.method === 'DELETE') { if (index >= 0) list.splice(index, 1); return send({ ok: true }) }
    return index < 0 ? send({ error: 'Not found' }, 404) : send(list[index])
  }
  if (url.pathname.startsWith('/llm-proxy') || url.pathname.startsWith('/images-proxy') || url.pathname.startsWith('/searxng-proxy')) return send({ error: 'Integracje zablokowane w podgladzie' }, 503)
  const file = path.resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : url.pathname))
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send({ error: 'Not found' }, 404)
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': mime })
  fs.createReadStream(file).pipe(res)
}).listen(5173, '127.0.0.1', () => console.log('Test UI: http://127.0.0.1:5173 (test / test)'))
