# Package: obi.index

Obidot indexer + AI agent. TypeScript backend that indexes all Obidot smart-contract events from Polkadot Hub TestNet into PostgreSQL via the Blockscout REST API (because `eth_getLogs` is broken on PolkaVM), exposes a GraphQL API on port 4350, and runs an autonomous AI agent that evaluates yield strategies and submits signed EIP-712 intents on-chain.

## System Overview

`obi.index` is a purpose-built indexer for the Obidot DEX aggregator on Polkadot Hub. It has three responsibilities:

1. **Sync** — Polls Blockscout REST API every 60 seconds for event logs across all 10 deployed contracts. Decodes logs via viem ABI. Writes historical records and current-state snapshots to PostgreSQL via Prisma.
2. **Serve** — Apollo Server 4 GraphQL API on port 4350 with queries for vault state, oracle prices, deposits, withdrawals, strategies, swaps, intents, cross-chain messages, and user positions.
3. **Agent** — AI-driven orchestrator runs on a 5-minute loop: evaluates yield opportunities and arbitrage from on-chain data, sends a state snapshot to an LLM for analysis, then builds and submits a signed EIP-712 `UniversalIntent` to `ObidotVault.executeIntent()` when confidence ≥ 60%.

### Why Blockscout (Not RPC)?

PolkaVM (`pallet-revive`) does not correctly implement `eth_getLogs`. Logs from contracts are not returned by the standard JSON-RPC endpoint. The only reliable way to fetch historical event logs is the **Blockscout REST API** (`GET /api/v2/addresses/{address}/logs`). State reads (current values) still use `eth_call` via the RPC endpoint — that works fine.

### Data Flow

```
Polkadot Hub TestNet (chain 420420417)
        │
        │  Blockscout REST API
        │  GET /api/v2/addresses/{addr}/logs  (every 60s)
        ▼
  src/sync/blockscout.ts  (HTTP fetch + pagination)
        │
        ▼
  src/sync/decoder.ts  (viem decodeEventLog)
        │
        ├── handleVaultEvent     → deposits, withdrawals, strategies, intents, config
        ├── handleOracleEvent    → oracle_updates, oracle_state
        ├── handleRouterEvent    → swap_executions
        ├── handleCrossChainEvent→ cross_chain_dispatches
        ├── handleExecutorEvent  → logs only (correlated via tx)
        └── handleBifrostEvent   → bifrost_strategies
        │
        ▼
  PostgreSQL 15  (via Prisma ORM)
        │
        ▼
  Apollo Server 4  (GraphQL, port 4350)

  src/sync/rpc.ts  (eth_call for current state)
        │
        └── readVaultState(), readOracleState()  → VaultState, OracleState (every cycle)

  src/agent/orchestrator.ts  (every 5 min)
        │
        ├── StrategyEvaluator  → reads DB, finds idle capital / price moves
        ├── ArbitrageDetector  → scans swap_executions for cross-pool spreads
        ├── LLMAnalyzer        → sends snapshot to LLM (OpenRouter/OpenAI/Anthropic)
        ├── IntentBuilder      → builds UniversalIntent struct
        ├── IntentSigner       → signTypedData (EIP-712)
        └── TransactionExecutor→ sendTransaction → ObidotVault.executeIntent()
```

## Commands

```sh
# Install
npm install

# Generate Prisma client (after schema changes)
npm run db:generate

# Push schema to database (dev/testnet)
npm run db:push

# Run migrations
npm run db:migrate

# Start GraphQL server + poller (dev, with hot reload)
npm run dev

# Build (TypeScript → dist/)
npm run build

# Start compiled server (production)
npm start

# Type check (must pass — zero errors required)
npm run typecheck

# Backfill all historical events from Blockscout
npm run seed

# Start AI agent (separate process from server)
npm run agent

# Start PostgreSQL
npm run docker:up
npm run docker:down
```

## Tech Stack

