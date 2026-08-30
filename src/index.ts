import { Context, Schema, h, Logger, Session } from 'koishi'
import { createHash } from 'crypto'
import { getExtFromMime } from './utils/mime.js'
import { downloadImage, sendFileFromBuffer, getErrorMessage } from './utils/network.js'

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
  timeout: number
  debug: boolean
}

export const Config: Schema<Config> = Schema.object({
  staticImageMode: Schema.union([
    Schema.const('buffer').description('直接发送图片（推荐，兼容性最好）'),
    Schema.const('file').description('作为文件发送（使用 base64 上传）'),
  ]).default('buffer').description('静态图片（jpg/png/webp）的发送方式'),
  gifMode: Schema.union([
    Schema.const('buffer').description('直接发送图片（推荐，兼容性最好）'),
    Schema.const('file').description('作为文件发送（使用 base64 上传）'),
  ]).default('file').description('GIF 动图的发送方式'),
  timeout: Schema.number().default(30000).description('图片下载超时时间（毫秒）'),
  debug: Schema.boolean().default(false).description('是否启用调试日志'),
}).description('发送设置')

const logger = new Logger('sticker-convert')

export function apply(ctx: Context, config: Config) {
  function collectImageElements(elements: h[]): h[] {
    const results: h[] = []
    for (const el of elements) {
      if (!el) continue
      if (el.type === 'img' || el.type === 'image' || el.type === 'mface' || el.type === 'sticker') {
        results.push(el)
      } else if (el.children && el.children.length > 0) {
        results.push(...collectImageElements(el.children))
      }
    }
    return results
  }

  function debugLog(message: string, data?: unknown) {
    if (config.debug) {
      if (data !== undefined) {
        logger.info(`[DEBUG] ${message}`, data)
      } else {
        logger.info(`[DEBUG] ${message}`)
      }
    }
  }

  async function convertEmoji(session: Session): Promise<string> {
    debugLog('开始转换表情', {
      platform: session.platform,
      channelId: session.channelId,
      userId: session.userId,
    })

    if (!session.platform.startsWith('onebot')) {
      return '此插件仅支持 QQ 平台（OneBot 适配器）'
    }

    const quote = session.quote
    if (!quote) {
      return '请回复包含表情的消息后使用此命令'
    }

    const imageElements = collectImageElements(quote.elements || [])
    if (imageElements.length === 0) {
      return '被回复的消息中没有找到图片表情'
    }

    const results: string[] = []
    let successCount = 0

    for (const img of imageElements) {
      try {
        const url = (img.type === 'mface' || img.type === 'sticker')
          ? (img.attrs.url || img.attrs.src)
          : (img.attrs.src || img.attrs.url)
        if (!url) {
          results.push('发现无效图片链接')
          continue
        }

        const { buffer, mime, size } = await downloadImage(ctx, url, config.timeout)
        const md5 = createHash('md5').update(buffer).digest('hex').substring(0, 8)
        const ext = getExtFromMime(mime)
        const isGif = mime === 'image/gif'
        const fileName = `sticker-${md5}.${ext}`
        const sendMime = mime === 'image/unknown' ? 'image/jpeg' : mime

        debugLog('图片下载完成', { size, mime, ext, isGif, md5 })

        if (isGif) {
          if (config.gifMode === 'file') {
            try {
              await sendFileFromBuffer(session, buffer, fileName)
              results.push(`GIF 已转为文件: ${fileName}`)
            } catch (error) {
              debugLog('GIF 文件发送失败，降级为图片发送', { error: getErrorMessage(error) })
              await session.send(h.image(buffer, sendMime))
              results.push('GIF 已转换（作为图片发送）')
            }
          } else {
            await session.send(h.image(buffer, sendMime))
            results.push('GIF 已转换为图片')
          }
        } else {
          if (config.staticImageMode === 'file') {
            try {
              await sendFileFromBuffer(session, buffer, fileName)
              results.push(`图片已转为文件: ${fileName}`)
            } catch (error) {
              debugLog('静态图片文件发送失败，降级为图片发送', { error: getErrorMessage(error) })
              await session.send(h.image(buffer, sendMime))
              results.push('图片已转换')
            }
          } else {
            await session.send(h.image(buffer, sendMime))
            results.push('图片已转换')
          }
        }

        successCount++
      } catch (error) {
        const msg = getErrorMessage(error)
        logger.error('转换失败:', msg)
        results.push(`转换失败: ${msg}`)
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