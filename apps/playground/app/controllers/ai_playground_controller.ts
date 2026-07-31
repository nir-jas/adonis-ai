import PlaygroundAgent from '../ai/agents/playground_agent.js'
import StructuredPlaygroundAgent from '../ai/agents/structured_playground_agent.js'
import type { HttpContext } from '@adonisjs/core/http'
import type { RunOptions } from 'adonis-ai'
import ai from 'adonis-ai/services/main'

type PlaygroundMode = 'chat' | 'structured' | 'tool'

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
      const result = await ai.prompt(agent, input, this.#options(request.all()))
      return {
        text: result.text,
        data: result.data,
        provider: result.provider,
        model: result.model,
        finishReason: result.finishReason,
        usage: result.usage,
        steps: result.steps,
        requestIds: result.requestIds,
      }
    } catch (error) {
      return response.status(this.#status(error)).send({ error: this.#error(error) })
    }
  }

  async stream({ request, response }: HttpContext) {
    const input = request.input('prompt', '').trim()
    if (!input) return response.badRequest({ error: 'Enter a prompt to stream the agent.' })

    const agent = await ai.make(PlaygroundAgent)
    const stream = ai.stream(agent, input, this.#options(request.all()))

    response.header('Content-Type', 'text/event-stream')
    response.header('Cache-Control', 'no-cache, no-transform')
    response.header('Connection', 'keep-alive')
    return response.stream(stream.toSseReadable())
  }

  #options(input: Record<string, unknown>): RunOptions {
    const provider = input.provider === 'anthropic' ? 'anthropic' : 'openai'
    const model = typeof input.model === 'string' ? input.model.trim() : ''
    return model ? { provider, model } : { provider }
  }

  #mode(value: unknown): PlaygroundMode {
    return value === 'structured' || value === 'tool' ? value : 'chat'
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