| Component     | Version | Purpose                                            |
| ------------- | ------- | -------------------------------------------------- |
| TypeScript    | 5.7     | Language — strict mode, ESNext, bundler resolution |
| Apollo Server | 4.x     | GraphQL API server (standalone, port 4350)         |
| Prisma ORM    | 6.x     | Database access layer, schema management           |
| PostgreSQL    | 15      | Persistent storage (Docker Compose)                |
| viem          | 2.x     | EVM ABI decoding + eth_call + transaction signing  |
| pino          | 9.x     | Structured JSON logger (pino-pretty in dev)        |
| dotenv        | 16.x    | Environment variable loading                       |
| zod           | 3.x     | Schema validation                                  |
| tsx           | 4.x     | TypeScript execution (dev + scripts)               |

## Project Layout

```
obi.index/
├── docker-compose.yml          # PostgreSQL 15 service
├── .env.example                # All env variables with comments
├── package.json                # Scripts, dependencies
├── tsconfig.json               # strict, ESNext, bundler, rootDir=src
├── prisma/
│   └── schema.prisma           # 16 Prisma models
├── scripts/
│   └── seed.ts                 # Backfill: fetch all logs from block 0
└── src/
    ├── server.ts               # Entry: Apollo Server + Poller startup + graceful shutdown
    ├── config/
    │   ├── constants.ts        # CHAIN_ID, RPC_URL, BLOCKSCOUT_URL, GRAPHQL_PORT, etc.
    │   └── contracts.ts        # ADDRESSES, ABI fragments, CONTRACT_REGISTRY[]
    ├── sync/
    │   ├── blockscout.ts       # fetchLogs(address, fromBlock) — Blockscout REST client
    │   ├── rpc.ts              # readVaultState(), readOracleState() — viem eth_call
    │   ├── decoder.ts          # decodeLog(log, abi, name) → DecodedEvent | null
    │   ├── poller.ts           # Poller class — 60s setInterval, cursor management
    │   └── handlers/
    │       ├── vault.ts        # ERC4626 + ObidotVault events → Prisma writes
    │       ├── oracle.ts       # KeeperOracle + OracleRegistry events
    │       ├── router.ts       # SwapRouter Swapped/AdapterSet events
    │       ├── crosschain.ts   # CrossChainRouter + HyperbridgeAdapter events
    │       └── executor.ts     # XCMExecutor + HyperExecutor + BifrostAdapter
    ├── graphql/
    │   ├── typeDefs.ts         # GraphQL SDL (all types, queries)
    │   └── resolvers.ts        # Resolvers — all query handlers with Prisma
    ├── agent/
    │   ├── index.ts            # CLI entry: connects DB, starts Orchestrator
    │   ├── orchestrator.ts     # 5-min loop: evaluate → analyze → build → sign → execute
    │   ├── strategy/
    │   │   ├── evaluator.ts    # StrategyEvaluator — yield gap, idle capital detection
    │   │   └── arbitrage.ts    # ArbitrageDetector — cross-pool spread scanning
    │   ├── intent/
    │   │   ├── builder.ts      # buildIntent() — UniversalIntent struct + INTENT_DOMAIN/TYPES
    │   │   └── signer.ts       # signIntent() — EIP-712 signTypedData via viem privateKeyToAccount
    │   ├── executor/
    │   │   └── transaction.ts  # TransactionExecutor — executeIntent() on-chain
    │   └── llm/
    │       ├── provider.ts     # LLMProvider interface + createLLMProvider() factory
    │       ├── openrouter.ts   # OpenRouter API provider
    │       ├── openai.ts       # OpenAI-compatible provider (OpenAI, Anthropic, Azure)
    │       └── analyzer.ts     # LLMAnalyzer — state snapshot → AnalysisResult JSON
    └── utils/
        └── logger.ts           # pino singleton (pino-pretty in dev)
```

## Prisma Schema (16 Models)

### State Tables (4) — Current snapshot, upserted on each event

