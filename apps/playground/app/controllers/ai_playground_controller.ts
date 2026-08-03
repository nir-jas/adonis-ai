import PlaygroundAgent from '../ai/agents/playground_agent.js'
import StructuredPlaygroundAgent from '../ai/agents/structured_playground_agent.js'
import { conversationStore } from '../ai/in_memory_conversation_store.js'
import type { HttpContext } from '@adonisjs/core/http'
import { InvalidRequestError } from 'adonis-ai'
import type { Message, RunOptions, ToolErrorMode, UserContent } from 'adonis-ai'
import ai from 'adonis-ai/services/main'

type PlaygroundMode = 'attachment' | 'chat' | 'conversation' | 'structured' | 'tool'

ai.useConversationStore(conversationStore)

export default class AiPlaygroundController {
  async run({ request, response }: HttpContext) {
    const input = request.input('prompt', '').trim()
    if (!input) return response.badRequest({ error: 'Enter a prompt to run the agent.' })

    try {
      const mode = this.#mode(request.input('mode'))
      const agent =
        mode === 'structured'
          ? await ai.make(StructuredPlaygroundAgent)
          : await ai.make(PlaygroundAgent)
      const result = await ai.prompt(
        agent,
        this.#content(input, request.input('attachment')),
        this.#options(request.all())
      )
      return {
        id: result.id,
        text: result.text,
        data: result.data,
        provider: result.provider,
        model: result.model,
        finishReason: result.finishReason,
        usage: result.usage,
        steps: result.steps,
        toolCalls: result.toolCalls,
        requestIds: result.requestIds,
        raw: result.raw,
      }
    } catch (error) {
      return response.status(this.#status(error)).send({ error: this.#error(error) })
    }
  }

  async stream({ request, response }: HttpContext) {
    const input = request.input('prompt', '').trim()
    if (!input) return response.badRequest({ error: 'Enter a prompt to stream the agent.' })

    try {
      const mode = this.#mode(request.input('mode'))
      const agent =
        mode === 'structured'
          ? await ai.make(StructuredPlaygroundAgent)
          : await ai.make(PlaygroundAgent)
      const stream = ai.stream(
        agent,
        this.#content(input, request.input('attachment')),
        this.#options(request.all())
      )

      response.header('Content-Type', 'text/event-stream')
      response.header('Cache-Control', 'no-cache, no-transform')
      response.header('Connection', 'keep-alive')
      return response.stream(stream.toSseReadable())
    } catch (error) {
      return response.status(this.#status(error)).send({ error: this.#error(error) })
    }
  }

  #options(input: Record<string, unknown>): RunOptions {
    const provider =
      input.provider === 'anthropic' || input.provider === 'gateway' ? input.provider : 'openai'
    const model = typeof input.model === 'string' ? input.model.trim() : ''
    const conversationId =
      typeof input.conversationId === 'string' ? input.conversationId.trim() : ''
    const maxSteps = this.#positiveInteger('Maximum steps', input.maxSteps)
    const maxOutputTokens = this.#positiveInteger('Maximum output tokens', input.maxOutputTokens)
    const timeout = this.#positiveInteger('Timeout', input.timeout)
    const temperature = this.#number('Temperature', input.temperature)
    const messages = this.#messages(input.messages)
    const providerOptions = this.#object('Provider options', input.providerOptions)
    const toolErrorMode: ToolErrorMode = input.toolErrorMode === 'throw' ? 'throw' : 'report'
    return {
      provider,
      ...(model ? { model } : {}),
      ...(conversationId ? { conversation: { id: conversationId } } : {}),
      ...(maxSteps !== undefined ? { maxSteps } : {}),
      ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
      ...(timeout !== undefined ? { timeout } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(messages ? { messages } : {}),
      ...(providerOptions ? { providerOptions } : {}),
      toolErrorMode,
      includeRaw:
        input.includeRaw === true || input.includeRaw === 'true' || input.includeRaw === 'on',
    }
  }

  #mode(value: unknown): PlaygroundMode {
    return value === 'structured' ||
      value === 'tool' ||
      value === 'attachment' ||
      value === 'conversation'
      ? value
      : 'chat'
  }

  #content(input: string, attachment: unknown): UserContent {
    const value = attachment as {
      base64?: unknown
      bytes?: unknown
      filename?: unknown
      mediaType?: unknown
      sourceType?: unknown
      url?: unknown
    }
    if (!value || typeof value !== 'object') return input

    const sourceType = value.sourceType ?? (value.base64 ? 'base64' : undefined)
    if (!sourceType) return input
    if (typeof value.mediaType !== 'string') {
      throw new InvalidRequestError('Attachment media type is required')
    }

    const source = (() => {
      if (sourceType === 'base64' && typeof value.base64 === 'string') {
        return { type: 'base64' as const, data: value.base64 }
      }
      if (sourceType === 'url' && typeof value.url === 'string') {
        return { type: 'url' as const, url: value.url }
      }
      if (sourceType === 'bytes') {
        return { type: 'bytes' as const, data: this.#bytes(value.bytes) }
      }
      throw new InvalidRequestError('Choose a valid attachment source')
    })()

    return [
      { type: 'text', text: input },
      {
        type: 'file',
        mediaType: value.mediaType,
        ...(typeof value.filename === 'string' && value.filename
          ? { filename: value.filename }
          : {}),
        source,
      },
    ]
  }

  #positiveInteger(label: string, value: unknown): number | undefined {
    const parsed = this.#number(label, value)
    if (parsed === undefined) return undefined
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new InvalidRequestError(`${label} must be a positive integer`)
    }
    return parsed
  }

  #number(label: string, value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    const parsed = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(parsed)) throw new InvalidRequestError(`${label} must be a number`)
    return parsed
  }

  #messages(value: unknown): Message[] | undefined {
    const parsed = this.#json('One-off messages', value)
    if (parsed === undefined) return undefined
    if (!Array.isArray(parsed)) {
      throw new InvalidRequestError('One-off messages must be a JSON array')
    }
    return parsed as Message[]
  }

  #object(label: string, value: unknown): Record<string, unknown> | undefined {
    const parsed = this.#json(label, value)
    if (parsed === undefined) return undefined
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new InvalidRequestError(`${label} must be a JSON object`)
    }
    return parsed as Record<string, unknown>
  }

  #json(label: string, value: unknown): unknown {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch {
      throw new InvalidRequestError(`${label} must contain valid JSON`)
    }
  }

  #bytes(value: unknown): Uint8Array {
    let values: unknown[]
    if (Array.isArray(value)) values = value
    else if (typeof value === 'string') {
      const trimmed = value.trim()
      if (!trimmed) return new Uint8Array()
      const parsed = trimmed.startsWith('[')
        ? this.#json('Attachment bytes', trimmed)
        : trimmed.split(',').map((item) => Number(item.trim()))
      if (!Array.isArray(parsed)) {
        throw new InvalidRequestError(
          'Attachment bytes must be a JSON array or comma-separated list'
        )
      }
      values = parsed
    } else {
      throw new InvalidRequestError('Attachment bytes must be a JSON array or comma-separated list')
    }
    if (
      !values.every((item) => Number.isInteger(item) && Number(item) >= 0 && Number(item) <= 255)
    ) {
      throw new InvalidRequestError('Attachment bytes must contain integers from 0 to 255')
    }
    return Uint8Array.from(values as number[])
  }

  #status(error: unknown): number {
    const status = (error as { status?: unknown })?.status
    return typeof status === 'number' && status >= 400 && status < 600 ? status : 500
  }

  #error(error: unknown) {
    const value = error as { name?: string; message?: string; code?: string }
    return {
      name: value?.name ?? 'Error',
      message: value?.message ?? 'The AI request failed.',
      code: value?.code ?? 'E_PLAYGROUND',
    }
  }
}
