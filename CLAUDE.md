# Obidot — obi.index

TypeScript indexer + AI agent for the first DEX aggregator on Polkadot Hub. Polls Blockscout REST API every 60 seconds for Obidot smart-contract event logs (because `eth_getLogs` is broken on PolkaVM), writes to PostgreSQL via Prisma, exposes a GraphQL API on port 4350, and runs an autonomous AI agent that signs EIP-712 intents and submits them on-chain.

## Quick Context

- **What:** Indexer + GraphQL API + AI agent for Obidot on Polkadot Hub. Autonomous agent is a sub-feature.
- **Where:** Polkadot Hub TestNet, chain ID `420420417`. RPC: `https://eth-rpc-testnet.polkadot.io/`
- **Stack:** TypeScript 5.7, Apollo Server 4, Prisma 6, PostgreSQL 15, viem 2.x
- **Logs:** Fetched via Blockscout REST API — NOT `eth_getLogs` (broken on PolkaVM). State reads use `eth_call` (works fine).
- **Typecheck:** `npm run typecheck` — zero errors required before any commit.

## Key Commands

```sh
npm install                 # install dependencies
npm run db:generate         # regenerate Prisma client after schema changes
npm run db:push             # push schema to DB (dev)
npm run dev                 # start server + poller with hot reload
npm run build               # TypeScript → dist/
npm start                   # run compiled server (production)
npm run typecheck           # must pass — zero errors
npm run seed                # backfill all historical events from block 0
npm run agent               # start AI agent (separate process)
npm run docker:up           # start PostgreSQL
```

## Architecture (One-Sentence)

The poller fetches event logs from the Blockscout REST API every 60 seconds per contract, decodes them via viem, routes to per-contract handlers that upsert into PostgreSQL via Prisma, while Apollo Server 4 exposes a read-only GraphQL API on port 4350 and a separate AI agent loop every 5 minutes evaluates on-chain data, queries an LLM, and submits signed EIP-712 `UniversalIntent`s to `ObidotVault.executeIntent()`.

## File Map

| File / Dir                          | Purpose                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| `src/server.ts`                     | Entry: Apollo Server + Poller startup + graceful shutdown        |
| `src/config/constants.ts`           | CHAIN_ID, RPC_URL, BLOCKSCOUT_URL, PORT, POLL_INTERVAL_MS        |
| `src/config/contracts.ts`           | ADDRESSES, ABI fragments, CONTRACT_REGISTRY[]                    |
| `src/sync/blockscout.ts`            | `fetchLogs(address, fromBlock)` — Blockscout REST client         |
| `src/sync/rpc.ts`                   | `readVaultState()`, `readOracleState()` — viem eth_call          |
| `src/sync/decoder.ts`               | `decodeLog()` — viem `decodeEventLog` wrapper                    |
| `src/sync/poller.ts`                | `Poller` class — 60s setInterval, cursor management, HANDLER_MAP |
| `src/sync/handlers/vault.ts`        | ERC4626 + ObidotVault events → Prisma writes                     |
| `src/sync/handlers/oracle.ts`       | KeeperOracle + OracleRegistry events                             |
| `src/sync/handlers/router.ts`       | SwapRouter `Swapped` / `AdapterSet` events                       |
| `src/sync/handlers/crosschain.ts`   | CrossChainRouter + HyperbridgeAdapter events                     |
| `src/sync/handlers/executor.ts`     | XCMExecutor + HyperExecutor + BifrostAdapter events              |
| `src/graphql/typeDefs.ts`           | Full GraphQL SDL                                                 |
| `src/graphql/resolvers.ts`          | All query resolvers (Prisma)                                     |
| `src/agent/orchestrator.ts`         | 5-min loop: evaluate → analyze → build → sign → execute          |
| `src/agent/strategy/evaluator.ts`   | `StrategyEvaluator` — idle capital + price move detection        |
| `src/agent/strategy/arbitrage.ts`   | `ArbitrageDetector` — cross-pool spread scanning (> 50 bps)      |
| `src/agent/intent/builder.ts`       | `buildIntent()` — `UniversalIntent` struct                       |
| `src/agent/intent/signer.ts`        | `signIntent()` — EIP-712 `signTypedData` via viem                |
| `src/agent/executor/transaction.ts` | `TransactionExecutor` — `executeIntent()` on-chain               |
| `src/agent/llm/provider.ts`         | `LLMProvider` interface + `createLLMProvider()` factory          |
| `src/agent/llm/analyzer.ts`         | `LLMAnalyzer` — snapshot → `AnalysisResult` JSON                 |
| `prisma/schema.prisma`              | 16 Prisma models (4 state + 10 historical + 2 infra)             |
| `scripts/seed.ts`                   | Backfill all historical logs from block 0                        |

