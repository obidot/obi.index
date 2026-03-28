import { beforeEach, describe, expect, it } from "vitest";
import {
  observeDbQueryDurationMs,
  observePollDurationMs,
  recordEventsIndexed,
  recordReorgDetected,
  registerMetricsRoute,
  resetPrometheusMetrics,
  renderPrometheusMetrics,
} from "../src/metrics/prometheus.js";

beforeEach(() => {
  resetPrometheusMetrics();
});

describe("prometheus metrics", () => {
  it("renders event, poll, db, and reorg metrics in Prometheus text format", () => {
    recordEventsIndexed("Deposit", 2);
    recordEventsIndexed("Swapped");
    recordReorgDetected();
    observePollDurationMs(42);
    observeDbQueryDurationMs(7);

    const output = renderPrometheusMetrics();

    expect(output).toContain(
      'events_indexed_total{event_type="Deposit"} 2',
    );
    expect(output).toContain(
      'events_indexed_total{event_type="Swapped"} 1',
    );
    expect(output).toContain("reorg_detected_total 1");
    expect(output).toContain("poll_duration_ms_count 1");
    expect(output).toContain("poll_duration_ms_sum 42");
    expect(output).toContain("db_query_duration_ms_count 1");
    expect(output).toContain("db_query_duration_ms_sum 7");
  });

  it("registers a /metrics endpoint with text output", () => {
    let headerName: string | null = null;
    let headerValue: string | null = null;
    let statusCode: number | null = null;
    let body = "";

    const app = {
      get: (
        path: string,
        handler: (
          req: unknown,
          res: {
            setHeader: (name: string, value: string) => void;
            status: (code: number) => { send: (value: string) => void };
          },
        ) => void,
      ) => {
        expect(path).toBe("/metrics");

        handler(
          {},
          {
            setHeader: (name, value) => {
              headerName = name;
              headerValue = value;
            },
            status: (code) => {
              statusCode = code;
              return {
                send: (value) => {
                  body = value;
                },
              };
            },
          },
        );
      },
    };

    registerMetricsRoute(app);

    expect(headerName).toBe("Content-Type");
    expect(headerValue).toContain("text/plain");
    expect(statusCode).toBe(200);
    expect(body).toContain("# TYPE events_indexed_total counter");
  });
});
