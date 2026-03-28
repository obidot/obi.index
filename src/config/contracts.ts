// ── Deployed Contract Addresses & ABI Fragments ─────────
// Source: obi.router/deployments.json (Polkadot Hub TestNet, chain 420420417)

import { type Abi, type Address } from "viem";

// ═══════════════════════════════════════════════════════════
// ADDRESSES
// ═══════════════════════════════════════════════════════════

export const ADDRESSES = {
  // Phase 1 (2026-02-27)
  TestDOT: "0x2402C804aD8a6217BF73D8483dA7564065c56083" as Address,
  KeeperOracle: "0xf64d93DC125AC1B366532BBbA165615f6D566C7F" as Address,
  OracleRegistry: "0x8b7C7345d6cF9de45f4aacC61F56F0241d47e88B" as Address,
  BifrostAdapter: "0x265Cb785De0fF2e5BcebDEb53095aDCAE9175527" as Address,
  // Phase 2 (2026-03-04)
  XCMExecutor: "0x011b6FAf32370dCF92a452374FfCfCdbfA20278c" as Address,
  XcmPrecompile: "0x00000000000000000000000000000000000a0000" as Address,
  NativeAssetDOT: "0xE72453bD8d5ECF56ccdDeF949C8AE0Cea5A41E7d" as Address,
  NativeAssetUSDC: "0xAf233E9f2ED78022CAdEA58a84144ce6BcDFd63E" as Address,
  // Phase 3–17 (2026-03-11 → 2026-03-15)
  SwapRouter: "0x60a72d1e20c5dc40Bb5a24394f0583d863201A3c" as Address,
  SwapQuoter: "0x81d7aCFEF474DA6c76eC1b5A05a137cB9f3A5Db1" as Address,
  HydrationOmnipoolAdapter:
    "0xF0E1c10f97446C032A86C9643258Bb26d6129933" as Address,
  // Phase 7–9 (2026-03-12)
  HyperExecutor: "0x62919Cb6416Cb919fC4A30c5707a7867Ca874ca6" as Address,
  CrossChainRouter: "0xE2fFfb3B5C72f99811bC20D857035611bFCe5b5d" as Address,
  IsmpHost: "0xbb26e04A71e7c12093e82b83BA310163Eac186fa" as Address,
  // Phase 19 (2026-03-16, executeLocalSwap approval fix)
  ObidotVault: "0x03473a95971Ba0496786a615e21b1e87bDFf0025" as Address,
  // SP-1 liquidity provision (2026-03-20)
  LiquidityPairDotTkb:   "0xDc1b4a27d44613aa5072Ca6edC20151D94e7f93A" as Address,
  LiquidityPairDotUsdc:  "0x9576F7b40bC3a8Bb5d236Cd4bEBC29dC40AF0fa4" as Address,
  LiquidityPairDotEth:   "0x4a0183BA79Ab7072240B5Fd8B6A1055E8e60aC83" as Address,
  LiquidityPairUsdcEth:  "0x3FBa4A4db176201d3A3a5B25e7561274ceCb6ef5" as Address,
  LiquidityPairTkbTka:   "0xd6F5C4b7b3911Db7D062D0457f8b3D4045C86d50" as Address,
} as const;

// ═══════════════════════════════════════════════════════════
// ABI FRAGMENTS (events only — used by viem for decoding)
// ═══════════════════════════════════════════════════════════

