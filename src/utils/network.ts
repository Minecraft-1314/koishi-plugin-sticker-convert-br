import { Context, Session } from 'koishi'
import { detectMimeFromHeader, guessMimeFromUrl } from './mime.js'

export interface DownloadedImage {
  buffer: Buffer
  mime: string
  size: number
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

export async function downloadImage(ctx: Context, url: string, timeout: number): Promise<DownloadedImage> {
  try {
    const response = await ctx.http.get(url, { responseType: 'arraybuffer', timeout })
    const buffer = Buffer.isBuffer(response) ? response : Buffer.from(response)
    let mime = detectMimeFromHeader(buffer)
    if (mime === 'image/unknown') mime = guessMimeFromUrl(url)
    return { buffer, mime, size: buffer.length }
  } catch (error) {
    throw new Error(`下载失败: ${getErrorMessage(error)}`)
  }
}

export async function sendFileFromBuffer(session: Session, buffer: Buffer, fileName: string): Promise<void> {
  const internal = (session.bot as any).internal
  if (!internal) {
    throw new Error('当前 OneBot 适配器未提供文件上传 API')
  }
  const fileUri = `base64://${buffer.toString('base64')}`
  if (session.isDirect) {
    if (typeof internal.uploadPrivateFile !== 'function') {
      throw new Error('当前 OneBot 适配器不支持私聊文件上传')
    }
    await internal.uploadPrivateFile(session.userId, fileUri, fileName)
  } else {
    if (typeof internal.uploadGroupFile !== 'function') {
      throw new Error('当前 OneBot 适配器不支持群聊文件上传')
    }
    await internal.uploadGroupFile(session.channelId, fileUri, fileName)
  }
}
