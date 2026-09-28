import { assistantStreamChunks } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Read durable image blocks from one exact event, including generated tool and assistant images. */
export function sessionEventImages(event: SessionEvent): ImageAttachmentRef[] {
  const images = new Map<string, ImageAttachmentRef>()
  const blocks = (content: unknown): void => {
    if (!Array.isArray(content)) return
    for (const value of content) {
      if (typeof value !== 'object' || value === null) continue
      const block = value as { type?: unknown; attachment?: ImageAttachmentRef; content?: unknown }
      if (block.type === 'image' && block.attachment !== undefined) {
        images.set(String(block.attachment.attachmentId), block.attachment)
      } else if (block.type === 'tool-result') blocks(block.content)
    }
  }
  const data = event.data as {
    content?: unknown
    message?: { content?: unknown }
    inserted?: readonly { content?: unknown }[]
  }
  blocks(data.content)
  blocks(data.message?.content)
  for (const message of data.inserted ?? []) blocks(message.content)
  if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
    for (const chunk of assistantStreamChunks(event.data.stream, 'block-end')) blocks([chunk.block])
  }
  return [...images.values()]
}
