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
    response.assertTextIncludes('AI Gateway')
    response.assertTextIncludes('Advanced run options')
    response.assertTextIncludes('Absolute HTTP(S) URL')
    response.assertTextIncludes('Cancellation')
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

  test('streams structured output through the structured agent', async ({ client }) => {
    ai.fake([
      {
        data: {
          answer: 'A typed answer',
          keyPoints: ['Validated', 'Streamed'],
          confidence: 0.95,
        },
        chunks: ['{"answer":"A typed answer"}'],
      },
    ]).preventStrayRequests()

    const response = await client.post('/api/ai/stream').withCsrfToken().json({
      prompt: 'Return structured output',
      provider: 'openai',
      model: 'test-model',
      mode: 'structured',
    })

    response.assertStatus(200)
    response.assertTextIncludes('event: run.completed')
    response.assertTextIncludes('"answer":"A typed answer"')
  })

  test('passes every advanced run option and exposes opt-in raw data', async ({
    client,
    assert,
  }) => {
    const fake = ai
      .fake((record, request) => {
        assert.equal(record.provider, 'gateway')
        assert.equal(record.options.maxSteps, 3)
        assert.equal(record.options.toolErrorMode, 'throw')
        assert.equal(request.maxOutputTokens, 512)
        assert.equal(request.temperature, 0.25)
        assert.equal(request.timeout, 1_500)
        assert.equal(request.includeRaw, true)
        assert.deepEqual(request.providerOptions, { reasoningEffort: 'low' })
        assert.equal(request.messages.length, 3)
        return { text: 'Advanced options accepted', id: 'req_advanced' }
      })
      .preventStrayRequests()

    const response = await client
      .post('/api/ai/run')
      .withCsrfToken()
      .json({
        prompt: 'Use the configured options',
        provider: 'gateway',
        model: 'test-model',
        mode: 'chat',
        maxSteps: '3',
        maxOutputTokens: '512',
        temperature: '0.25',
        timeout: '1500',
        toolErrorMode: 'throw',
        includeRaw: true,
        messages: JSON.stringify([
          { role: 'user', content: 'Prior question' },
          { role: 'assistant', content: 'Prior answer' },
        ]),
        providerOptions: JSON.stringify({ reasoningEffort: 'low' }),
      })

    response.assertStatus(200)
    response.assertBodyContains({
      text: 'Advanced options accepted',
      provider: 'gateway',
      requestIds: ['req_advanced'],
    })
    assert.equal(response.body().raw[0].id, 'req_advanced')
    fake.assertPrompted({ provider: 'gateway' })
  })

  test('rejects malformed advanced options before a provider request', async ({ client }) => {
    const fake = ai.fake().preventStrayRequests()

    const response = await client.post('/api/ai/run').withCsrfToken().json({
      prompt: 'Do not send this',
      provider: 'openai',
      model: 'test-model',
      providerOptions: '{not-json}',
    })

    response.assertStatus(400)
    response.assertBodyContains({
      error: {
        code: 'E_AI_INVALID_REQUEST',
        message: 'Provider options must contain valid JSON',
      },
    })
    fake.assertNothingPrompted()
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

  test('accepts URL and byte attachment sources without network access', async ({
    client,
    assert,
  }) => {
    const fake = ai.fake(['URL received', 'Bytes received']).preventStrayRequests()

    const urlResponse = await client
      .post('/api/ai/run')
      .withCsrfToken()
      .json({
        prompt: 'Inspect this image URL',
        provider: 'openai',
        model: 'test-model',
        mode: 'attachment',
        attachment: {
          sourceType: 'url',
          url: 'https://cdn.example.com/image.png?secret=redacted',
          filename: 'image.png',
          mediaType: 'image/png',
        },
      })
    const bytesResponse = await client
      .post('/api/ai/run')
      .withCsrfToken()
      .json({
        prompt: 'Inspect these bytes',
        provider: 'anthropic',
        model: 'test-model',
        mode: 'attachment',
        attachment: {
          sourceType: 'bytes',
          bytes: '137, 80, 78, 71',
          filename: 'bytes.png',
          mediaType: 'image/png',
        },
      })

    urlResponse.assertStatus(200)
    bytesResponse.assertStatus(200)
    assert.deepEqual(
      fake.prompts().map((record) => record.attachments?.[0]?.source),
      ['url', 'bytes']
    )
    fake.assertPrompted({ attachment: { source: 'url', mediaType: 'image/png' } })
    fake.assertPrompted({ attachment: { source: 'bytes', mediaType: 'image/png' } })
  })
})
