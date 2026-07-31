import { BaseAgent } from 'adonis-ai'
import { z } from 'zod'

export const playgroundOutput = z.object({
  answer: z.string(),
  keyPoints: z.array(z.string()).max(5),
  confidence: z.number().min(0).max(1),
})

export default class StructuredPlaygroundAgent extends BaseAgent<typeof playgroundOutput> {
  readonly outputSchema = playgroundOutput

  instructions() {
    return 'Answer with a concise summary, up to five key points, and a confidence score.'
  }
}