| Model             | Primary Key   | Purpose                                      |
| ----------------- | ------------- | -------------------------------------------- |
| `VaultState`      | `"singleton"` | Live vault stats (totalAssets, paused, caps) |
| `OracleState`     | `feedAddress` | Current price per feed (DOT/USD, etc.)       |
| `ProtocolConfig`  | `protocol`    | Protocol whitelist + exposure caps           |
| `ParachainConfig` | `parachainId` | Parachain whitelist (e.g., Bifrost 2030)     |

### Historical Tables (10) — Append-only, unique on (txHash, logIndex)

| Model                | Source Event(s)                                         |
| -------------------- | ------------------------------------------------------- |
| `Deposit`            | ERC4626 `Deposit`                                       |
| `Withdrawal`         | ERC4626 `Withdraw`                                      |
| `WithdrawalRequest`  | `WithdrawalQueued` / `WithdrawalFulfilled`              |
| `StrategyExecution`  | `StrategyExecuted` / `StrategyOutcomeReported`          |
| `LocalSwap`          | `LocalSwapExecuted`                                     |
| `IntentExecution`    | `IntentExecuted`                                        |
| `OracleUpdate`       | `PriceUpdated`                                          |
| `SwapExecution`      | SwapRouter `Swapped`                                    |
| `CrossChainDispatch` | `MessageDispatched` / `SatelliteDepositReceived` / etc. |
| `BifrostStrategy`    | `BifrostStrategyDispatched`                             |

### Infrastructure (2)

| Model        | Purpose                                                 |
| ------------ | ------------------------------------------------------- |
| `SyncCursor` | Last indexed block per contract (resumes after restart) |
| `Token`      | ERC-20 metadata cache (symbol, name, decimals)          |

## Contract Registry (10 Contracts Indexed)

All addresses are on **Polkadot Hub TestNet** (chain `420420417`).

| Contract Name    | Address                                      | Phase |
| ---------------- | -------------------------------------------- | ----- |
| KeeperOracle     | `0xf64d93DC125AC1B366532BBbA165615f6D566C7F` | 1     |
| OracleRegistry   | `0x8b7C7345d6cF9de45f4aacC61F56F0241d47e88B` | 1     |
| BifrostAdapter   | `0x265Cb785De0fF2e5BcebDEb53095aDCAE9175527` | 1     |
| XCMExecutor      | `0x011b6FAf32370dCF92a452374FfCfCdbfA20278c` | 9     |
| NativeAssetDOT   | `0xE72453bD8d5ECF56ccdDeF949C8AE0Cea5A41E7d` | 2     |
| NativeAssetUSDC  | `0xAf233E9f2ED78022CAdEA58a84144ce6BcDFd63E` | 2     |
| SwapRouter       | `0x60a72d1e20c5dc40Bb5a24394f0583d863201A3c` | 17    |
| CrossChainRouter | `0xE2fFfb3B5C72f99811bC20D857035611bFCe5b5d` | 7     |
| HyperExecutor    | `0x62919Cb6416Cb919fC4A30c5707a7867Ca874ca6` | 10    |
| ObidotVault      | `0x03473a95971Ba0496786a615e21b1e87bDFf0025` | 8     |

**Not indexed (no events):** SwapQuoter (read-only), HydrationOmnipoolAdapter, AssetHubPairAdapter, BifrostDEXAdapter (adapter events route through SwapRouter).

## GraphQL API (port 4350)

All queries are read-only. Pagination via `limit` (default 50, max 500) and `offset`.

```graphql
# State
vaultState                                       # Live vault snapshot
oracleState(feedAddress: String)                 # Single feed
oracleStates                                     # All feeds
protocolConfigs                                  # Protocol whitelist
parachainConfigs                                 # Parachain whitelist

# Historical (all support limit/offset)
deposits(owner: String)
withdrawals(owner: String)
withdrawalRequests(user: String, fulfilled: Boolean)
strategyExecutions(executor: String)
localSwaps
intentExecutions(solver: String)
oracleUpdates(feed: String)
swapExecutions
crossChainDispatches(status: String)
bifrostStrategies

# Aggregates
vaultStats                                       # Counts of all event types
userPosition(address: String!)                   # Sum of deposits/withdrawals + pending requests

# Infrastructure
syncCursors                                      # Last indexed block per contract
tokens                                           # ERC-20 metadata
```

