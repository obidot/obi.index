// ── e2e-test.ts ──────────────────────────────────────────────────────────────
// End-to-end integration test: emits on-chain events and verifies they are
// indexed by the obi.index poller within a time budget.
//
// Tests:
//   1. Oracle Update  — calls KeeperOracle.forceUpdatePrice(), polls DB for new row
//   2. Local Swap     — 2-hop tDOT→USDT→tETH via LocalSwapHarness v2 staged flow
//
// Usage:
//   bun run e2e-test
//   (indexer must be running in another terminal: bun run indexer -- --watch)
//
// Private key resolution order:
//   1. process.env.PRIVATE_KEY
//   2. process.env.AGENT_PRIVATE_KEY
//   3. ../obi.router/.env (PRIVATE_KEY field)
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  concat,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ── Load env ─────────────────────────────────────────────────────────────────

config(); // loads obi.index/.env

// Resolve private key — try multiple sources
function resolvePrivateKey(): Hex {
  const candidates = [process.env.PRIVATE_KEY, process.env.AGENT_PRIVATE_KEY];

  for (const c of candidates) {
    if (c && c.trim().length > 0) {
      const key = c.trim().startsWith("0x") ? c.trim() : `0x${c.trim()}`;
      return key as Hex;
    }
  }

  // Fallback: try to load from ../obi.router/.env
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const routerEnvPath = path.resolve(__dirname, "../../obi.router/.env");
  if (fs.existsSync(routerEnvPath)) {
    const content = fs.readFileSync(routerEnvPath, "utf8");
    const match = content.match(/^PRIVATE_KEY\s*=\s*(.+)$/m);
    if (match && match[1]) {
      const key = match[1].trim();
      const hex = key.startsWith("0x") ? key : `0x${key}`;
      console.log(`  [env] loaded PRIVATE_KEY from ../obi.router/.env`);
      return hex as Hex;
    }
  }

  throw new Error(
    "No private key found. Set PRIVATE_KEY or AGENT_PRIVATE_KEY in .env, " +
      "or ensure ../obi.router/.env has PRIVATE_KEY.",
  );
}

// ── Chain / contract constants ────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "https://eth-rpc-testnet.polkadot.io/";
const CHAIN_ID = 420420417;

const VAULT_ADDRESS = "0x4D327724C167ac4D66125a5DcC0724DDaCD63fF9" as Address;
const KEEPER_ORACLE_ADDRESS =
  "0xf64d93DC125AC1B366532BBbA165615f6D566C7F" as Address;
// LocalSwapHarness v2 — Phase 19, targets Phase 19 vault
const HARNESS_ADDRESS = "0xD8b7e6f0ba84b415038475E5dEc4E50D5b644d09" as Address;
const TDOT_ADDRESS = "0x2402C804aD8a6217BF73D8483dA7564065c56083" as Address;
// tETH — old deployment; this is what MinimalV2Pair(tETH/USDT) actually holds
const TETH_ADDRESS = "0xf1e675bF8B35186fEAe858BB33629b761506Df60" as Address;
const USDT_ADDRESS = "0x43C10B8f1711533aaF5AE82AB36A08B6Dc197938" as Address;
const PAIR_DOT_USDT = "0x8c2447d8F61599870AbEe782fa958d20a28e9cA8" as Address;
const PAIR_ETH_USDT = "0x81b6C6609d5E4AB31d5952ae0c17d4202a76f702" as Address;

// PoolType.Custom = 3 (UniswapV2PoolAdapter slot)
const POOL_TYPE_CUSTOM = 3;

// EIP-712 StrategyIntent typehash (matches ObidotVault.sol exactly)
const STRATEGY_INTENT_TYPEHASH = keccak256(
  new TextEncoder().encode(
    "StrategyIntent(address asset,uint256 amount,uint256 minReturn,uint256 maxSlippageBps,uint256 deadline,uint256 nonce,bytes xcmCall,uint32 targetParachain,address targetProtocol)",
  ),
);

// ── Minimal ABIs ─────────────────────────────────────────────────────────────

