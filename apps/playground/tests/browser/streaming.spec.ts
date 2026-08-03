import { test } from '@japa/runner'
import ai from 'adonis-ai/services/main'

test('exposes the complete runtime feature lab', async ({ visit, assert }) => {
  const page = await visit('/')

  assert.equal(await page.locator('#provider option').count(), 3)
  assert.match((await page.locator('.feature-list').textContent()) ?? '', /Conversations/)
  assert.match((await page.locator('.feature-list').textContent()) ?? '', /Cancellation/)

  await page.locator('.advanced-options summary').click()
  await page.locator('textarea[name="providerOptions"]').fill('{"reasoningEffort":"low"}')
  await page.locator('#attachment-source').selectOption('url')

  assert.equal(await page.locator('#attachment-url-field').isVisible(), true)
  assert.equal(await page.locator('input[name="includeRaw"]').isVisible(), true)
  assert.equal(await page.locator('#cancel-button').isDisabled(), true)
})

test('shows streamed text in the browser', async ({ visit, assert }) => {
  ai.fake([
    { text: 'Visible streamed answer', chunks: ['Visible ', 'streamed ', 'answer'] },
  ]).preventStrayRequests()

  const page = await visit('/')
  await page.locator('#model').fill('test-model')
  await page.locator('#prompt').fill('Stream a visible answer')
  await page.locator('.advanced-options summary').click()
  await page.locator('input[name="includeRaw"]').check()
  await page.locator('#stream-button').click()
  await page.locator('#status').filter({ hasText: 'Complete' }).waitFor()

  assert.equal(await page.locator('#answer').textContent(), 'Visible streamed answer')
  assert.match((await page.locator('#events').textContent()) ?? '', /text\.delta/)
  assert.match((await page.locator('#raw').textContent()) ?? '', /Visible streamed answer/)
  assert.match((await page.locator('#request-inspector').textContent()) ?? '', /includeRaw/)
})
