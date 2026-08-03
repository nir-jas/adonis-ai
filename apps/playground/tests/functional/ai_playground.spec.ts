import { test } from '@japa/runner'
import ai from 'adonis-ai/services/main'
import { conversationStore } from '../../app/ai/in_memory_conversation_store.js'

test.group('AI playground', (group) => {
  group.each.teardown(() => {
    ai.fake().restore()
    conversationStore.clear()
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

  test('continues an application-owned conversation across requests', async ({
    client,
    assert,
  }) => {
    const observedHistory: number[] = []
    ai.fake((_record, request) => {
      observedHistory.push(request.messages.length)
      return observedHistory.length === 1 ? 'First answer' : 'Second answer with history'
    }).preventStrayRequests()

    const first = await client.post('/api/ai/run').withCsrfToken().json({
      prompt: 'First question',
      provider: 'openai',
      model: 'test-model',
      mode: 'conversation',
      conversationId: 'browser-conversation',
    })
    const second = await client.post('/api/ai/run').withCsrfToken().json({
      prompt: 'Second question',
      provider: 'openai',
      model: 'test-model',
      mode: 'conversation',
      conversationId: 'browser-conversation',
    })

    first.assertStatus(200)
    second.assertStatus(200)
    second.assertBodyContains({ text: 'Second answer with history' })
    assert.deepEqual(observedHistory, [1, 3])
  })

  test('accepts deterministic PDF input without a live provider request', async ({
    client,
    assert,
  }) => {
    const fake = ai.fake(['Document received']).preventStrayRequests()

    const response = await client
      .post('/api/ai/run')
      .withCsrfToken()
      .json({
        prompt: 'Inspect this document',
        provider: 'anthropic',
        model: 'test-model',
        mode: 'attachment',
        attachment: {
          base64: 'AQID',
          filename: 'report.pdf',
          mediaType: 'application/pdf',
        },
      })

    response.assertStatus(200)
    response.assertBodyContains({ text: 'Document received' })
    fake.assertPrompted({
      attachment: {
        filename: 'report.pdf',
        mediaType: 'application/pdf',
        source: 'base64',
      },
    })
    assert.equal(fake.prompts()[0]?.messages?.[0]?.role, 'user')
  })
})
