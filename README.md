<p align="center">
  <img src="logo.png" alt="Obidot" width="200" />
</p>

<h1 align="center">obi.index — Indexer & Agent Backend</h1>

<p align="center">
  TypeScript backend for Obidot — indexes on-chain events, serves a GraphQL API, and runs an autonomous AI agent.
</p>

---

## What It Does

1. **Index** — polls the Blockscout REST API every 60s for events across all Obidot contracts; decodes logs via viem; writes to PostgreSQL via Prisma
2. **Serve** — Apollo Server 4 GraphQL API on port `4350` — vault state, deposits, swaps, intents, cross-chain messages, user positions
3. **Agent** — 5-minute loop: evaluates yield/arbitrage from indexed data → LLM analysis → submits signed EIP-712 `UniversalIntent` when confidence ≥ 60%

> Blockscout REST API is used instead of `eth_getLogs` because PolkaVM (`pallet-revive`) does not implement it correctly.

## Quick Start

```bash
# Prerequisites: Node.js 20+, Docker

git clone https://github.com/obidot/obi.index.git
cd obi.index
npm install

npm run docker:up      # start PostgreSQL
cp .env.example .env
npm run db:push        # apply schema
npm run db:generate    # generate Prisma client
npm run seed           # backfill historical events

npm run dev            # GraphQL API at http://localhost:4350/graphql

# Optional: run AI agent (requires AGENT_PRIVATE_KEY + LLM_API_KEY)
npm run agent
```

## GraphQL API

```graphql
query {
  vaultState {
    totalAssets
    totalShares
    paused
    depositCap
  }
}

query {
  deposits(limit: 10) {
    owner
    assets
    shares
    txHash
    timestamp
  }
}

query {
  userPosition(address: "0x…") {
    totalDeposited
    totalWithdrawn
    netPosition
  }
}

query {
  crossChainDispatches(status: "pending", limit: 20) {
    txHash
    destination
    commitment
    status
  }
}
```

All queries support `limit` (default 50, max 500) and `offset`.

## Architecture

```
Polkadot Hub TestNet
      │  Blockscout REST API (every 60s)
      ▼
  blockscout.ts → decoder.ts → handlers → PostgreSQL
                                               │
                                         Apollo GraphQL
                                          (port 4350)
  rpc.ts (eth_call)
      └── readVaultState, readOracleState

  agent/orchestrator.ts (every 5 min)
      └── StrategyEvaluator → ArbitrageDetector
          → LLMAnalyzer → IntentBuilder
          → EIP-712 sign → executeIntent()
```

## Deployed Contracts (Polkadot Hub TestNet — chain 420420417)

| Contract         | Address                                      |
| ---------------- | -------------------------------------------- |
| ObidotVault      | `0x03473a95971Ba0496786a615e21b1e87bDFf0025` |
| SwapRouter       | `0x60a72d1e20c5dc40Bb5a24394f0583d863201A3c` |
| XCMExecutor      | `0x011b6FAf32370dCF92a452374FfCfCdbfA20278c` |
| HyperExecutor    | `0x62919Cb6416Cb919fC4A30c5707a7867Ca874ca6` |
| CrossChainRouter | `0xE2fFfb3B5C72f99811bC20D857035611bFCe5b5d` |
| KeeperOracle     | `0xf64d93DC125AC1B366532BBbA165615f6D566C7F` |
| BifrostAdapter   | `0x265Cb785De0fF2e5BcebDEb53095aDCAE9175527` |

## Tech Stack

|             |                                                |
| ----------- | ---------------------------------------------- |
| Language    | TypeScript 5.7 (strict, ESNext)                |
| GraphQL     | Apollo Server 4                                |
| Database    | PostgreSQL 15 + Prisma ORM                     |
| Chain Reads | viem (ABI decode, eth_call, EIP-712)           |
| LLM         | OpenRouter / OpenAI / Anthropic (configurable) |
| Logging     | pino                                           |

## License

MIT