const KEEPER_ORACLE_ABI = [
  {
    type: "function",
    name: "forceUpdatePrice",
    inputs: [{ name: "answer", type: "int256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

const VAULT_ABI = [
  {
    type: "function",
    name: "nonces",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "DOMAIN_SEPARATOR",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasRole",
    inputs: [
      { name: "role", type: "bytes32" },
      { name: "account", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "STRATEGIST_ROLE",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowedTargets",
    inputs: [{ name: "protocol", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
] as const;

const HARNESS_ABI = [
  {
    type: "function",
    name: "setLeg1",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      { name: "pool", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint8" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "setLeg2",
    inputs: [
      { name: "tokenOut", type: "address" },
      { name: "pool", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "poolTypeU8", type: "uint8" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "executeStagedRoute2",
    inputs: [],
    outputs: [{ name: "totalOut", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;

const ERC20_ABI = [
  {
    type: "function",
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const PAIR_ABI = [
  {
    type: "function",
    name: "getReserves",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
    stateMutability: "view",
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pass(msg: string): void {
  console.log(`  ✓  ${msg}`);
}

function fail(msg: string): void {
  console.log(`  ✗  ${msg}`);
}

function info(msg: string): void {
  console.log(`     ${msg}`);
}

async function pollUntil<T>(
  label: string,
  check: () => Promise<T | null>,
  timeoutMs = 90_000,
  intervalMs = 2_000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await check();
    if (result !== null) {
      const latency = Date.now() - start;
      pass(`${label} — indexed in ${latency}ms`);
      return result;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout: ${label} not indexed within ${timeoutMs}ms`);
}

// ── UniswapV2 getAmountOut (0.3% fee) ─────────────────────────────────────────

function getAmountOut(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint {
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

// ── EIP-712 sign ─────────────────────────────────────────────────────────────

function buildStructHash(
  asset: Address,
  amount: bigint,
  minReturn: bigint,
  maxSlippageBps: bigint,
  deadline: bigint,
  nonce: bigint,
  targetParachain: number,
  targetProtocol: Address,
): Hex {
  // xcmCall = hex"00" — hash it as bytes
  const xcmCallHash = keccak256("0x00");

  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "bytes32, address, uint256, uint256, uint256, uint256, uint256, bytes32, uint32, address",
    ),
    [
      STRATEGY_INTENT_TYPEHASH,
      asset,
      amount,
      minReturn,
      maxSlippageBps,
      deadline,
      nonce,
      xcmCallHash,
      targetParachain,
      targetProtocol,
    ],
  );

  return keccak256(encoded);
}

async function signIntent(
  account: ReturnType<typeof privateKeyToAccount>,
  domainSeparator: Hex,
  structHash: Hex,
): Promise<{ r: Hex; s: Hex; v: number }> {
  const digest = keccak256(concat(["0x1901", domainSeparator, structHash]));

  const sig = await account.sign({ hash: digest });
  // sig is 65-byte hex: r(32) + s(32) + v(1)
  const r = `0x${sig.slice(2, 66)}` as Hex;
  const s = `0x${sig.slice(66, 130)}` as Hex;
  const vHex = parseInt(sig.slice(130, 132), 16);
  // Normalise v: if 0 or 1 → add 27
  const v = vHex < 27 ? vHex + 27 : vHex;
  return { r, s, v };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("\n══════════════════════════════════════════════════════");
  console.log("  obi.index  E2E Integration Test");
  console.log("══════════════════════════════════════════════════════\n");

  // ── Private key + accounts ───────────────────────────────────────────
  const privateKey = resolvePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const deployer = account.address;
  console.log(`  Deployer : ${deployer}`);
  console.log(`  RPC      : ${RPC_URL}\n`);

  // ── Viem clients ─────────────────────────────────────────────────────
  const polkadotHubTestnet = {
    id: CHAIN_ID,
    name: "Polkadot Hub TestNet",
    nativeCurrency: { name: "DOT", symbol: "DOT", decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  } as const;

  const publicClient = createPublicClient({
    chain: polkadotHubTestnet,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: polkadotHubTestnet,
    transport: http(RPC_URL),
  });

  // ── Prisma ────────────────────────────────────────────────────────────
  const prisma = new PrismaClient();
  await prisma.$connect();

  let passed = 0;
  let failed = 0;

  // ════════════════════════════════════════════════════════════════════════
  //  Pre-flight checks
  // ════════════════════════════════════════════════════════════════════════

  console.log("── Pre-flight checks ──────────────────────────────────");

  const DEFAULT_ADMIN_ROLE =
    "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;

  // Read admin role + strategistRole first (strategistRole needed for second call)
  const [isAdmin, strategistRole] = await Promise.all([
    publicClient.readContract({
      address: KEEPER_ORACLE_ADDRESS,
      abi: KEEPER_ORACLE_ABI,
      functionName: "hasRole",
      args: [DEFAULT_ADMIN_ROLE, deployer],
    }),
    publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: VAULT_ABI,
      functionName: "STRATEGIST_ROLE",
    }),
  ]);

  // Now read remaining checks in parallel
  const [isStrategistActual, pairDotUsdtAllowed, pairEthUsdtAllowed] =
    await Promise.all([
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "hasRole",
        args: [strategistRole as Hex, deployer],
      }) as Promise<boolean>,
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "allowedTargets",
        args: [PAIR_DOT_USDT],
      }) as Promise<boolean>,
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "allowedTargets",
        args: [PAIR_ETH_USDT],
      }) as Promise<boolean>,
    ]);

  if (isAdmin) {
    pass("deployer has DEFAULT_ADMIN_ROLE on KeeperOracle");
  } else {
    fail(
      "deployer does NOT have DEFAULT_ADMIN_ROLE on KeeperOracle — Test 1 will fail",
    );
    failed++;
  }

  if (isStrategistActual) {
    pass("deployer has STRATEGIST_ROLE on vault");
  } else {
    fail("deployer does NOT have STRATEGIST_ROLE on vault — Test 2 will fail");
    failed++;
  }

  if (pairDotUsdtAllowed) {
    pass(`tDOT/USDT pair (${PAIR_DOT_USDT}) is allowedTarget on vault`);
  } else {
    fail(`tDOT/USDT pair NOT in allowedTargets — Test 2 will fail`);
    failed++;
  }

  if (pairEthUsdtAllowed) {
    pass(`tETH/USDT pair (${PAIR_ETH_USDT}) is allowedTarget on vault`);
  } else {
    fail(`tETH/USDT pair NOT in allowedTargets — Test 2 will fail`);
    failed++;
  }

  console.log();

  // ════════════════════════════════════════════════════════════════════════
  //  Test 1 — Oracle Update
  // ════════════════════════════════════════════════════════════════════════

  console.log("── Test 1: Oracle Update ──────────────────────────────");

  // Snapshot current count
  const oracleBefore = await prisma.oracleUpdate.count();
  info(`OracleUpdate rows before: ${oracleBefore}`);

  // Call forceUpdatePrice — use a slightly random price so it's a genuine new round
  const newPrice = 700_000_000n + BigInt(Math.floor(Math.random() * 10_000));
  info(`Sending KeeperOracle.forceUpdatePrice(${newPrice})...`);

  try {
    const txHash = await walletClient.writeContract({
      address: KEEPER_ORACLE_ADDRESS,
      abi: KEEPER_ORACLE_ABI,
      functionName: "forceUpdatePrice",
      args: [newPrice],
      gas: 200_000n,
    });
    info(`tx submitted: ${txHash}`);

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 120_000,
    });
    info(`confirmed at block ${receipt.blockNumber}`);

    // Poll DB until new row appears
    const txHashLower = txHash.toLowerCase();
    const row = await pollUntil(
      "OracleUpdate indexed",
      async () => {
        const count = await prisma.oracleUpdate.count();
        if (count > oracleBefore) {
          // Return the new row
          return prisma.oracleUpdate.findFirst({
            orderBy: { blockNumber: "desc" },
          });
        }
        return null;
      },
      90_000,
      2_000,
    );
    info(
      `  round=${row!.roundId}  price=${row!.price}  block=${row!.blockNumber}`,
    );
    passed++;
  } catch (err) {
    fail(`Oracle update failed: ${(err as Error).message}`);
    failed++;
  }

  console.log();

  // ════════════════════════════════════════════════════════════════════════
  //  Test 2 — Local Swap (tDOT → USDT → tETH, 2-hop staged harness)
  // ════════════════════════════════════════════════════════════════════════

  console.log("── Test 2: Local Swap (tDOT → USDT → tETH) ───────────────");

  const preflightOk =
    isStrategistActual && pairDotUsdtAllowed && pairEthUsdtAllowed;

  if (!preflightOk) {
    fail("Skipping — pre-flight checks failed (see above)");
    failed++;
  } else {
    const localSwapBefore = await prisma.localSwap.count();
    const swapExecBefore = await prisma.swapExecution.count();
    info(`LocalSwap rows before:     ${localSwapBefore}`);
    info(`SwapExecution rows before: ${swapExecBefore}`);

    try {
      // ── Step 0: fund vault with tDOT if needed ──────────────────────
      const vaultTdot = (await publicClient.readContract({
        address: TDOT_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [VAULT_ADDRESS],
      })) as bigint;

      info(`vault tDOT balance: ${vaultTdot}`);

      if (vaultTdot < 1_000_000_000_000_000_000n) {
        info("Funding vault with 2 tDOT...");
        const fundTx = await walletClient.writeContract({
          address: TDOT_ADDRESS,
          abi: ERC20_ABI,
          functionName: "transfer",
          args: [VAULT_ADDRESS, 2_000_000_000_000_000_000n],
          gas: 100_000n,
        });
        info(`fund tx: ${fundTx}`);
        await publicClient.waitForTransactionReceipt({
          hash: fundTx,
          timeout: 120_000,
        });
        info("vault funded");
      }

      // ── Step 1: read nonce + domain separator ───────────────────────
      const [nonce, domainSeparator] = (await Promise.all([
        publicClient.readContract({
          address: VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: "nonces",
          args: [deployer],
        }),
        publicClient.readContract({
          address: VAULT_ADDRESS,
          abi: VAULT_ABI,
          functionName: "DOMAIN_SEPARATOR",
        }),
      ])) as [bigint, Hex];

      info(`vault nonce for deployer: ${nonce}`);

      const amountIn = 1_000_000_000_000_000_000n; // 1 tDOT (18 dec)
      const maxSlippageBps = 200n;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 7200);

      // ── Step 2: estimate USDT out from leg 1 (tDOT→USDT) ───────────
      // PAIR_DOT_USDT: token0=tDOT, token1=USDT
      const { result: reservesDotUsdt } = await publicClient.simulateContract({
        address: PAIR_DOT_USDT,
        abi: PAIR_ABI,
        functionName: "getReserves",
      });
      const [r0DotUsdt, r1DotUsdt] = reservesDotUsdt as [
        bigint,
        bigint,
        number,
      ];
      const estimatedUsdt = getAmountOut(amountIn, r0DotUsdt, r1DotUsdt);
      // Use 99% as the signed estimate so vault idle check passes
      // even if reserves shift slightly before execution
      const conservativeUsdt = (estimatedUsdt * 99n) / 100n;
      info(
        `estimated USDT out: ${estimatedUsdt} → using conservative: ${conservativeUsdt}`,
      );

      // ── Step 3: sign leg 1 (tDOT → USDT) ───────────────────────────
      const leg1Hash = buildStructHash(
        TDOT_ADDRESS,
        amountIn,
        0n,
        maxSlippageBps,
        deadline,
        nonce,
        0,
        PAIR_DOT_USDT,
      );
      const sig1 = await signIntent(account, domainSeparator, leg1Hash);
      info(`leg1 sig: r=${sig1.r.slice(0, 10)}… v=${sig1.v}`);

      // ── Step 4: sign leg 2 (USDT → tETH) ───────────────────────────
      // asset=USDT, amount=conservativeUsdt, nonce=nonce+1
      const leg2Hash = buildStructHash(
        USDT_ADDRESS,
        conservativeUsdt,
        0n,
        maxSlippageBps,
        deadline,
        nonce + 1n,
        0,
        PAIR_ETH_USDT,
      );
      const sig2 = await signIntent(account, domainSeparator, leg2Hash);
      info(`leg2 sig: r=${sig2.r.slice(0, 10)}… v=${sig2.v}`);

      // ── Step 5: setLeg1 ─────────────────────────────────────────────
      info("Sending LocalSwapHarness.setLeg1()...");
      const setLeg1Tx = await walletClient.writeContract({
        address: HARNESS_ADDRESS,
        abi: HARNESS_ABI,
        functionName: "setLeg1",
        args: [
          TDOT_ADDRESS,
          USDT_ADDRESS,
          PAIR_DOT_USDT,
          amountIn,
          nonce,
          sig1.r,
          sig1.s,
          sig1.v,
        ],
        gas: 300_000n,
      });
      info(`setLeg1 tx: ${setLeg1Tx}`);
      const leg1Receipt = await publicClient.waitForTransactionReceipt({
        hash: setLeg1Tx,
        timeout: 120_000,
      });
      if (leg1Receipt.status === "reverted")
        throw new Error("setLeg1 reverted");
      info(`setLeg1 confirmed at block ${leg1Receipt.blockNumber}`);

      // ── Step 6: setLeg2 ─────────────────────────────────────────────
      info("Sending LocalSwapHarness.setLeg2()...");
      const setLeg2Tx = await walletClient.writeContract({
        address: HARNESS_ADDRESS,
        abi: HARNESS_ABI,
        functionName: "setLeg2",
        args: [
          TETH_ADDRESS,
          PAIR_ETH_USDT,
          conservativeUsdt,
          nonce + 1n,
          sig2.r,
          sig2.s,
          sig2.v,
          POOL_TYPE_CUSTOM,
          deadline,
        ],
        gas: 300_000n,
      });
      info(`setLeg2 tx: ${setLeg2Tx}`);
      const leg2Receipt = await publicClient.waitForTransactionReceipt({
        hash: setLeg2Tx,
        timeout: 120_000,
      });
      if (leg2Receipt.status === "reverted")
        throw new Error("setLeg2 reverted");
      info(`setLeg2 confirmed at block ${leg2Receipt.blockNumber}`);

      // ── Step 7: executeStagedRoute2 ─────────────────────────────────
      info("Sending LocalSwapHarness.executeStagedRoute2()...");
      const execTx = await walletClient.writeContract({
        address: HARNESS_ADDRESS,
        abi: HARNESS_ABI,
        functionName: "executeStagedRoute2",
        args: [],
        gas: 5_000_000n,
      });
      info(`executeStagedRoute2 tx: ${execTx}`);
      const execReceipt = await publicClient.waitForTransactionReceipt({
        hash: execTx,
        timeout: 120_000,
      });
      if (execReceipt.status === "reverted") {
        throw new Error("executeStagedRoute2 reverted on-chain");
      }
      info(`executeStagedRoute2 confirmed at block ${execReceipt.blockNumber}`);

      // ── Step 8: poll DB for 2 new LocalSwap + SwapExecution rows ────
      await pollUntil(
        "LocalSwap indexed (×2)",
        async () => {
          const count = await prisma.localSwap.count();
          return count >= localSwapBefore + 2 ? count : null;
        },
        120_000,
        2_000,
      );

      await pollUntil(
        "SwapExecution indexed (×2)",
        async () => {
          const count = await prisma.swapExecution.count();
          return count >= swapExecBefore + 2 ? count : null;
        },
        120_000,
        2_000,
      );

      // Print last two swaps
      const lastSwaps = await prisma.swapExecution.findMany({
        orderBy: { blockNumber: "desc" },
        take: 2,
      });
      for (const s of lastSwaps.reverse()) {
        const amtIn = Number(s.amountIn) / 1e18;
        const amtOut = Number(s.amountOut) / 1e18;
        info(
          `  ${s.tokenIn.slice(0, 10)}… → ${s.tokenOut.slice(0, 10)}…  ${amtIn.toFixed(6)} → ${amtOut.toFixed(6)}  [${s.poolType}]`,
        );
      }

      passed++;
    } catch (err) {
      fail(`Local swap failed: ${(err as Error).message}`);
      console.error(err);
      failed++;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  //  Summary
  // ════════════════════════════════════════════════════════════════════════

  console.log();
  console.log("══════════════════════════════════════════════════════");
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════════════\n");

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