/** ObidotVault + ERC4626 events */
export const VAULT_ABI = [
  // ── ERC-4626 ───────────────────────────────────────────
  {
    type: "event",
    name: "Deposit",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Withdraw",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "receiver", type: "address", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
      { name: "shares", type: "uint256", indexed: false },
    ],
  },
  // ── Strategy ───────────────────────────────────────────
  {
    type: "event",
    name: "StrategyExecuted",
    inputs: [
      { name: "strategyId", type: "uint256", indexed: true },
      { name: "strategist", type: "address", indexed: true },
      { name: "targetParachain", type: "uint32", indexed: true },
      { name: "targetProtocol", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "minReturn", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "StrategyOutcomeReported",
    inputs: [
      { name: "strategyId", type: "uint256", indexed: true },
      { name: "newStatus", type: "uint8", indexed: false },
      { name: "returnedAmount", type: "uint256", indexed: false },
      { name: "pnl", type: "int256", indexed: false },
    ],
  },
  // ── Local Swap ─────────────────────────────────────────
  {
    type: "event",
    name: "LocalSwapExecuted",
    inputs: [
      { name: "strategyId", type: "uint256", indexed: true },
      { name: "strategist", type: "address", indexed: true },
      { name: "tokenIn", type: "address", indexed: false },
      { name: "tokenOut", type: "address", indexed: false },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
    ],
  },
  // ── Withdrawal Queue ──────────────────────────────────
  {
    type: "event",
    name: "WithdrawalQueued",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "shares", type: "uint256", indexed: false },
      { name: "assets", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalFulfilled",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "assets", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalCancelled",
    inputs: [
      { name: "requestId", type: "uint256", indexed: true },
      { name: "owner", type: "address", indexed: true },
    ],
  },
  // ── Intent ─────────────────────────────────────────────
  {
    type: "event",
    name: "IntentExecuted",
    inputs: [
      { name: "messageId", type: "uint64", indexed: true },
      { name: "strategist", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "HyperIntentQueued",
    inputs: [
      { name: "strategist", type: "address", indexed: true },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  // ── Config Updates ─────────────────────────────────────
  {
    type: "event",
    name: "ParachainWhitelistUpdated",
    inputs: [
      { name: "parachainId", type: "uint32", indexed: true },
      { name: "allowed", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ProtocolWhitelistUpdated",
    inputs: [
      { name: "protocol", type: "address", indexed: true },
      { name: "allowed", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ExposureCapUpdated",
    inputs: [
      { name: "protocol", type: "address", indexed: true },
      { name: "newCap", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "DepositCapUpdated",
    inputs: [{ name: "newCap", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "DailyLossThresholdUpdated",
    inputs: [{ name: "newThreshold", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "OracleUpdated",
    inputs: [{ name: "newOracle", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "OracleRegistryUpdated",
    inputs: [{ name: "newRegistry", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "SwapRouterUpdated",
    inputs: [{ name: "newRouter", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "CrossChainRouterUpdated",
    inputs: [{ name: "newRouter", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "BifrostAdapterUpdated",
    inputs: [{ name: "newAdapter", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "XcmExecutorUpdated",
    inputs: [{ name: "newExecutor", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "HyperExecutorUpdated",
    inputs: [{ name: "newExecutor", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "XcmWeightLimitsUpdated",
    inputs: [
      { name: "maxRefTime", type: "uint64", indexed: false },
      { name: "maxProofSize", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EmergencyModeToggled",
    inputs: [{ name: "enabled", type: "bool", indexed: false }],
  },
  {
    type: "event",
    name: "RemoteAssetsAdjusted",
    inputs: [
      { name: "oldValue", type: "uint256", indexed: false },
      { name: "newValue", type: "uint256", indexed: false },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SatelliteAssetsUpdated",
    inputs: [
      { name: "chainHash", type: "bytes32", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "newTotal", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BifrostStrategyExecuted",
    inputs: [
      { name: "strategyId", type: "uint256", indexed: true },
      { name: "bifrostStrategyType", type: "uint8", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AssetSyncBroadcasted",
    inputs: [
      { name: "totalAssets", type: "uint256", indexed: false },
      { name: "totalShares", type: "uint256", indexed: false },
      { name: "remoteAssets", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WithdrawalTimelockUpdated",
    inputs: [{ name: "newTimelock", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "PerformanceFeeUpdated",
    inputs: [{ name: "newFeeBps", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "PerformanceFeeMinted",
    inputs: [
      { name: "treasury", type: "address", indexed: true },
      { name: "feeShares", type: "uint256", indexed: false },
    ],
  },
  // ── View functions (for state reads) ──────────────────
  {
    type: "function",
    name: "totalAssets",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "paused",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "depositCap",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "maxDailyLoss",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalDeposited",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalWithdrawn",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

/** KeeperOracle events */
export const KEEPER_ORACLE_ABI = [
  {
    type: "event",
    name: "PriceUpdated",
    inputs: [
      { name: "roundId", type: "uint80", indexed: true },
      { name: "answer", type: "int256", indexed: false },
      { name: "updatedAt", type: "uint256", indexed: false },
      { name: "updater", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "HeartbeatUpdated",
    inputs: [{ name: "newHeartbeat", type: "uint256", indexed: false }],
  },
  {
    type: "event",
    name: "DeviationThresholdUpdated",
    inputs: [{ name: "newThresholdBps", type: "uint16", indexed: false }],
  },
  {
    type: "event",
    name: "DeviationCapUpdated",
    inputs: [{ name: "newCapBps", type: "uint16", indexed: false }],
  },
  {
    type: "event",
    name: "RequiredSignaturesUpdated",
    inputs: [{ name: "newRequired", type: "uint8", indexed: false }],
  },
  // View functions
  {
    type: "function",
    name: "latestRoundData",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "heartbeat",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

/** OracleRegistry events */
export const ORACLE_REGISTRY_ABI = [
  {
    type: "event",
    name: "FeedSet",
    inputs: [
      { name: "asset", type: "address", indexed: true },
      { name: "oracle", type: "address", indexed: true },
      { name: "heartbeat", type: "uint256", indexed: false },
      { name: "deviationBps", type: "uint16", indexed: false },
    ],
  },
  {
    type: "event",
    name: "FeedDisabled",
    inputs: [{ name: "asset", type: "address", indexed: true }],
  },
  {
    type: "event",
    name: "FeedEnabled",
    inputs: [{ name: "asset", type: "address", indexed: true }],
  },
] as const satisfies Abi;

/** SwapRouter events (from ISwapRouter) */
export const SWAP_ROUTER_ABI = [
  {
    type: "event",
    name: "Swapped",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "tokenIn", type: "address", indexed: true },
      { name: "tokenOut", type: "address", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "amountOut", type: "uint256", indexed: false },
      { name: "poolType", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AdapterSet",
    inputs: [
      { name: "poolType", type: "uint8", indexed: true },
      { name: "adapter", type: "address", indexed: true },
    ],
  },
] as const satisfies Abi;

/** CrossChainRouter events */
export const CROSS_CHAIN_ROUTER_ABI = [
  {
    type: "event",
    name: "SatelliteDepositReceived",
    inputs: [
      { name: "chainId", type: "bytes", indexed: true },
      { name: "depositor", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "sharesMinted", type: "uint256", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SatelliteWithdrawRequested",
    inputs: [
      { name: "chainId", type: "bytes", indexed: true },
      { name: "withdrawer", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "sharesToBurn", type: "uint256", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "AssetSyncBroadcast",
    inputs: [
      { name: "globalTotalAssets", type: "uint256", indexed: false },
      { name: "globalTotalShares", type: "uint256", indexed: false },
      { name: "totalRemoteAssets", type: "uint256", indexed: false },
      { name: "satelliteCount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "StrategyReportBroadcast",
    inputs: [
      { name: "strategyId", type: "uint256", indexed: false },
      { name: "success", type: "bool", indexed: false },
      { name: "returnedAmount", type: "uint256", indexed: false },
      { name: "pnl", type: "int256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "EmergencySyncBroadcast",
    inputs: [
      { name: "paused", type: "bool", indexed: false },
      { name: "emergencyMode", type: "bool", indexed: false },
    ],
  },
  // Inherited from HyperbridgeAdapter
  {
    type: "event",
    name: "MessageDispatched",
    inputs: [
      { name: "commitment", type: "bytes32", indexed: true },
      { name: "dest", type: "bytes", indexed: false },
      { name: "timeout", type: "uint64", indexed: false },
      { name: "bodyLength", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MessageReceived",
    inputs: [
      { name: "source", type: "bytes", indexed: false },
      { name: "nonce", type: "uint64", indexed: false },
      { name: "bodyLength", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "MessageTimeout",
    inputs: [
      { name: "dest", type: "bytes", indexed: false },
      { name: "nonce", type: "uint64", indexed: false },
      { name: "bodyLength", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PeerRegistered",
    inputs: [
      { name: "chainId", type: "bytes", indexed: false },
      { name: "moduleAddress", type: "bytes", indexed: false },
      { name: "registered", type: "bool", indexed: false },
    ],
  },
] as const satisfies Abi;

/** BifrostAdapter events */
export const BIFROST_ADAPTER_ABI = [
  {
    type: "event",
    name: "BifrostStrategyDispatched",
    inputs: [
      { name: "strategyId", type: "uint256", indexed: true },
      { name: "strategyType", type: "uint8", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "beneficiary", type: "bytes32", indexed: false },
    ],
  },
] as const satisfies Abi;

/** XCMExecutor events (own + IExecutor) */
export const XCM_EXECUTOR_ABI = [
  {
    type: "event",
    name: "Dispatched",
    inputs: [
      { name: "messageId", type: "uint64", indexed: true },
      { name: "expectedOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WeightLimitsUpdated",
    inputs: [
      { name: "maxRefTime", type: "uint64", indexed: false },
      { name: "maxProofSize", type: "uint64", indexed: false },
    ],
  },
] as const satisfies Abi;

/** HyperExecutor events (own + IExecutor) */
export const HYPER_EXECUTOR_ABI = [
  {
    type: "event",
    name: "Dispatched",
    inputs: [
      { name: "messageId", type: "uint64", indexed: true },
      { name: "expectedOut", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Committed",
    inputs: [
      { name: "messageId", type: "uint64", indexed: true },
      { name: "commitment", type: "bytes32", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ChainRegistered",
    inputs: [
      { name: "chainIndex", type: "uint8", indexed: true },
      { name: "chainId", type: "bytes", indexed: false },
      { name: "moduleAddress", type: "bytes", indexed: false },
    ],
  },
] as const satisfies Abi;

/**
 * Hyperbridge ISMP host events confirmed in the local repo scripts/docs.
 *
 * Note: the plan originally referenced `GetRequestHandled`, but the checked-in
 * contract-side operational scripts for the currently deployed host surfaces
 * only provide `PostRequestEvent`, `PostRequestHandled`,
 * `PostResponseHandled`, and `StateMachineUpdated`.
 */
export const ISMP_HOST_ABI = [
  {
    type: "event",
    name: "PostRequestEvent",
    inputs: [
      { name: "source", type: "string", indexed: false },
      { name: "dest", type: "string", indexed: false },
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "bytes", indexed: false },
      { name: "nonce", type: "uint256", indexed: false },
      { name: "timeoutTimestamp", type: "uint256", indexed: false },
      { name: "body", type: "bytes", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PostRequestHandled",
    inputs: [
      { name: "commitment", type: "bytes32", indexed: true },
      { name: "relayer", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PostResponseHandled",
    inputs: [
      { name: "commitment", type: "bytes32", indexed: true },
      { name: "relayer", type: "address", indexed: false },
    ],
  },
  {
    type: "event",
    name: "StateMachineUpdated",
    inputs: [
      { name: "stateMachineId", type: "string", indexed: false },
      { name: "height", type: "uint256", indexed: false },
    ],
  },
] as const satisfies Abi;

/** Polkadot Hub XCM precompile event surface */
export const XCM_PRECOMPILE_ABI = [
  {
    type: "event",
    name: "XcmSent",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "dest", type: "bytes", indexed: false },
      { name: "message", type: "bytes", indexed: false },
    ],
  },
] as const satisfies Abi;

/** NativeAsset (ERC-20 Transfer/Approval) */
export const NATIVE_ASSET_ABI = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  // View functions
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "name",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

/** LiquidityPair — UniswapV2-compatible LP pair events + view functions */
export const LP_PAIR_ABI = [
  {
    type: "event",
    name: "Mint",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Burn",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "amount0", type: "uint256", indexed: false },
      { name: "amount1", type: "uint256", indexed: false },
      { name: "to", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "amount0In", type: "uint256", indexed: false },
      { name: "amount1In", type: "uint256", indexed: false },
      { name: "amount0Out", type: "uint256", indexed: false },
      { name: "amount1Out", type: "uint256", indexed: false },
      { name: "to", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "Sync",
    inputs: [
      { name: "reserve0", type: "uint112", indexed: false },
      { name: "reserve1", type: "uint112", indexed: false },
    ],
  },
  {
    type: "function",
    name: "token0",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "token1",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getReserves",
    inputs: [],
    outputs: [
      { name: "_reserve0", type: "uint112" },
      { name: "_reserve1", type: "uint112" },
      { name: "_blockTimestampLast", type: "uint32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "totalSupply",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

// ═══════════════════════════════════════════════════════════
// CONTRACT REGISTRY — maps address → name + ABI for poller
// ═══════════════════════════════════════════════════════════

export interface ContractEntry {
  name: string;
  address: Address;
  abi: Abi;
}

export const CONTRACT_REGISTRY: ContractEntry[] = [
  { name: "ObidotVault", address: ADDRESSES.ObidotVault, abi: VAULT_ABI },
  {
    name: "KeeperOracle",
    address: ADDRESSES.KeeperOracle,
    abi: KEEPER_ORACLE_ABI,
  },
  {
    name: "OracleRegistry",
    address: ADDRESSES.OracleRegistry,
    abi: ORACLE_REGISTRY_ABI,
  },
  {
    name: "CrossChainRouter",
    address: ADDRESSES.CrossChainRouter,
    abi: CROSS_CHAIN_ROUTER_ABI,
  },
  {
    name: "BifrostAdapter",
    address: ADDRESSES.BifrostAdapter,
    abi: BIFROST_ADAPTER_ABI,
  },
  {
    name: "XCMExecutor",
    address: ADDRESSES.XCMExecutor,
    abi: XCM_EXECUTOR_ABI,
  },
  {
    name: "XcmPrecompile",
    address: ADDRESSES.XcmPrecompile,
    abi: XCM_PRECOMPILE_ABI,
  },
  {
    name: "HyperExecutor",
    address: ADDRESSES.HyperExecutor,
    abi: HYPER_EXECUTOR_ABI,
  },
  {
    name: "IsmpHost",
    address: ADDRESSES.IsmpHost,
    abi: ISMP_HOST_ABI,
  },
  {
    name: "XcmPrecompile",
    address: ADDRESSES.XcmPrecompile,
    abi: XCM_PRECOMPILE_ABI,
  },
  {
    name: "SwapRouter",
    address: ADDRESSES.SwapRouter,
    abi: SWAP_ROUTER_ABI,
  },
  {
    name: "NativeAssetDOT",
    address: ADDRESSES.NativeAssetDOT,
    abi: NATIVE_ASSET_ABI,
  },
  {
    name: "NativeAssetUSDC",
    address: ADDRESSES.NativeAssetUSDC,
    abi: NATIVE_ASSET_ABI,
  },
  { name: "LiquidityPairDotTkb",  address: ADDRESSES.LiquidityPairDotTkb,  abi: LP_PAIR_ABI },
  { name: "LiquidityPairDotUsdc", address: ADDRESSES.LiquidityPairDotUsdc, abi: LP_PAIR_ABI },
  { name: "LiquidityPairDotEth",  address: ADDRESSES.LiquidityPairDotEth,  abi: LP_PAIR_ABI },
  { name: "LiquidityPairUsdcEth", address: ADDRESSES.LiquidityPairUsdcEth, abi: LP_PAIR_ABI },
  { name: "LiquidityPairTkbTka",  address: ADDRESSES.LiquidityPairTkbTka,  abi: LP_PAIR_ABI },
];
