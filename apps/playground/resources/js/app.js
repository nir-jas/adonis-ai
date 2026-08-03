const form = document.querySelector('#ai-form')

if (form) {
  const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? ''
  const answer = document.querySelector('#answer')
  const usage = document.querySelector('#usage')
  const steps = document.querySelector('#steps')
  const events = document.querySelector('#events')
  const raw = document.querySelector('#raw')
  const requestInspector = document.querySelector('#request-inspector')
  const errorBox = document.querySelector('#error')
  const status = document.querySelector('#status')
  const runButton = form.querySelector('button[type="submit"]')
  const streamButton = document.querySelector('#stream-button')
  const cancelButton = document.querySelector('#cancel-button')
  const prompt = document.querySelector('#prompt')
  const mode = document.querySelector('#mode')
  const conversationId = document.querySelector('#conversation-id')
  const attachmentSource = document.querySelector('#attachment-source')
  const attachmentFileField = document.querySelector('#attachment-file-field')
  const attachmentValueFields = document.querySelector('#attachment-value-fields')
  const attachmentUrlField = document.querySelector('#attachment-url-field')
  const attachmentBase64Field = document.querySelector('#attachment-base64-field')
  const attachmentBytesField = document.querySelector('#attachment-bytes-field')
  let activeController

  const pretty = (value) => JSON.stringify(value, null, 2)
  const setStatus = (label, state) => {
    status.textContent = label
    status.className = `status ${state}`
  }
  const setBusy = (busy) => {
    runButton.disabled = busy
    streamButton.disabled = busy
    cancelButton.disabled = !busy
  }
  const reset = () => {
    errorBox.hidden = true
    events.textContent = '—'
    usage.textContent = '—'
    steps.textContent = '—'
    raw.textContent = 'Enable “Include provider raw payloads” to inspect this field.'
  }
  const showError = (value) => {
    const details = value?.error ?? value
    errorBox.hidden = false
    errorBox.textContent = details?.message ?? 'The request failed.'
    setStatus('Failed', 'failed')
  }
  const showCancelled = () => {
    errorBox.hidden = true
    setStatus('Cancelled', 'cancelled')
  }

  const fileAsBase64 = async (file) => {
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return btoa(binary)
  }

  const payload = async () => {
    const formData = new FormData(form)
    const file = formData.get('attachmentFile')
    formData.delete('attachmentFile')
    const value = Object.fromEntries(formData.entries())
    value.includeRaw = formData.has('includeRaw')

    const sourceType = value.attachmentSource
    if (sourceType === 'upload') {
      if (!(file instanceof File) || file.size === 0) {
        throw new Error('Choose a file or select another attachment source.')
      }
      value.attachment = {
        sourceType: 'base64',
        base64: await fileAsBase64(file),
        filename: file.name,
        mediaType: file.type || 'application/octet-stream',
      }
    }
    if (sourceType === 'url') {
      value.attachment = {
        sourceType: 'url',
        url: value.attachmentUrl,
        filename: value.attachmentFilename,
        mediaType: value.attachmentMediaType,
      }
    }
    if (sourceType === 'base64') {
      value.attachment = {
        sourceType: 'base64',
        base64: value.attachmentBase64,
        filename: value.attachmentFilename,
        mediaType: value.attachmentMediaType,
      }
    }
    if (sourceType === 'bytes') {
      value.attachment = {
        sourceType: 'bytes',
        bytes: value.attachmentBytes,
        filename: value.attachmentFilename,
        mediaType: value.attachmentMediaType,
      }
    }

    delete value.attachmentSource
    delete value.attachmentUrl
    delete value.attachmentBase64
    delete value.attachmentBytes
    delete value.attachmentFilename
    delete value.attachmentMediaType
    return value
  }

  const safePayload = (value) => {
    const safe = { ...value }
    if (value.attachment) {
      safe.attachment = {
        sourceType: value.attachment.sourceType,
        mediaType: value.attachment.mediaType,
        ...(value.attachment.filename ? { filename: value.attachment.filename } : {}),
      }
      if (value.attachment.sourceType === 'url') {
        try {
          safe.attachment.host = new URL(value.attachment.url).hostname
        } catch {
          safe.attachment.host = '(invalid URL)'
        }
      }
    }
    if (!safe.messages) delete safe.messages
    if (!safe.providerOptions) delete safe.providerOptions
    return safe
  }

  const post = (path, body, signal) =>
    fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify(body),
      signal,
    })

  const showResponse = (result) => {
    answer.textContent = result.data ? pretty(result.data) : result.text
    usage.textContent = pretty({
      id: result.id,
      provider: result.provider,
      model: result.model,
      finishReason: result.finishReason,
      requestIds: result.requestIds,
      usage: result.usage,
    })
    steps.textContent = pretty({ steps: result.steps, toolCalls: result.toolCalls })
    raw.textContent = result.raw ? pretty(result.raw) : 'No raw payload was requested or returned.'
  }

  const updateAttachmentFields = () => {
    const source = attachmentSource.value
    attachmentFileField.hidden = source !== 'upload'
    attachmentValueFields.hidden = !['url', 'base64', 'bytes'].includes(source)
    attachmentUrlField.hidden = source !== 'url'
    attachmentBase64Field.hidden = source !== 'base64'
    attachmentBytesField.hidden = source !== 'bytes'
  }

  attachmentSource.addEventListener('change', updateAttachmentFields)
  updateAttachmentFields()

  mode.addEventListener('change', () => {
    if (mode.value === 'tool') prompt.value = 'What is the weather in Ahmedabad?'
    if (mode.value === 'structured') prompt.value = 'Summarize the advantages of AdonisJS.'
    if (mode.value === 'conversation') {
      prompt.value = 'Continue this conversation.'
      if (!conversationId.value) conversationId.value = 'demo-chat'
    }
    if (mode.value === 'attachment') {
      prompt.value = 'Describe the attached file.'
      attachmentSource.value = 'upload'
      updateAttachmentFields()
    }
    if (mode.value === 'chat') {
      prompt.value = 'Explain why async iterables are useful for AI streaming.'
    }
  })

  const startOperation = async (label) => {
    reset()
    answer.textContent = ''
    setStatus(label, 'running')
    setBusy(true)
    activeController = new AbortController()
    const body = await payload()
    requestInspector.textContent = pretty(safePayload(body))
    return { body, signal: activeController.signal }
  }

  const finishOperation = () => {
    activeController = undefined
    setBusy(false)
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()

    try {
      const operation = await startOperation('Running')
      const response = await post('/api/ai/run', operation.body, operation.signal)
      const result = await response.json()
      if (!response.ok) return showError(result)
      showResponse(result)
      events.textContent = 'Use “Stream response” to inspect normalized execution events.'
      setStatus('Complete', 'complete')
    } catch (error) {
      if (error?.name === 'AbortError') showCancelled()
      else showError(error)
    } finally {
      finishOperation()
    }
  })

  streamButton.addEventListener('click', async () => {
    events.textContent = ''

    try {
      const operation = await startOperation('Streaming')
      events.textContent = ''
      const response = await post('/api/ai/stream', operation.body, operation.signal)
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
            showResponse(data.response)
            setStatus('Complete', 'complete')
          }
          if (eventName === 'run.failed') showError(data)
        }
      }
    } catch (error) {
      if (error?.name === 'AbortError') showCancelled()
      else showError(error)
    } finally {
      finishOperation()
    }
  })

  cancelButton.addEventListener('click', () => activeController?.abort())
}
