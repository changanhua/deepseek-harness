/** Preserve the real JSONL Session corpus when a Web scaffold deliberately rotates its temp root. */
import { cp } from 'node:fs/promises'

export async function restoreSessionPersistence(from: string, to: string): Promise<void> {
  await cp(from, to, { recursive: true, force: true })
}