## AI Agent Architecture

### Loop (every 5 minutes)

1. **Evaluate** (`StrategyEvaluator`) — reads DB, identifies idle capital ratio and price move opportunities
2. **Arbitrage** (`ArbitrageDetector`) — scans recent `SwapExecution` records for cross-pool price spreads > 50 bps
3. **Snapshot** — serializes vault state, oracle prices, allowed protocols/parachains, recent strategies to JSON
4. **Analyze** (`LLMAnalyzer`) — sends snapshot to LLM with system prompt; expects JSON back with `{recommendation, confidence, reasoning, suggestedAction}`
5. **Execute** — if `confidence >= 60` and `recommendation != "hold"`: builds `UniversalIntent`, signs EIP-712 with agent private key, calls `ObidotVault.executeIntent(intent, signature)`

### LLM Providers

Configured via `LLM_PROVIDER` env var:

- `openrouter` (default) — `https://openrouter.ai/api/v1/chat/completions`
- `openai` — `https://api.openai.com/v1/chat/completions`
- `anthropic` — uses OpenAI-compatible endpoint

Model set via `LLM_MODEL` (default: `anthropic/claude-sonnet-4`).

### Intent Signing (EIP-712)

The agent uses `viem`'s `privateKeyToAccount` + `signTypedData` to sign `UniversalIntent` structs with:

- **Domain:** `{ name: "ObidotVault", version: "1", chainId: 420420417, verifyingContract: ObidotVault }`
- **Type:** `UniversalIntent` — 10 fields matching `src/intent/IntentTypes.sol` in `obi.router`
- **Submission:** `ObidotVault.executeIntent(intent, signature)` — vault verifies EIP-712 sig on-chain

## Environment Variables

```sh
# Required
DATABASE_URL="postgresql://obidot:obidot@localhost:5432/obidot_index"
AGENT_PRIVATE_KEY=""       # 0x-prefixed — required for agent (SOLVER_ROLE on vault)

# Optional (defaults shown)
CHAIN_ID=420420417
RPC_URL="https://eth-rpc-testnet.polkadot.io/"
BLOCKSCOUT_URL="https://blockscout-testnet.polkadot.io"
PORT=4350
POLL_INTERVAL_MS=60000     # 60 seconds
START_BLOCK=0
LLM_PROVIDER="openrouter"  # openrouter | openai | anthropic
LLM_API_KEY=""
LLM_MODEL="anthropic/claude-sonnet-4"
LOG_LEVEL="info"           # trace | debug | info | warn | error | fatal
```

## Code Style

### TypeScript

- Strict mode, ESNext target, `moduleResolution: bundler`
- Named imports only: `import { Foo } from "./foo.js"` — always `.js` extension (ESM)
- `as const satisfies Abi` for ABI arrays
- `BigInt` for all on-chain numeric types — never `Number` for uint256
- All public-facing functions have JSDoc `/** ... */` comments
- No `any` — use `unknown` + type guards
- `noUnusedLocals`, `noUnusedParameters` enforced — check with `npm run typecheck`

### Prisma

- `upsert` with `where: { txHash_logIndex: ... }` for all historical records (idempotent indexing)
- State tables always `upsert` (never `create` alone) — handles restart/resync
- `SyncCursor` updated after every batch — enables resumable sync

### Events

- All event args are `string` when stored in DB (uint256 → string to avoid BigInt overflow)
- Timestamps stored as `DateTime` (converted from Blockscout ISO 8601 string)
- Always filter `fromBlock: cursor.lastBlock + 1` to avoid reprocessing

### Blockscout Pagination

