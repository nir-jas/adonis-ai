import type { ConversationStore, ConversationTurn, Message } from 'adonis-ai'

class InMemoryConversationStore implements ConversationStore {
  #messages = new Map<string, Message[]>()

  load(id: string): readonly Message[] {
    return [...(this.#messages.get(id) ?? [])]
  }

  append(id: string, turn: ConversationTurn): void {
    this.#messages.set(id, [...(this.#messages.get(id) ?? []), ...turn.messages])
  }

  clear(): void {
    this.#messages.clear()
  }
}

export const conversationStore = new InMemoryConversationStore()
