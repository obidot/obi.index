// ── Polling Loop ─────────────────────────────────────────
// Polls Blockscout every 60s for new event logs across all contracts,
// decodes them, dispatches to handlers, and updates sync cursors.

import { PrismaClient } from "@prisma/client";
import { POLL_INTERVAL_MS } from "../config/constants.js";
import {
  CONTRACT_REGISTRY,
  ADDRESSES,
  type ContractEntry,
} from "../config/contracts.js";
import { fetchLogs } from "./blockscout.js";
import { decodeLogs, type DecodedEvent } from "./decoder.js";
import { readVaultState, readOracleState } from "./rpc.js";
import { handleVaultEvent } from "./handlers/vault.js";
import { handleOracleEvent } from "./handlers/oracle.js";
import { handleCrossChainEvent } from "./handlers/crosschain.js";
import {
  handleExecutorEvent,
  handleBifrostEvent,
} from "./handlers/executor.js";
import { handleRouterEvent } from "./handlers/router.js";
import { logger } from "../utils/logger.js";

// ── Handler Dispatch Map ─────────────────────────────────

type EventHandler = (
  prisma: PrismaClient,
  event: DecodedEvent,
) => Promise<void>;

const HANDLER_MAP: Record<string, EventHandler> = {
  ObidotVault: handleVaultEvent,
  KeeperOracle: handleOracleEvent,
  OracleRegistry: handleOracleEvent,
  CrossChainRouter: handleCrossChainEvent,
  BifrostAdapter: handleBifrostEvent,
  XCMExecutor: handleExecutorEvent,
  HyperExecutor: handleExecutorEvent,
  SwapRouter: handleRouterEvent,
  // NativeAsset events (Transfer/Approval) are ERC-20 standard —
  // not indexed separately for now (too noisy). Can be added later.
};

// ── Poller Class ─────────────────────────────────────────

export class Poller {
  private prisma: PrismaClient;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /** Start the polling loop */
  start(): void {
    if (this.timer) return;
    logger.info(
      { intervalMs: POLL_INTERVAL_MS, contracts: CONTRACT_REGISTRY.length },
      "Starting poller",
    );

    // Run immediately, then on interval
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
  }

  /** Stop the polling loop */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    logger.info("Poller stopped");
  }

  /** Execute a single poll cycle */
  async poll(): Promise<void> {
    if (this.running) {
      logger.warn("Previous poll still running — skipping");
      return;
    }

    this.running = true;
    const startTime = Date.now();

    try {
      let totalEvents = 0;

      for (const contract of CONTRACT_REGISTRY) {
        const count = await this.pollContract(contract);
        totalEvents += count;
      }

      // Refresh state snapshots via RPC after processing events
      await this.refreshState();

      const elapsed = Date.now() - startTime;
      logger.info({ totalEvents, elapsedMs: elapsed }, "Poll cycle complete");
    } catch (error) {
      logger.error({ error }, "Poll cycle failed");
    } finally {
      this.running = false;
    }
  }

  /** Poll a single contract for new logs */
  private async pollContract(contract: ContractEntry): Promise<number> {
    // Get sync cursor
    const cursor = await this.prisma.syncCursor.upsert({
      where: { contractAddress: contract.address },
      create: {
        contractAddress: contract.address,
        contractName: contract.name,
        lastBlock: 0,
      },
      update: {},
    });

    // Fetch logs from Blockscout starting after last indexed block
    const fromBlock = cursor.lastBlock + 1;
    const logs = await fetchLogs(contract.address, fromBlock);

    if (logs.length === 0) return 0;

    // Decode logs using the contract's ABI
    const events = decodeLogs(logs, contract.abi, contract.name);

    // Dispatch to handler
    const handler = HANDLER_MAP[contract.name];
    if (handler) {
      for (const event of events) {
        try {
          await handler(this.prisma, event);
        } catch (error) {
          logger.error(
            {
              error,
              event: event.eventName,
              txHash: event.txHash,
              contract: contract.name,
            },
            "Handler failed for event",
          );
        }
      }
    }

    // Update sync cursor to highest block seen
    const maxBlock = Math.max(...logs.map((l) => l.block_number));
    await this.prisma.syncCursor.update({
      where: { contractAddress: contract.address },
      data: {
        lastBlock: maxBlock,
        lastTxHash: logs[logs.length - 1].transaction_hash,
        lastLogIndex: logs[logs.length - 1].log_index,
      },
    });

    logger.debug(
      {
        contract: contract.name,
        decoded: events.length,
        raw: logs.length,
        maxBlock,
      },
      "Contract polled",
    );

    return events.length;
  }

  /** Refresh state tables via eth_call (RPC) */
  private async refreshState(): Promise<void> {
    try {
      const vaultState = await readVaultState();
      await this.prisma.vaultState.upsert({
        where: { id: "singleton" },
        create: {
          id: "singleton",
          address: ADDRESSES.ObidotVault,
          totalAssets: vaultState.totalAssets.toString(),
          totalSupply: vaultState.totalSupply.toString(),
          totalDeposited: vaultState.totalDeposited.toString(),
          totalWithdrawn: vaultState.totalWithdrawn.toString(),
          depositCap: vaultState.depositCap.toString(),
          maxDailyLoss: vaultState.maxDailyLoss.toString(),
          paused: vaultState.paused,
        },
        update: {
          totalAssets: vaultState.totalAssets.toString(),
          totalSupply: vaultState.totalSupply.toString(),
          totalDeposited: vaultState.totalDeposited.toString(),
          totalWithdrawn: vaultState.totalWithdrawn.toString(),
          depositCap: vaultState.depositCap.toString(),
          maxDailyLoss: vaultState.maxDailyLoss.toString(),
          paused: vaultState.paused,
        },
      });
    } catch (error) {
      logger.warn({ error }, "Failed to refresh vault state via RPC");
    }

    try {
      const oracleState = await readOracleState();
      await this.prisma.oracleState.upsert({
        where: { feedAddress: ADDRESSES.KeeperOracle },
        create: {
          feedAddress: ADDRESSES.KeeperOracle,
          asset: "DOT",
          price: oracleState.price.toString(),
          decimals: oracleState.decimals,
          heartbeat: Number(oracleState.heartbeat),
          roundId: oracleState.roundId,
        },
        update: {
          price: oracleState.price.toString(),
          decimals: oracleState.decimals,
          heartbeat: Number(oracleState.heartbeat),
          roundId: oracleState.roundId,
        },
      });
    } catch (error) {
      logger.warn({ error }, "Failed to refresh oracle state via RPC");
    }
  }
}
