# Obidot — obi.index

TypeScript indexer and AI agent backend for **Obidot**, the first DEX aggregator on Polkadot Hub. Indexes all Obidot smart-contract events from Polkadot Hub TestNet, exposes a GraphQL API, and runs an autonomous AI agent that evaluates on-chain yield opportunities and submits signed EIP-712 intents directly on-chain.

---

## What obi.index Does

`obi.index` is the backend data layer for the Obidot DEX aggregator. It has three responsibilities:

1. **Index** — Polls the Blockscout REST API every 60 seconds for event logs across all 9 deployed Obidot contracts. Decodes logs via viem ABI decoding. Writes historical records and live state snapshots to PostgreSQL via Prisma ORM.

2. **Serve** — Apollo Server 4 GraphQL API on port 4350 with read-only queries for vault state, oracle prices, deposits, withdrawals, strategies, swap executions, intents, cross-chain messages, and user positions.

3. **Agent** — Autonomous AI agent runs on a 5-minute loop: evaluates yield opportunities and arbitrage from indexed on-chain data, sends a snapshot to a configurable LLM (OpenRouter, OpenAI, Anthropic), then builds and submits a signed EIP-712 `UniversalIntent` to `ObidotVault.executeIntent()` when confidence ≥ 60%.

> **Note:** The autonomous AI agent is a sub-feature of Obidot. The main product is the DEX aggregator protocol itself (`obi.router`).

### Why Blockscout (Not RPC)?

PolkaVM (`pallet-revive`) does not correctly implement `eth_getLogs` — logs from contracts are not returned by the standard JSON-RPC endpoint. The only reliable way to fetch historical event logs is the **Blockscout REST API** (`GET /api/v2/addresses/{address}/logs`). Current state reads (`eth_call`) still use the RPC endpoint directly — that works fine.

---

## Key Features

| Feature                   | Description                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| **Event Indexer**         | Polls Blockscout REST API every 60s across 9 contracts; resumes from cursor after restart        |
| **GraphQL API**           | Apollo Server 4 on port 4350 — 16 queries covering all vault, oracle, swap, and cross-chain data |
| **16-Model Schema**       | Prisma + PostgreSQL — 4 state tables (live snapshots), 10 historical tables, 2 infra tables      |
| **AI Agent**              | 5-min loop: LLM-driven yield + arbitrage analysis → EIP-712 intent → on-chain execution          |
| **Configurable LLM**      | OpenRouter (default), OpenAI, Anthropic — set via env var; model configurable                    |
| **Arbitrage Detection**   | Scans recent swap executions for cross-pool price spreads > 50 bps                               |
| **User Position Queries** | Aggregated deposit/withdrawal history + pending withdrawal requests per wallet address           |
| **Blockscout Pagination** | Full page-looping with `next_page_params` — handles full historical backfill via seed script     |

---

## Architecture

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
        ├── handlers/vault.ts      → deposits, withdrawals, strategies, intents
        ├── handlers/oracle.ts     → oracle updates, oracle state
        ├── handlers/router.ts     → swap executions
        ├── handlers/crosschain.ts → cross-chain dispatches
        └── handlers/executor.ts   → executor logs
        │
        ▼
  PostgreSQL 15  (via Prisma ORM, 16 models)
        │
        ▼
  Apollo Server 4  (GraphQL, port 4350)

  src/sync/rpc.ts  (eth_call — current state only)
        └── readVaultState(), readOracleState()

  src/agent/orchestrator.ts  (every 5 min)
        ├── StrategyEvaluator  → idle capital + yield gap detection
        ├── ArbitrageDetector  → cross-pool spread scanning
        ├── LLMAnalyzer        → snapshot → LLM → AnalysisResult JSON
        ├── IntentBuilder      → UniversalIntent struct
        ├── IntentSigner       → EIP-712 signTypedData (viem)
        └── TransactionExecutor→ ObidotVault.executeIntent()
```

---

## Quick Start

```bash
# Prerequisites: Node.js 20+, Docker

# Clone and install
git clone https://github.com/obidot/obi.index.git
cd obi.index
npm install

# Start PostgreSQL
npm run docker:up

# Configure environment
cp .env.example .env
# At minimum: DATABASE_URL is pre-configured for Docker Compose

# Initialize database schema
npm run db:push
npm run db:generate

# Backfill all historical events
npm run seed

# Start GraphQL server + poller
npm run dev
# → GraphQL API at http://localhost:4350/graphql

# (Optional) Start AI agent in a separate terminal
# Requires AGENT_PRIVATE_KEY + LLM_API_KEY in .env
npm run agent
```

---

## GraphQL API (port 4350)

Example queries:

```graphql
# Live vault state
query {
  vaultState {
    totalAssets
    totalShares
    paused
    depositCap
  }
}

# Recent deposits
query {
  deposits(limit: 10) {
    owner
    assets
    shares
    txHash
    timestamp
  }
}

