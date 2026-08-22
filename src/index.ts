import { Context, Schema, h, Logger, Session } from 'koishi'
import { resolve } from 'path'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'fs'

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
    Schema.const('buffer').description('直接发送图片（推荐）'),
    Schema.const('file').description('作为文件发送')
  ]).default('buffer').description('静态图片（jpg/png/webp）的发送方式'),
  gifMode: Schema.union([
    Schema.const('file').description('作为文件发送（推荐）'),
    Schema.const('buffer').description('直接发送图片')
  ]).default('file').description('GIF 动图的发送方式'),
  debug: Schema.boolean().default(false).description('是否启用调试日志'),
}).description('发送设置')

const logger = new Logger('sticker-convert')

export function apply(ctx: Context, config: Config) {
  const storageDir = resolve(ctx.baseDir, 'data', 'sticker-convert')
  if (!existsSync(storageDir)) {
    mkdirSync(storageDir, { recursive: true })
  }

  async function downloadImage(url: string): Promise<{ buffer: Buffer, mime: string, size: number }> {
    try {
      const response = await ctx.http.get(url, { responseType: 'arraybuffer', timeout: 30000 })
      const buffer = Buffer.from(response)

      let mime = 'image/unknown'
      if (buffer.length >= 4) {
        const header = buffer.toString('hex', 0, 4)
        if (header.startsWith('89504e47')) mime = 'image/png'
        else if (header.startsWith('ffd8ff')) mime = 'image/jpeg'
        else if (header.startsWith('47494638')) mime = 'image/gif'
        else if (buffer.toString('ascii', 0, 4) === 'RIFF') mime = 'image/webp'
      }

      return { buffer, mime, size: buffer.length }
    } catch (error) {
      throw new Error(`下载失败: ${error.message}`)
    }
  }

  function getExtFromMime(mime: string): string {
    const mimeMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp'
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
    return session.platform === 'onebot'
  }

  async function sendFileFromBuffer(session: Session, buffer: Buffer, fileName: string): Promise<void> {
    const tempDir = resolve(storageDir, `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, { recursive: true })
    const filePath = resolve(tempDir, fileName)
    const fileUrl = 'file://' + filePath.replace(/\\/g, '/')

    try {
      await new Promise<void>((resolve, reject) => {
        const stream = createWriteStream(filePath)
        stream.write(buffer)
        stream.end()
        stream.on('finish', () => resolve())
        stream.on('error', reject)
      })

      debugLog('临时文件已保存', { filePath, fileName })
      await session.send(h.file(fileUrl, { filename: fileName }))
      debugLog('文件发送成功', { filePath, fileName })
    } catch (error) {
      debugLog('文件发送失败', { error: error.message, filePath })
      throw error
    } finally {
      setTimeout(() => {
        try {
          rmSync(tempDir, { recursive: true, force: true })
          debugLog('临时目录已删除', { tempDir })
        } catch (error) {
          logger.warn('删除临时目录失败:', error)
        }
      }, 60000)
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

    debugLog('找到回复消息', {
      messageId: quote.messageId,
      elements: quote.elements?.length,
      elementTypes: quote.elements?.map(el => el.type)
    })

    const images = h.select(quote.elements, 'img')
    const imageElements = h.select(quote.elements, 'image')
    const mfaceElements = h.select(quote.elements, 'mface')
    const allImageLike = [...images, ...imageElements, ...mfaceElements]

    debugLog('提取图片元素', {
      imgCount: images.length,
      imageCount: imageElements.length,
      mfaceCount: mfaceElements.length,
      total: allImageLike.length
    })

    if (allImageLike.length === 0) {
      debugLog('没有找到图片元素')
      return '被回复的消息中没有找到图片表情'
    }

    const results: string[] = []
    let successCount = 0

    for (const img of allImageLike) {
      try {
        debugLog('处理图片', { type: img.type, attrs: img.attrs })

        let url: string
        if (img.type === 'mface') {
          url = img.attrs.url
        } else {
          url = img.attrs.src || img.attrs.url
        }

        if (!url) {
          debugLog('图片URL无效')
          results.push('发现无效图片链接')
          continue
        }

        debugLog('开始下载图片', { type: img.type, url })

        const { buffer, mime, size } = await downloadImage(url)
        const md5 = createHash('md5').update(buffer).digest('hex')
        const ext = getExtFromMime(mime)
        const isGif = mime === 'image/gif'
        const fileName = `sticker-${md5.substring(0, 8)}.${ext}`

        debugLog('图片下载完成', { size, mime, ext, isGif, md5: md5.substring(0, 8) })

        if (isGif) {
          if (config.gifMode === 'file') {
            try {
              debugLog('以文件方式发送GIF')
              await sendFileFromBuffer(session, buffer, fileName)
              results.push(`GIF 已转为文件: ${fileName}`)
            } catch (error) {
              debugLog('GIF文件发送失败，尝试作为图片发送', { error: error.message })
              await session.send(h.image(buffer, 'image/gif'))
              results.push(`GIF 已转换（作为图片发送）`)
            }
          } else {
            debugLog('以图片方式发送GIF')
            await session.send(h.image(buffer, 'image/gif'))
            results.push(`GIF 已转换为图片`)
          }
        } else {
          if (config.staticImageMode === 'file') {
            try {
              debugLog('以文件方式发送静态图片')
              await sendFileFromBuffer(session, buffer, fileName)
              results.push(`图片已转为文件: ${fileName}`)
            } catch (error) {
              debugLog('静态图片文件发送失败，尝试作为图片发送', { error: error.message })
              await session.send(h.image(buffer, mime))
              results.push(`图片已转换`)
            }
          } else {
            debugLog('以图片方式发送静态图片')
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