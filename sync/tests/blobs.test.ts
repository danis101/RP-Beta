import { afterAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdir, readFile, readdir, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Import aplikacji dopiero po ustawieniu izolowanego katalogu testowego.
const testRoot = mkdtempSync(join(tmpdir(), 'rp-blob-test-'))
const previousDataDir = process.env.DATA_DIR
process.env.DATA_DIR = testRoot
const { db, blobPath } = await import('../src/db')
const { saveBlob, findBlob } = await import('../src/blobs')

afterAll(() => {
  db.close()
  if (previousDataDir === undefined) delete process.env.DATA_DIR
  else process.env.DATA_DIR = previousDataDir
  if (resolve(testRoot).startsWith(resolve(tmpdir()) + '/rp-blob-test-') ||
      resolve(testRoot).startsWith(resolve(tmpdir()) + '\\rp-blob-test-')) {
    rmSync(testRoot, { recursive: true, force: true })
  }
})

test('32 rownolegle uploady: jeden rekord, identyczne metadane i kompletny plik', async () => {
  const bytes = new Uint8Array(512 * 1024).fill(137)
  const results = await Promise.all(Array.from({ length: 32 }, async (_, index) => {
    const meta = await saveBlob('parallel', bytes, index % 2 ? 'image/png' : 'application/octet-stream')
    // Odczyt od razu po kazdej odpowiedzi, gdy inne uploady moga jeszcze trwac.
    expect(new Uint8Array(await readFile(blobPath('parallel', meta.sha256)))).toEqual(bytes)
    return meta
  }))
  for (const result of results) expect(result).toEqual(results[0])
  expect(db.query('SELECT COUNT(*) AS n FROM blobs WHERE user_id = ?').get('parallel')).toEqual({ n: 1 })
  expect(await readdir(dirname(blobPath('parallel', results[0].sha256)))).toEqual([results[0].sha256])
})

test('kolejny upload zachowuje istniejace metadane i wiek bloba', async () => {
  const bytes = new Uint8Array([1, 2, 3])
  const first = await saveBlob('repeat', bytes, 'image/png')
  const second = await saveBlob('repeat', bytes, 'image/jpeg')
  expect(second).toEqual(first)
  expect(second.mime).toBe('image/png')
})

test('ten sam plik pozostaje odizolowany miedzy uzytkownikami', async () => {
  const bytes = new Uint8Array([4, 5, 6])
  const [a, b] = await Promise.all([
    saveBlob('user-a', bytes, 'image/png'), saveBlob('user-b', bytes, 'image/jpeg'),
  ])
  expect(a.sha256).toBe(b.sha256)
  expect(findBlob('user-a', a.sha256)?.mime).toBe('image/png')
  expect(findBlob('user-b', b.sha256)?.mime).toBe('image/jpeg')
  expect(findBlob('user-c', a.sha256)).toBeNull()
  expect(new Uint8Array(await readFile(blobPath('user-a', a.sha256)))).toEqual(bytes)
  expect(new Uint8Array(await readFile(blobPath('user-b', b.sha256)))).toEqual(bytes)
})

test('rozne pliki tego samego uzytkownika nie sa scalane', async () => {
  const [a, b] = await Promise.all([
    saveBlob('different', new Uint8Array([7]), 'image/png'),
    saveBlob('different', new Uint8Array([8]), 'image/png'),
  ])
  expect(a.sha256).not.toBe(b.sha256)
  expect(db.query('SELECT COUNT(*) AS n FROM blobs WHERE user_id = ?').get('different')).toEqual({ n: 2 })
})

test('blad publikacji nie zostawia metadanych ani pliku tymczasowego; mozna ponowic', async () => {
  const bytes = new Uint8Array([9, 10])
  const sha = createHash('sha256').update(bytes).digest('hex')
  const destination = blobPath('retry', sha)
  // Katalog w miejscu pliku wymusza rzeczywisty blad rename.
  await mkdir(destination, { recursive: true })
  await expect(saveBlob('retry', bytes, 'image/png')).rejects.toThrow()
  expect(findBlob('retry', sha)).toBeNull()
  expect(await readdir(dirname(destination))).toEqual([sha])
  await rmdir(destination)
  expect((await saveBlob('retry', bytes, 'image/png')).sha256).toBe(sha)
  expect(new Uint8Array(await readFile(destination))).toEqual(bytes)
})
