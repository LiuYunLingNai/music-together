import type { ChatMessage } from '@music-together/shared'
import { LIMITS } from '@music-together/shared'
import { db } from './database.js'
import type { ChatRepository } from './types.js'

interface PermanentRoomChatRow {
  id: string
  chat_history_json: string
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    typeof message.id === 'string' &&
    typeof message.userId === 'string' &&
    typeof message.nickname === 'string' &&
    typeof message.content === 'string' &&
    typeof message.timestamp === 'number' &&
    (message.type === 'user' || message.type === 'system')
  )
}

export class InMemoryChatRepository implements ChatRepository {
  private history = new Map<string, ChatMessage[]>()
  private updatePermanentRoomHistory = db.prepare(`
    UPDATE permanent_rooms
    SET chat_history_json = @historyJson
    WHERE id = @roomId
  `)

  constructor() {
    const rows = db
      .prepare<[], PermanentRoomChatRow>('SELECT id, chat_history_json FROM permanent_rooms')
      .all()

    for (const row of rows) {
      try {
        const parsed: unknown = JSON.parse(row.chat_history_json)
        const messages = Array.isArray(parsed) ? parsed.filter(isChatMessage).slice(-LIMITS.CHAT_HISTORY_MAX) : []
        this.history.set(row.id, messages)
      } catch {
        this.history.set(row.id, [])
      }
    }
  }

  getHistory(roomId: string): ChatMessage[] {
    return this.history.get(roomId) ?? []
  }

  addMessage(roomId: string, message: ChatMessage): void {
    const messages = this.history.get(roomId)
    if (!messages) return
    messages.push(message)
    if (messages.length > LIMITS.CHAT_HISTORY_MAX) {
      messages.splice(0, messages.length - LIMITS.CHAT_HISTORY_MAX)
    }
    this.persistRoom(roomId)
  }

  createRoom(roomId: string): void {
    this.history.set(roomId, [])
  }

  persistRoom(roomId: string): void {
    const messages = this.history.get(roomId)
    if (!messages) return
    this.updatePermanentRoomHistory.run({ roomId, historyJson: JSON.stringify(messages) })
  }

  deleteRoom(roomId: string): void {
    this.history.delete(roomId)
  }
}

/** Singleton instance */
export const chatRepo = new InMemoryChatRepository()
