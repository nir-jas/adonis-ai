import { test } from '@japa/runner'
import ai from 'adonis-ai/services/main'

test('shows streamed text in the browser', async ({ visit, assert }) => {
  ai.fake([
    { text: 'Visible streamed answer', chunks: ['Visible ', 'streamed ', 'answer'] },
  ]).preventStrayRequests()

  const page = await visit('/')
  await page.locator('#model').fill('test-model')
  await page.locator('#prompt').fill('Stream a visible answer')
  await page.locator('#stream-button').click()
  await page.locator('#status').filter({ hasText: 'Complete' }).waitFor()

  assert.equal(await page.locator('#answer').textContent(), 'Visible streamed answer')
  assert.match((await page.locator('#events').textContent()) ?? '', /text\.delta/)
})
