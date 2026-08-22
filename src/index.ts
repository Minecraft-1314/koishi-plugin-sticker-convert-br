import { Context, Schema, h, Logger, Session } from 'koishi'
import { createHash } from 'crypto'

export const name = 'sticker-convert'
export const usage = `
## QQ 表情转换插件

将 QQ 表情包转换为可保存的图片或文件格式。

### 使用方法
1. 回复包含表情的消息，发送 "表情转换" 即可转换并发送

### 支持格式
- 静态图片（jpg/png/webp）：转为普通图片或文件
- 动态图片（gif）：转为文件或图片
- 官方表情（face）：转为文件或图片
`

export interface Config {
  staticImageMode: 'buffer' | 'file'
  gifMode: 'buffer' | 'file'
  debug: boolean
}

export const Config: Schema<Config> = Schema.object({
  staticImageMode: Schema.union([
    Schema.const('buffer').description('直接发送图片（推荐，兼容性最好）'),
    Schema.const('file').description('作为文件发送（使用 base64 上传）')
  ]).default('buffer').description('静态图片（jpg/png/webp）的发送方式'),
  gifMode: Schema.union([
    Schema.const('buffer').description('直接发送图片（推荐，兼容性最好）'),
    Schema.const('file').description('作为文件发送（使用 base64 上传）')
  ]).default('file').description('GIF 动图的发送方式'),
  debug: Schema.boolean().default(false).description('是否启用调试日志'),
}).description('发送设置')

const logger = new Logger('sticker-convert')