`GET /api/v2/addresses/{addr}/logs` returns at most ~50 items per page. Always loop on `next_page_params` until null. The `fetchLogs()` function handles this with a `maxPages` safety limit (50 default, 200 for seed).

### Adding a New Contract

1. Add ABI fragments to `src/config/contracts.ts`
2. Add address to `ADDRESSES`
3. Add entry to `CONTRACT_REGISTRY`
4. Add handler function in `src/sync/handlers/`
5. Add entry to `HANDLER_MAP` in `src/sync/poller.ts`
6. Run `npm run seed` to backfill historical logs

## PR Instructions

- Branch/title format: `[obi.index] <Title>`
- Run `npm run typecheck` before committing — zero errors required
- Run `npm run build` to verify compilation
- Run `npm test` — 31 tests across 4 suites must pass (pubsub, decoder, handlers, blockscout)
- Update `.env.example` when adding new environment variables
- Update `AGENTS.md` when adding new contracts, models, or agent capabilities

## Bug Fixes Applied (Phase 3)

| Bug                                                                                                                    | File(s)                                                      | Fix                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **O1** — `StrategyOutcomeReported` had no `strategyId` filter, updated all executions                                  | `prisma/schema.prisma`, `src/sync/handlers/vault.ts`         | Added `strategyId String` field to `StrategyExecution` model; `StrategyExecuted` handler now stores `strategyId`; `StrategyOutcomeReported` handler filters `updateMany` by `strategyId` |
| **O3** — Stale contract addresses (XCMExecutor, HyperExecutor, SwapRouter)                                             | `src/config/contracts.ts`                                    | Synced to canonical addresses from `obi-kit`; added `SwapQuoter` and `HydrationOmnipoolAdapter`                                                                                          |
| **P1** — `asyncIterator` wrapped payload as `{ [TOPIC]: payload }` but resolvers had no `resolve()` to unwrap          | `src/graphql/pubsub.ts`, `src/graphql/resolvers.ts`          | `ObiPubSub` class exported; all 6 subscription resolvers now have `resolve: (payload) => payload[Topics.X]` to unwrap the iterator value before sending to the client                    |
| **P2** — All 6 subscription resolvers missing `resolve()` function                                                     | `src/graphql/resolvers.ts`                                   | Added `resolve()` to all 6 resolvers (paired with P1 fix)                                                                                                                                |
| **P3** — Iterator `return()` was not idempotent; pending `next()` promise not resolved on `return()`                   | `src/graphql/pubsub.ts`, `src/server.ts`                     | `return()` guards on `done` flag; pending `next()` promise resolved on `return()`; `useServer` `onComplete` callback added in `server.ts`                                                |
| **P4** — `oracle.ts` never published to `Topics.ORACLE_UPDATED`; `router.ts` never published to `Topics.SWAP_EXECUTED` | `src/sync/handlers/oracle.ts`, `src/sync/handlers/router.ts` | Added `pubsub.publish(Topics.ORACLE_UPDATED, ...)` after `PriceUpdated` oracleState upsert; added `pubsub.publish(Topics.SWAP_EXECUTED, ...)` after `Swapped` swapExecution upsert       |

### Testing (added in Phase 3)

Test runner: **vitest** (`npm test` — 31 tests, 4 suites)

| Suite      | File                      | What it tests                                                                                                                                     |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| PubSub     | `test/pubsub.test.ts`     | publish/subscribe delivery, queue, topic isolation, `return()` idempotency, listener cleanup, pending `next()` resolution, `resolve()` unwrapping |
| Decoder    | `test/decoder.test.ts`    | `decodeLog` / `decodeLogs` against real ABI fragments (Deposit, Swapped, null cases)                                                              |
| Handlers   | `test/handlers.test.ts`   | All event handlers with mock Prisma — `strategyId` filter fix, `IntentExecuted`, oracle state, swap execution, unknown pool types                 |
| Blockscout | `test/blockscout.test.ts` | `fetchLogs` with mocked `fetch` — single page, fromBlock filter, pagination stop, error handling, multi-page                                      |
