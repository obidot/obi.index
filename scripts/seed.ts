// ── Seed Script (Backfill) ───────────────────────────────
// One-shot script to backfill all historical events from Blockscout.
// Run with: npm run seed

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { CONTRACT_REGISTRY, ADDRESSES } from "../src/config/contracts.js";
import { fetchLogs } from "../src/sync/blockscout.js";
import { decodeLogs } from "../src/sync/decoder.js";
import { handleVaultEvent } from "../src/sync/handlers/vault.js";
import { handleOracleEvent } from "../src/sync/handlers/oracle.js";
import { handleRouterEvent } from "../src/sync/handlers/router.js";
import { handleCrossChainEvent } from "../src/sync/handlers/crosschain.js";
import {
  handleExecutorEvent,
  handleBifrostEvent,
} from "../src/sync/handlers/executor.js";
import { readVaultState, readOracleState } from "../src/sync/rpc.js";
import { logger } from "../src/utils/logger.js";

config();

type EventHandler = (
  prisma: PrismaClient,
  event: import("../src/sync/decoder.js").DecodedEvent,
) => Promise<void>;

const HANDLER_MAP: Record<string, EventHandler> = {
  ObidotVault: handleVaultEvent,
  KeeperOracle: handleOracleEvent,
  OracleRegistry: handleOracleEvent,
  CrossChainRouter: handleCrossChainEvent,
  BifrostAdapter: handleBifrostEvent,
  XCMExecutor: handleExecutorEvent,
  HyperExecutor: handleExecutorEvent,
};

async function seed(): Promise<void> {
  const prisma = new PrismaClient();
  await prisma.$connect();
  logger.info("Connected to PostgreSQL — starting backfill");

  let totalEvents = 0;

  for (const contract of CONTRACT_REGISTRY) {
    logger.info(
      { contract: contract.name, address: contract.address },
      "Backfilling contract",
    );

    // Fetch ALL logs from block 0 (no pagination limit for seed)
    const logs = await fetchLogs(contract.address, 0, 200);
    logger.info(
      { contract: contract.name, rawLogs: logs.length },
      "Raw logs fetched",
    );

    // Decode
    const events = decodeLogs(logs, contract.abi, contract.name);
    logger.info(
      { contract: contract.name, decoded: events.length },
      "Events decoded",
    );

    // Process
    const handler = HANDLER_MAP[contract.name];
    if (handler) {
      for (const event of events) {
        try {
          await handler(prisma, event);
        } catch (error) {
          logger.error(
            { error, event: event.eventName, txHash: event.txHash },
            "Handler error during seed",
          );
        }
      }
    }

    // Update sync cursor
    if (logs.length > 0) {
      const maxBlock = Math.max(...logs.map((l) => l.block_number));
      await prisma.syncCursor.upsert({
        where: { contractAddress: contract.address },
        create: {
          contractAddress: contract.address,
          contractName: contract.name,
          lastBlock: maxBlock,
        },
        update: { lastBlock: maxBlock },
      });
    }

    totalEvents += events.length;
  }

  // Seed token metadata
  logger.info("Seeding token metadata...");
  const tokenEntries = [
    {
      address: ADDRESSES.TestDOT,
      symbol: "tDOT",
      name: "Test DOT",
      decimals: 18,
    },
    {
      address: ADDRESSES.NativeAssetDOT,
      symbol: "DOT",
      name: "Native DOT",
      decimals: 18,
    },
    {
      address: ADDRESSES.NativeAssetUSDC,
      symbol: "USDC",
      name: "Native USDC",
      decimals: 6,
    },
  ];

  for (const token of tokenEntries) {
    await prisma.token.upsert({
      where: { address: token.address },
      create: token,
      update: token,
    });
  }

  // Refresh state from RPC
  logger.info("Refreshing state from RPC...");
  try {
    const vaultState = await readVaultState();
    await prisma.vaultState.upsert({
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
    logger.info("Vault state refreshed");
  } catch (error) {
    logger.warn({ error }, "Failed to read vault state from RPC");
  }

  try {
    const oracleState = await readOracleState();
    await prisma.oracleState.upsert({
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
    logger.info("Oracle state refreshed");
  } catch (error) {
    logger.warn({ error }, "Failed to read oracle state from RPC");
  }

  logger.info({ totalEvents }, "Backfill complete");
  await prisma.$disconnect();
}

seed().catch((error) => {
  logger.fatal({ error }, "Seed failed");
  process.exit(1);
});
