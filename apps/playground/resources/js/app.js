const form = document.querySelector('#ai-form')

if (form) {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? ''
  const answer = document.querySelector('#answer')
  const usage = document.querySelector('#usage')
  const steps = document.querySelector('#steps')
  const events = document.querySelector('#events')
  const errorBox = document.querySelector('#error')
  const status = document.querySelector('#status')
  const streamButton = document.querySelector('#stream-button')
  const prompt = document.querySelector('#prompt')
  const mode = document.querySelector('#mode')

  const payload = async () => {
    const formData = new FormData(form)
    const file = formData.get('attachmentFile')
    formData.delete('attachmentFile')
    const value = Object.fromEntries(formData.entries())
    if (file instanceof File && file.size > 0) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      value.attachment = {
        base64: btoa(binary),
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
      }
    }
    return value
  }
  const pretty = (value) => JSON.stringify(value, null, 2)
  const setStatus = (label, state) => {
    status.textContent = label
    status.className = `status ${state}`
  }
  const reset = () => {
    errorBox.hidden = true
    events.textContent = '—'
    usage.textContent = '—'
    steps.textContent = '—'
  }
  const showError = (value) => {
    const details = value?.error ?? value
    errorBox.hidden = false
    errorBox.textContent = details?.message ?? 'The request failed.'
    setStatus('Failed', 'failed')
  }
  const post = async (path) =>
    fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(await payload()),
    })

  mode.addEventListener('change', () => {
    if (mode.value === 'tool') prompt.value = 'What is the weather in Ahmedabad?'
    if (mode.value === 'structured') prompt.value = 'Summarize the advantages of AdonisJS.'
    if (mode.value === 'conversation') prompt.value = 'Continue this conversation.'
    if (mode.value === 'attachment') prompt.value = 'Describe the attached file.'
    if (mode.value === 'chat') {
      prompt.value = 'Explain why async iterables are useful for AI streaming.'
    }
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    reset()
    answer.textContent = ''
    setStatus('Running', 'running')

    try {
      const response = await post('/api/ai/run')
      const result = await response.json()
      if (!response.ok) return showError(result)
      answer.textContent = result.data ? pretty(result.data) : result.text
      usage.textContent = pretty({
        provider: result.provider,
        model: result.model,
        finishReason: result.finishReason,
        ...result.usage,
      })
      steps.textContent = pretty(result.steps)
      setStatus('Complete', 'complete')
    } catch (error) {
      showError(error)
    }
  })

  streamButton.addEventListener('click', async () => {
    reset()
    answer.textContent = ''
    events.textContent = ''
    setStatus('Streaming', 'running')

    try {
      const response = await post('/api/ai/stream')
      if (!response.ok || !response.body) return showError(await response.json())
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''

        for (const frame of frames) {
          const eventName = frame.match(/^event: (.+)$/m)?.[1]
          const rawData = frame.match(/^data: (.+)$/m)?.[1]
          if (!eventName || !rawData) continue
          const data = JSON.parse(rawData)
          events.textContent += `${eventName} ${pretty(data)}\n`
          if (eventName === 'text.delta') answer.textContent += data.delta
          if (eventName === 'run.completed') {
            usage.textContent = pretty(data.response.usage)
            steps.textContent = pretty(data.response.steps)
            setStatus('Complete', 'complete')
          }
          if (eventName === 'run.failed') showError(data)
        }
      }
    } catch (error) {
      showError(error)
    }
  })
}