export function apply(ctx: Context, config: Config) {
  async function downloadImage(url: string): Promise<{ buffer: Buffer, mime: string, size: number }> {
    try {
      const response = await ctx.http.get(url, { responseType: 'arraybuffer', timeout: 30000 })
      const buffer = Buffer.from(response)

      let mime = detectMimeFromHeader(buffer)
      if (mime === 'image/unknown') {
        mime = guessMimeFromUrl(url)
      }

      return { buffer, mime, size: buffer.length }
    } catch (error) {
      throw new Error(`下载失败: ${error.message}`)
    }
  }

  function detectMimeFromHeader(buffer: Buffer): string {
    if (buffer.length >= 4) {
      const header = buffer.toString('hex', 0, 4)
      if (header.startsWith('89504e47')) return 'image/png'
      if (header.startsWith('ffd8ff')) return 'image/jpeg'
      if (header.startsWith('47494638')) return 'image/gif'
      if (header.startsWith('52494646')) {
        if (buffer.length >= 12 && buffer.toString('ascii', 8, 12) === 'WEBP') {
          return 'image/webp'
        }
      }
      if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
      if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0x01 && buffer[3] === 0x00) return 'image/x-icon'
      if (buffer.length >= 4 && buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) return 'image/tiff'
      if (buffer.length >= 4 && buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a) return 'image/tiff'
      if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'avif') return 'image/avif'
      if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'heic') return 'image/heic'
      if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === 'heif') return 'image/heif'
    }
    return 'image/unknown'
  }

  function guessMimeFromUrl(url: string): string {
    const ext = url.replace(/[?#].*$/, '').split('.').pop()?.toLowerCase() || ''
    const mimeMap: Record<string, string> = {
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
    return mimeMap[ext] || 'image/unknown'
  }

  function getExtFromMime(mime: string): string {
    const mimeMap: Record<string, string> = {
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
    return mimeMap[mime] || 'jpg'
  }

  function debugLog(message: string, data?: any) {
    if (config.debug) {
      if (data) {
        logger.info(`[DEBUG] ${message}`, data)
      } else {
        logger.info(`[DEBUG] ${message}`)
      }
    }
  }

  function isOneBotPlatform(session: Session): boolean {
    return session.platform === 'onebot' || session.platform.startsWith('onebot')
  }

  function collectImageElements(elements: any[]): any[] {
    const results: any[] = []
    for (const el of elements) {
      if (!el) continue
      if (el.type === 'img' || el.type === 'image' || el.type === 'mface' || el.type === 'sticker') {
        results.push(el)
      } else if (el.type === 'face') {
        const children = el.children || []
        const imgs = collectImageElements(children)
        results.push(...imgs)
      } else if (el.children && el.children.length > 0) {
        results.push(...collectImageElements(el.children))
      }
    }
    return results
  }

  async function sendFileFromBuffer(session: Session, buffer: Buffer, fileName: string): Promise<void> {
    const base64Data = buffer.toString('base64')
    const fileUri = `base64://${base64Data}`
    const isDirect = session.isDirect
    const internal = (session.bot as any).internal

    if (!internal) {
      throw new Error('当前 OneBot 适配器未提供文件上传 API')
    }

    debugLog('尝试直接调用 OneBot 文件上传 API', { fileName, size: buffer.length, isDirect })

    try {
      if (isDirect) {
        if (typeof internal.uploadPrivateFile !== 'function') {
          throw new Error('当前 OneBot 适配器不支持私聊文件上传')
        }
        await internal.uploadPrivateFile(session.userId, fileUri, fileName)
        debugLog('私聊文件上传成功', { fileName })
      } else {
        if (typeof internal.uploadGroupFile !== 'function') {
          throw new Error('当前 OneBot 适配器不支持群聊文件上传')
        }
        await internal.uploadGroupFile(session.channelId, fileUri, fileName)
        debugLog('群聊文件上传成功', { fileName })
      }
    } catch (error) {
      debugLog('OneBot 文件上传失败', { error: error.message })
      throw error
    }
  }

  async function convertEmoji(session: Session) {
    debugLog('开始转换表情', {
      platform: session.platform,
      channelId: session.channelId,
      userId: session.userId
    })

    if (!isOneBotPlatform(session)) {
      debugLog('平台不支持', { platform: session.platform })
      return '此插件仅支持 QQ 平台（OneBot 适配器）'
    }

    const quote = session.quote
    if (!quote) {
      debugLog('没有回复消息')
      return '请回复包含表情的消息后使用此命令'
    }

    const allImageLike = collectImageElements(quote.elements || [])

    if (allImageLike.length === 0) {
      debugLog('没有找到图片元素')
      return '被回复的消息中没有找到图片表情'
    }

    const results: string[] = []
    let successCount = 0

    for (const img of allImageLike) {
      try {
        let url: string
        if (img.type === 'mface' || img.type === 'sticker') {
          url = img.attrs.url || img.attrs.src
        } else {
          url = img.attrs.src || img.attrs.url
        }

        if (!url) {
          debugLog('图片URL无效', { type: img.type, attrs: img.attrs })
          results.push('发现无效图片链接')
          continue
        }

        const { buffer, mime, size } = await downloadImage(url)
        const md5 = createHash('md5').update(buffer).digest('hex')
        const ext = getExtFromMime(mime)
        const isGif = mime === 'image/gif'
        const fileName = `sticker-${md5.substring(0, 8)}.${ext}`

        debugLog('图片下载完成', { size, mime, ext, isGif, md5: md5.substring(0, 8) })

        if (isGif) {
          if (config.gifMode === 'file') {
            try {
              await sendFileFromBuffer(session, buffer, fileName)
              results.push(`GIF 已转为文件: ${fileName}`)
            } catch (error) {
              debugLog('GIF文件发送失败，降级为图片发送', { error: error.message })
              await session.send(h.image(buffer, 'image/gif'))
              results.push(`GIF 已转换（作为图片发送）`)
            }
          } else {
            await session.send(h.image(buffer, 'image/gif'))
            results.push(`GIF 已转换为图片`)
          }
        } else {
          if (config.staticImageMode === 'file') {
            try {
              await sendFileFromBuffer(session, buffer, fileName)
              results.push(`图片已转为文件: ${fileName}`)
            } catch (error) {
              debugLog('静态图片文件发送失败，降级为图片发送', { error: error.message })
              await session.send(h.image(buffer, mime))
              results.push(`图片已转换`)
            }
          } else {
            await session.send(h.image(buffer, mime))
            results.push(`图片已转换`)
          }
        }

        successCount++
      } catch (error) {
        debugLog('转换失败', { error: error.message })
        logger.error('转换失败:', error)
        results.push(`转换失败: ${error.message}`)
      }
    }

    if (successCount > 0) {
      results.unshift(`成功转换 ${successCount} 个表情`)
    }

    return results.join('\n')
  }

  ctx.command('表情转换', '转换表情格式')
    .action(async ({ session }) => {
      return await convertEmoji(session)
    })
}