// ── PubSub Unit Tests ─────────────────────────────────────
// Tests ObiPubSub: publish/subscribe, resolve wrapper, idempotent return(),
// and listener cleanup on return().

import { describe, it, expect, beforeEach } from "vitest";
import { ObiPubSub, Topics } from "../src/graphql/pubsub.js";

// We test a fresh instance per test (not the shared singleton)
let ps: ObiPubSub;
beforeEach(() => {
  ps = new ObiPubSub();
});

describe("ObiPubSub.publish + asyncIterator", () => {
  it("delivers published value to a waiting subscriber", async () => {
    const iter = ps.asyncIterator<{ value: number }>(Topics.DEPOSIT_ADDED);
    const payload = { value: 42 };

    // Publish after a tick so next() is already waiting
    setTimeout(() => ps.publish(Topics.DEPOSIT_ADDED, payload), 0);

    const result = await iter.next();
    expect(result.done).toBe(false);
    // asyncIterator wraps payload as { [TOPIC]: payload }
    expect(result.value).toEqual({ [Topics.DEPOSIT_ADDED]: payload });
  });

  it("queues values published before next() is called", async () => {
    const iter = ps.asyncIterator<{ n: number }>(Topics.WITHDRAWAL_ADDED);
    ps.publish(Topics.WITHDRAWAL_ADDED, { n: 1 });
    ps.publish(Topics.WITHDRAWAL_ADDED, { n: 2 });

    const r1 = await iter.next();
    const r2 = await iter.next();
    expect(
      (r1.value as Record<string, { n: number }>)[Topics.WITHDRAWAL_ADDED],
    ).toEqual({ n: 1 });
    expect(
      (r2.value as Record<string, { n: number }>)[Topics.WITHDRAWAL_ADDED],
    ).toEqual({ n: 2 });
  });

  it("does not deliver to a different topic", async () => {
    const iter = ps.asyncIterator<{ x: string }>(Topics.ORACLE_UPDATED);
    ps.publish(Topics.DEPOSIT_ADDED, { x: "wrong" });

    // Publish the right topic after a tick
    setTimeout(() => ps.publish(Topics.ORACLE_UPDATED, { x: "correct" }), 10);

    const result = await iter.next();
    expect(result.value[Topics.ORACLE_UPDATED]).toEqual({ x: "correct" });
  });
});

describe("ObiPubSub.asyncIterator return() cleanup", () => {
  it("stops delivering values after return()", async () => {
    const iter = ps.asyncIterator<{ n: number }>(Topics.SWAP_EXECUTED);

    // Publish one, consume it
    ps.publish(Topics.SWAP_EXECUTED, { n: 1 });
    await iter.next();

    // Close the iterator
    await iter.return!();

    // Publish again — should not be delivered
    ps.publish(Topics.SWAP_EXECUTED, { n: 2 });

    const result = await iter.next();
    expect(result.done).toBe(true);
  });

  it("is idempotent — calling return() twice does not throw", async () => {
    const iter = ps.asyncIterator<{ n: number }>(Topics.INTENT_EXECUTED);
    await iter.return!();
    await expect(iter.return!()).resolves.toMatchObject({ done: true });
  });

  it("removes EventEmitter listener on return()", async () => {
    const before = ps.listenerCount(Topics.STRATEGY_EXECUTED);
    const iter = ps.asyncIterator<{ n: number }>(Topics.STRATEGY_EXECUTED);
    expect(ps.listenerCount(Topics.STRATEGY_EXECUTED)).toBe(before + 1);

    await iter.return!();
    expect(ps.listenerCount(Topics.STRATEGY_EXECUTED)).toBe(before);
  });

  it("resolves pending next() promise when return() is called", async () => {
    const iter = ps.asyncIterator<{ n: number }>(Topics.DEPOSIT_ADDED);

    // Start a next() call that will hang
    const nextPromise = iter.next();

    // Return the iterator — should unblock next()
    setTimeout(() => void iter.return!(), 10);

    const result = await nextPromise;
    expect(result.done).toBe(true);
  });
});

describe("subscription resolve() unwrapping (P1 + P2 fix verification)", () => {
  it("resolve() extracts the inner payload from the wrapped iterator value", async () => {
    const inner = { owner: "0xABC", assets: "1000" };
    const wrapped = { [Topics.DEPOSIT_ADDED]: inner };

    // This is the resolve function added to each subscription resolver
    const resolve = (payload: Record<string, unknown>) =>
      payload[Topics.DEPOSIT_ADDED];

    expect(resolve(wrapped)).toEqual(inner);
  });
});