# User position (total deposited - withdrawn)
query {
  userPosition(address: "0xYourAddress") {
    totalDeposited
    totalWithdrawn
    pendingWithdrawals
    netPosition
  }
}

# Oracle prices
query {
  oracleStates {
    feedAddress
    answer
    updatedAt
  }
}

# Recent cross-chain dispatches
query {
  crossChainDispatches(status: "pending", limit: 20) {
    txHash
    destination
    commitment
    status
    timestamp
  }
}

# Vault stats (counts of all event types)
query {
  vaultStats {
    totalDeposits
    totalWithdrawals
    totalStrategies
    totalSwaps
    totalIntents
  }
}
```

All queries support `limit` (default 50, max 500) and `offset` for pagination.

---

## Project Structure

```
obi.index/
├── docker-compose.yml          # PostgreSQL 15 service
├── .env.example                # All env variables with defaults + comments
├── package.json
├── tsconfig.json               # strict, ESNext, bundler resolution
├── prisma/
│   └── schema.prisma           # 16 Prisma models
├── scripts/
│   └── seed.ts                 # Full historical backfill from block 0
└── src/
    ├── server.ts               # Entry: server + poller startup + graceful shutdown
    ├── config/
    │   ├── constants.ts        # Chain config, URLs, timing constants
    │   └── contracts.ts        # Deployed addresses, ABI fragments, CONTRACT_REGISTRY
    ├── sync/
    │   ├── blockscout.ts       # Blockscout REST API client with pagination
    │   ├── rpc.ts              # viem eth_call for current vault/oracle state
    │   ├── decoder.ts          # viem decodeEventLog wrapper
    │   ├── poller.ts           # Poller class — 60s loop, cursor management
    │   └── handlers/           # Per-contract event handlers → Prisma writes
    ├── graphql/
    │   ├── typeDefs.ts         # GraphQL SDL
    │   └── resolvers.ts        # Query resolvers (Prisma)
    ├── agent/
    │   ├── index.ts            # Agent entry point
    │   ├── orchestrator.ts     # 5-min loop
    │   ├── strategy/           # StrategyEvaluator + ArbitrageDetector
    │   ├── intent/             # IntentBuilder + IntentSigner (EIP-712)
    │   ├── executor/           # TransactionExecutor (on-chain submission)
    │   └── llm/                # LLMProvider, OpenRouter, OpenAI, LLMAnalyzer
    └── utils/
        └── logger.ts           # pino logger singleton
```

---

## Deployed Contracts (Polkadot Hub TestNet)

All contracts are on chain ID `420420417`.

| Contract           | Address                                      | Phase |
| ------------------ | -------------------------------------------- | ----- |
| ObidotVault        | `0x37D7959f5f97D37799E0d04b7684c41CB2Ff878d` | 1     |
| KeeperOracle       | `0xf64d93DC125AC1B366532BBbA165615f6D566C7F` | 1     |
| OracleRegistry     | `0x8b7C7345d6cF9de45f4aacC61F56F0241d47e88B` | 1     |
| CrossChainRouter   | `0xE65D7B65a1972A82bCF65f6711a43355Faa3f490` | 1     |
| BifrostAdapter     | `0x265Cb785De0fF2e5BcebDEb53095aDCAE9175527` | 1     |
| XCMExecutor        | `0xE8FDc9093395eA02017d5D66899F3E04CFF1CF64` | 2     |
| HyperExecutor      | `0xaEC0009B15449102a39204259d07c2517cf8fC0f` | 2     |
| NativeAsset (DOT)  | `0xE72453bD8d5ECF56ccdDeF949C8AE0Cea5A41E7d` | 2     |
| NativeAsset (USDC) | `0xAf233E9f2ED78022CAdEA58a84144ce6BcDFd63E` | 2     |

---

## Networks

| Network              | Chain ID    | Currency | RPC                                    | Block Explorer                                        |
| -------------------- | ----------- | -------- | -------------------------------------- | ----------------------------------------------------- |
| Polkadot Hub TestNet | `420420417` | PAS      | `https://eth-rpc-testnet.polkadot.io/` | [Blockscout](https://blockscout-testnet.polkadot.io/) |
| Polkadot Hub         | `420420419` | DOT      | `https://eth-rpc.polkadot.io/`         | [Blockscout](https://blockscout.polkadot.io/)         |

---

## Tech Stack

| Component     | Version | Purpose                                            |
| ------------- | ------- | -------------------------------------------------- |
| TypeScript    | 5.7     | Language — strict mode, ESNext, bundler resolution |
| Apollo Server | 4.x     | GraphQL API (standalone, port 4350)                |
| Prisma ORM    | 6.x     | Database access + schema management                |
| PostgreSQL    | 15      | Persistent storage (Docker Compose)                |
| viem          | 2.x     | ABI decoding, eth_call, EIP-712 signing            |
| pino          | 9.x     | Structured JSON logging                            |
| zod           | 3.x     | Schema validation                                  |
| tsx           | 4.x     | TypeScript dev execution + scripts                 |

---

## License

MIT
