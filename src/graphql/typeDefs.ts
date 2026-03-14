// ── GraphQL Type Definitions ─────────────────────────────

export const typeDefs = `#graphql
  # ═══════════════════════════════════════════════════════
  # STATE TYPES
  # ═══════════════════════════════════════════════════════

  type VaultState {
    address: String!
    totalAssets: String!
    totalSupply: String!
    totalDeposited: String!
    totalWithdrawn: String!
    depositCap: String!
    maxDailyLoss: String!
    paused: Boolean!
    swapRouter: String
    pendingWithdrawals: Int!
    updatedAtBlock: Int!
    updatedAt: String!
  }

  type OracleState {
    feedAddress: String!
    asset: String!
    price: String!
    decimals: Int!
    heartbeat: Int!
    roundId: Int!
    updatedAtBlock: Int!
    updatedAt: String!
  }

  type ProtocolConfig {
    protocol: String!
    allowed: Boolean!
    exposureCap: String!
    updatedAtBlock: Int!
  }

  type ParachainConfig {
    parachainId: Int!
    allowed: Boolean!
    updatedAtBlock: Int!
  }

  # ═══════════════════════════════════════════════════════
  # HISTORICAL TYPES
  # ═══════════════════════════════════════════════════════

  type Deposit {
    id: String!
    txHash: String!
    logIndex: Int!
    blockNumber: Int!
    timestamp: String!
    sender: String!
    owner: String!
    assets: String!
    shares: String!
  }

  type Withdrawal {
    id: String!
    txHash: String!
    logIndex: Int!
    blockNumber: Int!
    timestamp: String!
    sender: String!
    receiver: String!
    owner: String!
    assets: String!
    shares: String!
  }

  type WithdrawalRequest {
    id: String!
    txHash: String!
    blockNumber: Int!
    timestamp: String!
    user: String!
    shares: String!
    requestId: Int!
    fulfilled: Boolean!
  }

  type StrategyExecution {
    id: String!
    txHash: String!
    blockNumber: Int!
    timestamp: String!
    executor: String!
    destination: String!
    targetChain: String!
    protocol: String!
    amount: String!
    profit: String!
    success: Boolean!
  }

  type LocalSwap {
    id: String!
    txHash: String!
    blockNumber: Int!
    timestamp: String!
    tokenIn: String!
    tokenOut: String!
    amountIn: String!
    amountOut: String!
    executor: String!
  }

  type IntentExecution {
    id: String!
    txHash: String!
    blockNumber: Int!
    timestamp: String!
    solver: String!
    intentHash: String!
    tokenIn: String!
    tokenOut: String!
    amountIn: String!
    minAmountOut: String!
    actualOut: String
    destination: String!
    targetChain: String!
    deadline: String!
    nonce: Int!
  }

  type OracleUpdate {
    id: String!
    txHash: String!
    blockNumber: Int!
    timestamp: String!
    feed: String!
    price: String!
    roundId: Int!
    updater: String!
  }

  type SwapExecution {
    id: String!
    txHash: String!
    blockNumber: Int!
    timestamp: String!
    tokenIn: String!
    tokenOut: String!
    amountIn: String!
    amountOut: String!
    recipient: String!
    poolType: String!
    hops: Int!
  }

  type CrossChainDispatch {
    id: String!
    txHash: String!
    blockNumber: Int!
    timestamp: String!
    messageType: String!
    sourceChain: String!
    destChain: String!
    sender: String!
    data: String!
    commitment: String
    status: String!
  }

  type BifrostStrategy {
    id: String!
    txHash: String!
    blockNumber: Int!
    timestamp: String!
    strategyType: String!
    tokenIn: String!
    amount: String!
    xcmFee: String!
    caller: String!
  }

  # ═══════════════════════════════════════════════════════
  # INFRASTRUCTURE TYPES
  # ═══════════════════════════════════════════════════════

  type SyncCursor {
    contractAddress: String!
    contractName: String!
    lastBlock: Int!
    updatedAt: String!
  }

  type Token {
    address: String!
    symbol: String!
    name: String!
    decimals: Int!
  }

  # ═══════════════════════════════════════════════════════
  # AGGREGATE TYPES
  # ═══════════════════════════════════════════════════════

  type VaultStats {
    totalDeposits: Int!
    totalWithdrawals: Int!
    totalStrategies: Int!
    totalSwaps: Int!
    totalIntents: Int!
    totalCrossChainMessages: Int!
  }

  type UserPosition {
    address: String!
    totalDeposited: String!
    totalWithdrawn: String!
    depositCount: Int!
    withdrawalCount: Int!
    deposits: [Deposit!]!
    withdrawals: [Withdrawal!]!
    pendingRequests: [WithdrawalRequest!]!
  }

  # ═══════════════════════════════════════════════════════
  # QUERIES
  # ═══════════════════════════════════════════════════════

  type Query {
    # State
    vaultState: VaultState
    oracleState(feedAddress: String): OracleState
    oracleStates: [OracleState!]!
    protocolConfigs: [ProtocolConfig!]!
    parachainConfigs: [ParachainConfig!]!

    # Historical — paginated
    deposits(limit: Int, offset: Int, owner: String): [Deposit!]!
    withdrawals(limit: Int, offset: Int, owner: String): [Withdrawal!]!
    withdrawalRequests(limit: Int, offset: Int, user: String, fulfilled: Boolean): [WithdrawalRequest!]!
    strategyExecutions(limit: Int, offset: Int, executor: String): [StrategyExecution!]!
    localSwaps(limit: Int, offset: Int): [LocalSwap!]!
    intentExecutions(limit: Int, offset: Int, solver: String): [IntentExecution!]!
    oracleUpdates(limit: Int, offset: Int, feed: String): [OracleUpdate!]!
    swapExecutions(limit: Int, offset: Int): [SwapExecution!]!
    crossChainDispatches(limit: Int, offset: Int, status: String): [CrossChainDispatch!]!
    bifrostStrategies(limit: Int, offset: Int): [BifrostStrategy!]!

    # Aggregates
    vaultStats: VaultStats!
    userPosition(address: String!): UserPosition

    # Infrastructure
    syncCursors: [SyncCursor!]!
    tokens: [Token!]!
  }

  # ═══════════════════════════════════════════════════════
  # SUBSCRIPTIONS — real-time event feed for the frontend
  # ═══════════════════════════════════════════════════════

  type Subscription {
    """Fires whenever a new Deposit event is indexed."""
    depositAdded: Deposit!

    """Fires whenever a new Withdrawal event is indexed."""
    withdrawalAdded: Withdrawal!

    """Fires whenever a StrategyExecuted event is indexed."""
    strategyExecuted: StrategyExecution!

    """Fires whenever an IntentExecuted event is indexed."""
    intentExecuted: IntentExecution!

    """Fires whenever a PriceUpdated oracle event is indexed."""
    oracleUpdated: OracleUpdate!

    """Fires whenever a SwapRouter Swapped event is indexed."""
    swapExecuted: SwapExecution!
  }
`;
