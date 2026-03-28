import { describe, expect, it } from "vitest";
import { buildHealthPayload } from "../src/api/health.js";

describe("buildHealthPayload", () => {
  it("returns ok when db, poller, and blockscout are healthy", () => {
    const payload = buildHealthPayload({
      now: 10_000,
      dbConnected: true,
      lastIndexedBlock: 123_456,
      poller: {
        active: true,
        inFlight: false,
        lastPollStartedAt: 8_000,
        lastPollCompletedAt: 9_000,
        lastPollDurationMs: 250,
        lastPollError: null,
        lastPollTotalEvents: 12,
        lastPollSkippedCount: 0,
      },
      blockscout: {
        lastSuccessAt: 9_500,
        lastFailureAt: null,
        lastError: null,
        consecutiveFailures: 0,
        lastStatusCode: 200,
        lastRetryCount: 1,
      },
    });

    expect(payload.status).toBe("ok");
    expect(payload.pollerLagMs).toBe(1_000);
    expect(payload.lastIndexedBlock).toBe(123_456);
    expect(payload.pollerRunning).toBe(true);
  });

  it("returns degraded when the db is unavailable", () => {
    const payload = buildHealthPayload({
      now: 10_000,
      dbConnected: false,
      lastIndexedBlock: null,
      poller: {
        active: true,
        inFlight: true,
        lastPollStartedAt: 9_800,
        lastPollCompletedAt: null,
        lastPollDurationMs: null,
        lastPollError: null,
        lastPollTotalEvents: null,
        lastPollSkippedCount: 1,
      },
      blockscout: {
        lastSuccessAt: null,
        lastFailureAt: 9_700,
        lastError: "timeout",
        consecutiveFailures: 2,
        lastStatusCode: 504,
        lastRetryCount: 3,
      },
    });

    expect(payload.status).toBe("degraded");
    expect(payload.pollerLagMs).toBe(200);
    expect(payload.blockscout.consecutiveFailures).toBe(2);
  });
});
