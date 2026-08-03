# Conversations and files

## Message model

`UserContent` accepts the existing string prompt or an ordered array of text and file parts. A file source is explicitly one of non-empty `Uint8Array` bytes, validated base64, or an absolute HTTP(S) URL. Local paths and provider file IDs are intentionally not accepted.

OpenAI and Anthropic declare JPEG, PNG, GIF, WebP, and PDF support. Anthropic additionally declares plain-text documents. Gateway and custom `AiSdkProvider` instances are text-only unless their configuration supplies `attachments.images` and/or `attachments.documents`; entries may be exact MIME types or wildcards such as `image/*`.

Attachment shapes, MIME types, source values, and declared capabilities are checked before a provider request. Applications must enforce byte-size limits, authorize uploads, apply SSRF/URL policy, and decide how attachments become durable. Attachment bytes, base64, and full URLs are never included in events.

## Conversation ownership

`AiManager.useConversationStore` registers one application-owned persistence implementation. A run with `conversation: { id }` assembles messages in this order:

1. agent seed messages;
2. history returned by the store;
3. one-off `RunOptions.messages`;
4. the current user input.

Only the current successful turn is passed to `append`: the user input, assistant tool calls, tool results, and final assistant response. Seed, loaded, and one-off messages are never appended again. The store receives the run ID and abort signal, and is responsible for atomicity, transaction boundaries, concurrent writers, and any idempotency policy. The SDK calls `append` once and does not retry it.

Load failures stop before provider execution. Append failures occur after the model response is available internally but before `run.completed`; callers receive `ConversationPersistenceError` so loss of continuity cannot be missed. Failed, cancelled, refused structured, and maximum-step runs append nothing.

## Fakes and observability

Prompt records expose the normalized input, assembled message history, optional conversation ID, and safe attachment descriptors. Existing string `assertPrompted` matchers remain compatible; object matchers may add `conversationId`, a `messages` predicate, or an `attachment` descriptor.

Application events include conversation load, persist, and failure events. Run events include attachment count and descriptors containing only MIME type, optional filename, and source kind. With `includeContentInEvents`, text becomes visible as before, but attachment payloads and URLs remain redacted.

## Migration

No change is required for existing string prompts or string message histories. Custom `ProviderAdapter` implementations remain text-only until they add an optional `capabilities.attachments` declaration and translate `UserMessage.content` arrays. Code that previously assumed `Message` excluded tool messages should narrow on `message.role`; tool messages are now public so persisted tool-assisted history can be replayed exactly.