## Prisma Models

**State (upsert on every sync):** `VaultState`, `OracleState`, `ProtocolConfig`, `ParachainConfig`

**Historical (append-only, unique on txHash+logIndex):** `Deposit`, `Withdrawal`, `WithdrawalRequest`, `StrategyExecution`, `LocalSwap`, `IntentExecution`, `OracleUpdate`, `SwapExecution`, `CrossChainDispatch`, `BifrostStrategy`

**Infra:** `SyncCursor` (last indexed block per contract), `Token` (ERC-20 metadata cache)

## Contract Registry (9 Contracts, Polkadot Hub TestNet)

| Contract          | Address                                      |
| ----------------- | -------------------------------------------- |
| ObidotVault       | `0x37D7959f5f97D37799E0d04b7684c41CB2Ff878d` |
| KeeperOracle      | `0xf64d93DC125AC1B366532BBbA165615f6D566C7F` |
| OracleRegistry    | `0x8b7C7345d6cF9de45f4aacC61F56F0241d47e88B` |
| CrossChainRouter  | `0xE65D7B65a1972A82bCF65f6711a43355Faa3f490` |
| BifrostAdapter    | `0x265Cb785De0fF2e5BcebDEb53095aDCAE9175527` |
| XCMExecutor       | `0xE8FDc9093395eA02017d5D66899F3E04CFF1CF64` |
| HyperExecutor     | `0xaEC0009B15449102a39204259d07c2517cf8fC0f` |
| NativeAsset(DOT)  | `0xE72453bD8d5ECF56ccdDeF949C8AE0Cea5A41E7d` |
| NativeAsset(USDC) | `0xAf233E9f2ED78022CAdEA58a84144ce6BcDFd63E` |

Not yet deployed (no registry entry): SwapRouter, SwapQuoter, HydrationOmnipoolAdapter, AssetHubPairAdapter, BifrostDEXAdapter.

## Environment Variables

```sh
DATABASE_URL="postgresql://obidot:obidot@localhost:5432/obidot_index"  # required
AGENT_PRIVATE_KEY=""       # required for agent (SOLVER_ROLE on vault)
CHAIN_ID=420420417
RPC_URL="https://eth-rpc-testnet.polkadot.io/"
BLOCKSCOUT_URL="https://blockscout-testnet.polkadot.io"
PORT=4350
POLL_INTERVAL_MS=60000
LLM_PROVIDER="openrouter"  # openrouter | openai | anthropic
LLM_API_KEY=""
LLM_MODEL="anthropic/claude-sonnet-4"
LOG_LEVEL="info"
```

## Coding Rules

- Strict TypeScript — no `any`, use `unknown` + type guards
- Named imports only: `import { Foo } from "./foo.js"` — always `.js` extension (ESM)
- `BigInt` for all on-chain numeric types — never `Number` for uint256
- `as const satisfies Abi` for ABI arrays
- JSDoc `/** ... */` on all public-facing functions
- `noUnusedLocals` / `noUnusedParameters` enforced — `npm run typecheck` must pass
- Prisma: `upsert` with `{ txHash_logIndex }` for historical records (idempotent)
- State tables: always `upsert`, never `create` alone (handles restart/resync)
- `SyncCursor` updated after every batch
- All event args stored as `string` in DB (uint256 → string, no BigInt overflow)
- Timestamps stored as `DateTime` (from Blockscout ISO 8601)

## Key Gotchas

- **`eth_getLogs` is broken on PolkaVM** — always use Blockscout REST API for logs; `eth_call` is fine for state
- **Blockscout pagination** — `GET /api/v2/addresses/{addr}/logs` returns ~50 items/page; loop on `next_page_params` until null; `fetchLogs()` has `maxPages` safety limit (50 default, 200 for seed)
- **Agent is a sub-feature** — starts as a separate process (`npm run agent`), not part of the GraphQL server
- **Agent execute condition** — only submits intent when `confidence >= 60` AND `recommendation != "hold"`
- **EIP-712 domain** — `{ name: "ObidotVault", version: "1", chainId: 420420417, verifyingContract: ObidotVault }`
- **Adding a new contract** — add ABI + address to `contracts.ts`, add handler in `handlers/`, add to `HANDLER_MAP` in `poller.ts`, run `npm run seed`

## PR Instructions

- Branch/title format: `[obi.index] <Title>`
- `npm run typecheck` — zero errors required before commit
- `npm run build` — verify compilation
- Update `.env.example` when adding new env vars
- Update `AGENTS.md` when adding new contracts, models, or agent capabilities
