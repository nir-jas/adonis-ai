import { Readable } from "node:stream";
import { AbortedRequestError } from "./errors.js";
import type { AgentResponse, AgentStreamEvent } from "./types.js";

interface PendingRead<T> {
  resolve(value: IteratorResult<T>): void;
  reject(reason: unknown): void;
}

export interface AgentStreamController<TOutput> {
  emit(event: AgentStreamEvent<TOutput>): void;
  signal: AbortSignal;
}

export class AgentStream<TOutput = undefined>
  implements
    AsyncIterable<AgentStreamEvent<TOutput>>,
    AsyncIterator<AgentStreamEvent<TOutput>>
{
  #events: AgentStreamEvent<TOutput>[] = [];
  #reads: PendingRead<AgentStreamEvent<TOutput>>[] = [];
  #done = false;
  #error: unknown;
  #abortController = new AbortController();
  #final: Promise<AgentResponse<TOutput>>;

  constructor(
    executor: (
      controller: AgentStreamController<TOutput>,
    ) => Promise<AgentResponse<TOutput>>,
    parentSignal?: AbortSignal,
  ) {
    if (parentSignal) {
      if (parentSignal.aborted)
        this.#abortController.abort(parentSignal.reason);
      else {
        parentSignal.addEventListener(
          "abort",
          () => this.#abortController.abort(parentSignal.reason),
          { once: true },
        );
      }
    }

    this.#final = Promise.resolve()
      .then(() =>
        executor({
          emit: (event) => this.#push(event),
          signal: this.#abortController.signal,
        }),
      )
      .then(
        (response) => {
          this.#close();
          return response;
        },
        (error) => {
          this.#fail(error);
          throw error;
        },
      );
    void this.#final.catch(() => {
      // Iteration may be the only error-consumption path. Keep finalResponse()
      // rejectable without creating a second unhandled rejection.
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentStreamEvent<TOutput>> {
    return this;
  }

  next(): Promise<IteratorResult<AgentStreamEvent<TOutput>>> {
    const event = this.#events.shift();
    if (event) return Promise.resolve({ done: false, value: event });
    if (this.#error) return Promise.reject(this.#error);
    if (this.#done) return Promise.resolve({ done: true, value: undefined });

    return new Promise((resolve, reject) => {
      this.#reads.push({ resolve, reject });
    });
  }

  async return(): Promise<IteratorResult<AgentStreamEvent<TOutput>>> {
    this.abort();
    this.#close();
    return { done: true, value: undefined };
  }

  abort(reason: unknown = new AbortedRequestError()): void {
    if (!this.#abortController.signal.aborted)
      this.#abortController.abort(reason);
  }

  finalResponse(): Promise<AgentResponse<TOutput>> {
    return this.#final;
  }

  toSseReadable(): Readable {
    const stream = this;
    const readable = Readable.from(
      (async function* () {
        for await (const event of stream) {
          yield `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        }
      })(),
    );
    readable.once("close", () => stream.abort());
    readable.once("error", (error) => stream.abort(error));
    return readable;
  }

  #push(event: AgentStreamEvent<TOutput>): void {
    if (this.#done) return;
    const read = this.#reads.shift();
    if (read) read.resolve({ done: false, value: event });
    else this.#events.push(event);
  }

  #close(): void {
    if (this.#done) return;
    this.#done = true;
    for (const read of this.#reads.splice(0)) {
      read.resolve({ done: true, value: undefined });
    }
  }

  #fail(error: unknown): void {
    if (this.#done) return;
    this.#error = error;
    this.#done = true;
    for (const read of this.#reads.splice(0)) read.reject(error);
  }
}
