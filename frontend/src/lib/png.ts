/**
 * Obsługa PNG z metadanymi SillyTavern.
 *
 * Import: odczyt tEXt chunk "chara" (base64 JSON).
 * Eksport: budowa PNG z obrazu + tEXt chunk "chara".
 *
 * Kompresja IDAT używa natywnego CompressionStream('deflate') —
 * dostępnego w nowoczesnych przeglądarkach (Chrome 103+, Firefox 113+, Safari 16.4+).
 */

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    out.set(a, offset)
    offset += a.length
  }
  return out
}

// CRC32 (standard PNG)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const b of bytes) {
    crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type)
  const length = new Uint8Array(4)
  new DataView(length.buffer).setUint32(0, data.length, false)

  const crcInput = concatBytes(typeBytes, data)
  const crc = new Uint8Array(4)
  new DataView(crc.buffer).setUint32(0, crc32(crcInput), false)

  return concatBytes(length, typeBytes, data, crc)
}

/** Odczytuje wartość tEXt chunk o podanym keyword z bufora PNG. */
export function extractPNGText(buffer: ArrayBuffer, keyword: string): string | null {
  const view = new DataView(buffer)
  if (view.byteLength < 8) return null

  for (let i = 0; i < 8; i++) {
    if (view.getUint8(i) !== PNG_SIGNATURE[i]) return null
  }

  let offset = 8
  while (offset + 8 <= view.byteLength) {
    const length = view.getUint32(offset, false)
    const type = new TextDecoder().decode(new Uint8Array(buffer, offset + 4, 4))
    const dataStart = offset + 8

    if (type === 'tEXt') {
      const data = new Uint8Array(buffer, dataStart, length)
      const nullIdx = data.indexOf(0)
      if (nullIdx !== -1) {
        const key = new TextDecoder().decode(data.slice(0, nullIdx))
        if (key === keyword) {
          return new TextDecoder().decode(data.slice(nullIdx + 1))
        }
      }
    }

    if (type === 'IEND') break
    offset = dataStart + length + 4
  }

  return null
}

/** Konwertuje dataURL obrazu na surowe dane RGBA (ImageData). */
export async function dataURLToImageData(dataURL: string): Promise<ImageData> {
  const img = new Image()
  img.src = dataURL
  await img.decode()

  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)

  return ctx.getImageData(0, 0, img.width, img.height)
}

/**
 * Buduje PNG z obrazem (RGBA) i dodatkowym tEXt chunk.
 * Zwraca Blob gotowy do pobrania.
 */
export async function createPNGWithText(image: ImageData, keyword: string, text: string): Promise<Blob> {
  const { width, height, data } = image

  // Surowe dane skanlinii: filtr 0 na początku każdego wiersza + RGBA
  const raw = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4)
    raw[rowStart] = 0 // filtr None
    const sourceStart = y * width * 4
    raw.set(data.slice(sourceStart, sourceStart + width * 4), rowStart + 1)
  }

  // Deflate przez natywny CompressionStream
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer())

  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, width, false)
  dv.setUint32(4, height, false)
  dv.setUint8(8, 8) // bit depth
  dv.setUint8(9, 6) // color type RGBA
  dv.setUint8(10, 0) // compression
  dv.setUint8(11, 0) // filter
  dv.setUint8(12, 0) // interlace

  const textData = concatBytes(new TextEncoder().encode(`${keyword}\0${text}`))

  const png = concatBytes(
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('tEXt', textData),
    pngChunk('IEND', new Uint8Array(0)),
  )

  return new Blob([png as BlobPart], { type: 'image/png' })
}
