// ── check-sync.ts ────────────────────────────────────────
// Health-check script: queries DB + RPC and prints a summary table
// of what the indexer has ingested so far.
//
// Usage:
//   npm run check-sync
//
// Output:
//   ┌ Sync Cursors    — last indexed block per contract
//   ├ Table Counts    — row counts for every historical table
//   ├ Recent Activity — timestamps of last swap / deposit / oracle update
//   ├ Vault State     — live totalAssets, totalSupply, paused flag
//   └ Oracle State    — live DOT/USD price + staleness

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import {
  readVaultState,
  readOracleState,
  getBlockNumber,
} from "../src/sync/rpc.js";
import { logger } from "../src/utils/logger.js";

config();

// ── Helpers ─────────────────────────────────────────────

function fmt(n: bigint | string, decimals = 18, dp = 4): string {
  const raw = typeof n === "bigint" ? n : BigInt(n);
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const frac = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, dp);
  return `${whole.toLocaleString()}.${fracStr}`;
}

function age(date: Date): string {
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function row(label: string, value: string): void {
  const padded = label.padEnd(32, " ");
  console.log(`  ${padded} ${value}`);
}

function section(title: string): void {
  console.log(`\n${"─".repeat(56)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(56));
}

// ── Main ────────────────────────────────────────────────

async function checkSync(): Promise<void> {
  const prisma = new PrismaClient();
  await prisma.$connect();

  // ── 1. Current chain head ────────────────────────────
  let chainHead: number | null = null;
  try {
    chainHead = await getBlockNumber();
  } catch {
    logger.warn("Could not fetch current block from RPC");
  }

  section("SYNC CURSORS  (last indexed block per contract)");
  if (chainHead !== null) {
    row("Chain head", chainHead.toLocaleString());
  }

  const cursors = await prisma.syncCursor.findMany({
    orderBy: { contractName: "asc" },
  });

  if (cursors.length === 0) {
    console.log("  (no cursors — run npm run seed first)");
  }

  for (const c of cursors) {
    const lag =
      chainHead !== null
        ? ` (${(chainHead - c.lastBlock).toLocaleString()} blocks behind)`
        : "";
    const ts = c.updatedAt ? ` — ${age(c.updatedAt)}` : "";
    row(c.contractName, `block ${c.lastBlock.toLocaleString()}${lag}${ts}`);
  }

  // ── 2. Table counts ──────────────────────────────────
  section("TABLE COUNTS  (historical event rows)");

  // Run counts sequentially to avoid hitting Supabase connection limits
  const deposits = await prisma.deposit.count();
  const withdrawals = await prisma.withdrawal.count();
  const withdrawalRequests = await prisma.withdrawalRequest.count();
  const strategyExecutions = await prisma.strategyExecution.count();
  const localSwaps = await prisma.localSwap.count();
  const intentExecutions = await prisma.intentExecution.count();
  const oracleUpdates = await prisma.oracleUpdate.count();
  const swapExecutions = await prisma.swapExecution.count();
  const crossChainDispatches = await prisma.crossChainDispatch.count();
  const bifrostStrategies = await prisma.bifrostStrategy.count();
  const tokens = await prisma.token.count();

  const tables: [string, number][] = [
    ["Deposit", deposits],
    ["Withdrawal", withdrawals],
    ["WithdrawalRequest", withdrawalRequests],
    ["StrategyExecution", strategyExecutions],
    ["LocalSwap", localSwaps],
    ["IntentExecution", intentExecutions],
    ["OracleUpdate", oracleUpdates],
    ["SwapExecution", swapExecutions],
    ["CrossChainDispatch", crossChainDispatches],
    ["BifrostStrategy", bifrostStrategies],
    ["Token (metadata)", tokens],
  ];

  for (const [name, count] of tables) {
    const flag = count === 0 ? " ⚠  empty" : "";
    row(name, `${count.toLocaleString()} rows${flag}`);
  }

  // ── 3. Recent activity ───────────────────────────────
  section("RECENT ACTIVITY");

  const [lastSwap, lastDeposit, lastOracleUpdate, lastIntent] =
    await Promise.all([
      prisma.swapExecution.findFirst({ orderBy: { blockNumber: "desc" } }),
      prisma.deposit.findFirst({ orderBy: { blockNumber: "desc" } }),
      prisma.oracleUpdate.findFirst({ orderBy: { blockNumber: "desc" } }),
      prisma.intentExecution.findFirst({ orderBy: { blockNumber: "desc" } }),
    ]);

  row(
    "Last SwapExecution",
    lastSwap
      ? `block ${lastSwap.blockNumber} — ${age(lastSwap.timestamp)} (${lastSwap.txHash.slice(0, 12)}...)`
      : "(none)",
  );
  row(
    "Last Deposit",
    lastDeposit
      ? `block ${lastDeposit.blockNumber} — ${age(lastDeposit.timestamp)} (${lastDeposit.txHash.slice(0, 12)}...)`
      : "(none)",
  );
  row(
    "Last OracleUpdate",
    lastOracleUpdate
      ? `block ${lastOracleUpdate.blockNumber} — ${age(lastOracleUpdate.timestamp)} (round ${lastOracleUpdate.roundId})`
      : "(none)",
  );
  row(
    "Last IntentExecution",
    lastIntent
      ? `block ${lastIntent.blockNumber} — ${age(lastIntent.timestamp)} (${lastIntent.txHash.slice(0, 12)}...)`
      : "(none)",
  );

  // Show last 3 swaps if any
  if (swapExecutions > 0) {
    const recentSwaps = await prisma.swapExecution.findMany({
      orderBy: { blockNumber: "desc" },
      take: 3,
    });
    console.log("\n  Recent swaps:");
    for (const s of recentSwaps) {
      const amtIn = fmt(s.amountIn, 18, 4);
      const amtOut = fmt(s.amountOut, 18, 4);
      console.log(
        `    block ${s.blockNumber}  ${s.tokenIn.slice(0, 8)}… →${s.tokenOut.slice(0, 8)}…  ${amtIn} → ${amtOut}  [${s.poolType}]`,
      );
    }
  }

  // ── 4. Live vault state (RPC) ────────────────────────
  section("VAULT STATE  (live RPC read)");

  try {
    const vs = await readVaultState();
    row("totalAssets", `${fmt(vs.totalAssets)} tDOT`);
    row("totalSupply", `${fmt(vs.totalSupply)} shares`);
    row("totalDeposited", `${fmt(vs.totalDeposited)} tDOT`);
    row("totalWithdrawn", `${fmt(vs.totalWithdrawn)} tDOT`);
    row("depositCap", `${fmt(vs.depositCap)} tDOT`);
    row("paused", vs.paused ? "YES ⚠" : "no");

    // Also show what's cached in DB
    const dbVault = await prisma.vaultState.findUnique({
      where: { id: "singleton" },
    });
    if (dbVault) {
      const drift =
        BigInt(dbVault.totalAssets) !== vs.totalAssets
          ? " ⚠  DB stale"
          : " ✓  DB in sync";
      row("DB totalAssets", `${fmt(dbVault.totalAssets)} tDOT${drift}`);
    }
  } catch (error) {
    console.log(`  RPC unavailable: ${(error as Error).message}`);
  }

  // ── 5. Live oracle state (RPC) ───────────────────────
  section("ORACLE STATE  (live RPC read)");

  try {
    const os = await readOracleState();
    const priceUsd = (Number(os.price) / 10 ** os.decimals).toFixed(4);
    const staleMs = Date.now() - Number(os.updatedAt) * 1000;
    const staleSecs = Math.floor(staleMs / 1000);
    const staleFlag = staleSecs > 3600 ? " ⚠  STALE" : " ✓  fresh";
    row("DOT/USD price", `$${priceUsd} (${os.decimals} dec)`);
    row("Last updated", `${staleSecs}s ago${staleFlag}`);
    row("Round ID", os.roundId.toString());
    row("Heartbeat", `${os.heartbeat.toString()}s`);
  } catch (error) {
    console.log(`  RPC unavailable: ${(error as Error).message}`);
  }

  // ── 6. Token metadata ────────────────────────────────
  section("TOKEN METADATA  (DB cache)");

  const tokenList = await prisma.token.findMany({ orderBy: { symbol: "asc" } });
  if (tokenList.length === 0) {
    console.log("  (no tokens — run npm run seed first)");
  }
  for (const t of tokenList) {
    row(`${t.symbol} (${t.decimals} dec)`, t.address);
  }

  console.log(`\n${"─".repeat(56)}\n`);

  await prisma.$disconnect();
}

checkSync().catch((error) => {
  logger.fatal({ error }, "check-sync failed");
  process.exit(1);
});
