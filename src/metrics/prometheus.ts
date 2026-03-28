type CounterKey = string;

interface HistogramState {
  buckets: number[];
  counts: number[];
  sum: number;
  count: number;
}

const EVENTS_INDEXED_TOTAL = new Map<CounterKey, number>();
const REORG_DETECTED_TOTAL = { value: 0 };
const POLL_DURATION_MS = createHistogram([25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000]);
const DB_QUERY_DURATION_MS = createHistogram([1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500]);

function createHistogram(buckets: number[]): HistogramState {
  return {
    buckets,
    counts: Array.from({ length: buckets.length + 1 }, () => 0),
    sum: 0,
    count: 0,
  };
}

function observeHistogram(state: HistogramState, value: number): void {
  state.sum += value;
  state.count += 1;

  let bucketIndex = state.buckets.findIndex((bucket) => value <= bucket);
  if (bucketIndex === -1) bucketIndex = state.counts.length - 1;

  for (let i = bucketIndex; i < state.counts.length; i += 1) {
    state.counts[i] += 1;
  }
}

function renderHistogram(name: string, help: string, state: HistogramState) {
  const lines = [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} histogram`,
  ];

  state.buckets.forEach((bucket, index) => {
    lines.push(`${name}_bucket{le="${bucket}"} ${state.counts[index]}`);
  });
  lines.push(`${name}_bucket{le="+Inf"} ${state.counts[state.counts.length - 1]}`);
  lines.push(`${name}_sum ${formatNumber(state.sum)}`);
  lines.push(`${name}_count ${state.count}`);
  return lines;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function formatLabelValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function recordEventsIndexed(eventType: string, count = 1): void {
  EVENTS_INDEXED_TOTAL.set(
    eventType,
    (EVENTS_INDEXED_TOTAL.get(eventType) ?? 0) + count,
  );
}

export function recordReorgDetected(count = 1): void {
  REORG_DETECTED_TOTAL.value += count;
}

export function observePollDurationMs(durationMs: number): void {
  observeHistogram(POLL_DURATION_MS, durationMs);
}

export function observeDbQueryDurationMs(durationMs: number): void {
  observeHistogram(DB_QUERY_DURATION_MS, durationMs);
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [];

  lines.push("# HELP events_indexed_total Total indexed events by event type");
  lines.push("# TYPE events_indexed_total counter");
  for (const [eventType, value] of [...EVENTS_INDEXED_TOTAL.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(
      `events_indexed_total{event_type="${formatLabelValue(eventType)}"} ${value}`,
    );
  }

  lines.push("# HELP reorg_detected_total Total reorgs detected by the indexer");
  lines.push("# TYPE reorg_detected_total counter");
  lines.push(`reorg_detected_total ${REORG_DETECTED_TOTAL.value}`);

  lines.push(
    ...renderHistogram(
      "poll_duration_ms",
      "Poll cycle duration in milliseconds",
      POLL_DURATION_MS,
    ),
  );
  lines.push(
    ...renderHistogram(
      "db_query_duration_ms",
      "Database query duration in milliseconds",
      DB_QUERY_DURATION_MS,
    ),
  );

  return `${lines.join("\n")}\n`;
}

export function resetPrometheusMetrics(): void {
  EVENTS_INDEXED_TOTAL.clear();
  REORG_DETECTED_TOTAL.value = 0;
  POLL_DURATION_MS.counts.fill(0);
  POLL_DURATION_MS.sum = 0;
  POLL_DURATION_MS.count = 0;
  DB_QUERY_DURATION_MS.counts.fill(0);
  DB_QUERY_DURATION_MS.sum = 0;
  DB_QUERY_DURATION_MS.count = 0;
}

export function registerMetricsRoute(app: {
  get: (
    path: string,
    handler: (
      req: unknown,
      res: {
        setHeader: (name: string, value: string) => void;
        status: (code: number) => { send: (body: string) => void };
      },
    ) => void | Promise<void>,
  ) => void;
}): void {
  app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.status(200).send(renderPrometheusMetrics());
  });
}
