import { test } from '@japa/runner'
import ai from 'adonis-ai/services/main'

test.group('AI playground', (group) => {
  group.each.teardown(() => {
    ai.fake().restore()
  })

  test('renders the package playground', async ({ client }) => {
    const response = await client.get('/')

    response.assertStatus(200)
    response.assertTextIncludes('Adonis AI SDK Playground')
    response.assertTextIncludes('OpenAI')
    response.assertTextIncludes('Anthropic')
  })

  test('runs a structured response through the package fake', async ({ client }) => {
    ai.fake([
      {
        data: {
          answer: 'Async iterables model values over time.',
          keyPoints: ['Backpressure-friendly', 'Works with for await'],
          confidence: 0.99,
        },
      },
    ]).preventStrayRequests()

    const response = await client.post('/api/ai/run').withCsrfToken().json({
      prompt: 'Explain async iterables',
      provider: 'openai',
      model: 'test-model',
      mode: 'structured',
    })

    response.assertStatus(200)
    response.assertBodyContains({
      data: {
        answer: 'Async iterables model values over time.',
        keyPoints: ['Backpressure-friendly', 'Works with for await'],
        confidence: 0.99,
      },
      provider: 'openai',
      model: 'test-model',
    })
  })

  test('streams normalized SSE events through an Adonis response', async ({ client }) => {
    ai.fake([{ text: 'Hello world', chunks: ['Hello', ' ', 'world'] }]).preventStrayRequests()

    const response = await client.post('/api/ai/stream').withCsrfToken().json({
      prompt: 'Say hello',
      provider: 'anthropic',
      model: 'test-model',
      mode: 'chat',
    })

    response.assertStatus(200)
    response.assertHeader('content-type', 'text/event-stream')
    response.assertTextIncludes('event: run.started')
    response.assertTextIncludes('event: text.delta')
    response.assertTextIncludes('event: run.completed')
    response.assertTextIncludes('"provider":"anthropic"')
  })
})
