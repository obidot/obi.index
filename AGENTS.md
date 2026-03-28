# Package: obi.index

`obi.index` is the Obidot indexing and analytics backend. It polls Blockscout
for contract logs on Polkadot Hub TestNet, stores normalized state in Postgres
via Prisma, serves GraphQL over HTTP/WebSocket, and exposes health, metrics, and
materialized-analytics endpoints. The separate agent CLI in this repo is
optional; the main server process is the indexer/API.

## Runtime Summary

```text
Blockscout REST API
        ↓
   sync/blockscout.ts
        ↓
   sync/poller.ts   (15s poll interval, retry, reorg rewind/replay)
        ↓
 Prisma + PostgreSQL
        ↓
 GraphQL + HTTP endpoints
   - /graphql
   - /health
   - /metrics
   - /analytics/materialized
```

## Commands

```sh
npm install
npm run build
npm run dev
npm run start
npm run typecheck
npm run test
npm run test:coverage
npm run db:generate
npm run db:push
npm run db:migrate
npm run seed
npm run agent
```

## Main Responsibilities

1. Sync contract events from Blockscout into Postgres
2. Serve GraphQL queries and subscriptions to the app
3. Expose operational health and Prometheus metrics
4. Refresh materialized analytics views on a scheduler

## Current Indexed Surfaces

### Reliability and Operations

- 15s poll interval
- exponential backoff for Blockscout failures
- reorg detection in the recent indexed window
- automatic rewind and replay after divergence
- `GET /health`
- `GET /metrics`

### Analytics

- `protocolStats`
- `topRoutes(limit)`
- `poolAnalytics(pair, window)`
- `priceHistory(tokenIn, tokenOut, from, to)` with a 90-day cap
- materialized views for `SwapVolume24h`, `FeeRevenue24h`, and `UniqueTraders7d`
- `GET /analytics/materialized`
- `POST /analytics/materialized/refresh`

### Cross-Chain Tracking

- router lifecycle rows from `MessageDispatched`, `MessageReceived`, and `MessageTimeout`
- executor-level steps where local correlation is available
- local ISMP host receipts on Polkadot Hub
- local XCM precompile emission indexing
- GraphQL queries/subscriptions for `crossChainPipeline`, `crossChainPipelines`, and `crossChainStatus`

Current limitation: remote destination-host receipts still require additional
data sources beyond the single-chain Polkadot Hub Blockscout backend.

## Project Layout

```text
obi.index/
├── src/
│   ├── server.ts                  # Express + Apollo + graphql-ws bootstrap
│   ├── api/
│   │   ├── analytics.ts          # Materialized analytics endpoints
│   │   └── health.ts             # Health endpoint
│   ├── analytics/
│   │   └── materialized.ts       # Materialized view manager
│   ├── graphql/
│   │   ├── pubsub.ts
│   │   ├── resolvers.ts
│   │   └── typeDefs.ts
│   ├── metrics/
│   │   └── prometheus.ts
│   ├── sync/
│   │   ├── blockscout.ts
│   │   ├── poller.ts
│   │   ├── rpc.ts
│   │   └── handlers/
│   │       ├── crosschain.ts
│   │       ├── executor.ts
│   │       ├── liquidity.ts
│   │       ├── oracle.ts
│   │       ├── router.ts
│   │       └── vault.ts
│   └── agent/                    # Optional autonomous-analysis CLI
├── prisma/
│   └── schema.prisma
└── scripts/
```

## Stack

- TypeScript + tsx
- Prisma + PostgreSQL
- Apollo Server + Express
- `graphql-ws` subscriptions
- viem for ABI decode and chain reads
- Vitest for test coverage

## Verification Expectations

Run these before close-out:

```sh
npm run typecheck
npm run test
```

If you changed schema or analytics/materialization logic, also run the relevant
database and integration checks that apply to your change.

Keep the docs in `obidot/docs/` honest about two current realities:

- `priceHistory` is live, but still capped to a 90-day range.
- Cross-chain tracking is strongest for locally indexed Polkadot Hub lifecycle events; remote destination-host receipts are still not first-class indexed sources.
