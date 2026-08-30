const EXT_MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tiff: 'image/tiff',
  tif: 'image/tiff',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
}

const MIME_EXT_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/tiff': 'tiff',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

const BMFF_BRAND_MIME_MAP: Record<string, string> = {
  avif: 'image/avif',
  avis: 'image/avif',
  av01: 'image/avif',
  heic: 'image/heic',
  heix: 'image/heic',
  hevc: 'image/heic',
  hevx: 'image/heic',
  heif: 'image/heif',
  heim: 'image/heif',
  heis: 'image/heif',
  hevm: 'image/heif',
  hevs: 'image/heif',
  mif1: 'image/heic',
  msf1: 'image/heic',
}

export function detectMimeFromHeader(buffer: Buffer): string {
  if (buffer.length < 4) return 'image/unknown'
  const header = buffer.toString('hex', 0, 4)
  if (header.startsWith('89504e47')) return 'image/png'
  if (header.startsWith('ffd8ff')) return 'image/jpeg'
  if (header.startsWith('47494638')) return 'image/gif'
  if (header.startsWith('52494646')) {
    if (buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
    return 'image/unknown'
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buffer.toString('ascii', 8, 12).toLowerCase()
    return BMFF_BRAND_MIME_MAP[brand] || 'image/unknown'
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
  if (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return 'image/x-icon'
  if (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) return 'image/tiff'
  if (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a) return 'image/tiff'
  return 'image/unknown'
}

export function guessMimeFromUrl(url: string): string {
  const path = url.replace(/[?#].*$/, '')
  const ext = path.includes('.') ? path.split('.').pop()!.toLowerCase() : ''
  return EXT_MIME_MAP[ext] || 'image/unknown'
}

export function getExtFromMime(mime: string): string {
  return MIME_EXT_MAP[mime] || 'jpg'
}
