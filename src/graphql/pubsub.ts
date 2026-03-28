// ── GraphQL PubSub Singleton ──────────────────────────────
// Shared event bus for GraphQL subscriptions.
// Emitted from event handlers; consumed by Apollo subscription resolvers.

import { EventEmitter } from "node:events";

// ─────────────────────────────────────────────────────────────────────────────
//  Topics
// ─────────────────────────────────────────────────────────────────────────────

export const Topics = {
  DEPOSIT_ADDED: "DEPOSIT_ADDED",
  WITHDRAWAL_ADDED: "WITHDRAWAL_ADDED",
  STRATEGY_EXECUTED: "STRATEGY_EXECUTED",
  INTENT_EXECUTED: "INTENT_EXECUTED",
  ORACLE_UPDATED: "ORACLE_UPDATED",
  SWAP_EXECUTED: "SWAP_EXECUTED",
  CROSS_CHAIN_STATUS: "CROSS_CHAIN_STATUS",
  LP_MINT: "LP_MINT",
  LP_BURN: "LP_BURN",
} as const;

export type Topic = (typeof Topics)[keyof typeof Topics];

// ─────────────────────────────────────────────────────────────────────────────
//  Typed emitter
// ─────────────────────────────────────────────────────────────────────────────

export class ObiPubSub extends EventEmitter {
  publish<T>(topic: Topic, payload: T): void {
    this.emit(topic, payload);
  }

  /**
   * Returns an async iterator compatible with Apollo Server subscriptions.
   * Each value is wrapped in { [topic]: payload } to match the resolver shape.
   */
  asyncIterator<T>(topic: Topic): AsyncIterator<{ [key: string]: T }> {
    const emitter = this;
    const queue: { [key: string]: T }[] = [];
    let resolve:
      | ((value: IteratorResult<{ [key: string]: T }>) => void)
      | null = null;
    let done = false;

    const listener = (payload: T): void => {
      const wrapped = { [topic]: payload } as { [key: string]: T };
      if (resolve) {
        const r = resolve;
        resolve = null;
        r({ value: wrapped, done: false });
      } else {
        queue.push(wrapped);
      }
    };

    emitter.on(topic, listener);

    const iterator: AsyncIterator<{ [key: string]: T }> = {
      next(): Promise<IteratorResult<{ [key: string]: T }>> {
        if (done)
          return Promise.resolve({
            value: undefined as unknown as { [key: string]: T },
            done: true,
          });
        if (queue.length > 0) {
          return Promise.resolve({ value: queue.shift()!, done: false });
        }
        return new Promise((r) => {
          resolve = r;
        });
      },
      return(): Promise<IteratorResult<{ [key: string]: T }>> {
        if (!done) {
          done = true;
          emitter.removeListener(topic, listener);
          // Resolve any pending next() call so it doesn't hang
          if (resolve) {
            const r = resolve;
            resolve = null;
            r({
              value: undefined as unknown as { [key: string]: T },
              done: true,
            });
          }
        }
        return Promise.resolve({
          value: undefined as unknown as { [key: string]: T },
          done: true,
        });
      },
      throw(err?: unknown): Promise<IteratorResult<{ [key: string]: T }>> {
        if (!done) {
          done = true;
          emitter.removeListener(topic, listener);
        }
        return Promise.reject(err);
      },
    };

    // Make it a valid async iterable (graphql-ws expects Symbol.asyncIterator)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (iterator as any)[Symbol.asyncIterator] = () => iterator;
    return iterator;
  }
}

export const pubsub = new ObiPubSub();
pubsub.setMaxListeners(50);
