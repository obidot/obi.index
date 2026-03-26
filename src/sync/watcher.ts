// ── Block Watcher ─────────────────────────────────────────
// Emits a "block" event each time the chain head advances.
//
// Strategy (tried in priority order):
//
//   1. Substrate WebSocket — chain_subscribeNewHeads on SUBSTRATE_WS_URL
//      (e.g. wss://asset-hub-paseo-rpc.n.dwellir.com). Confirmed working on
//      Paseo Asset Hub (Dwellir node, March 2026). Lowest latency, real push.
//
//   2. Ethereum WebSocket — eth_subscribe("newHeads") on the Ethereum RPC WS
//      endpoint derived from RPC_URL. Returns -32601 on Polkadot Hub TestNet
//      as of March 2026, but included for future-proofing.
//
//   3. HTTP polling — eth_blockNumber via getBlockNumber() every
//      HEAD_POLL_INTERVAL_MS. Final fallback, always works.
//
// The watcher tries strategy 1 first. If SUBSTRATE_WS_URL is empty or the
// connection fails/is rejected, it tries strategy 2. If that also fails it
// falls back to strategy 3. All transitions are logged clearly.
//
// When either WS strategy succeeds the block number is extracted from the
// Substrate head object (hex-encoded `number` field) or the Ethereum newHead
// object and emitted via the "block" event. The poller listens for these
// events and fires a Blockscout log fetch for each one.

import { EventEmitter } from "events";
import WebSocket from "ws";
import {
  RPC_URL,
  SUBSTRATE_WS_URL,
  HEAD_POLL_INTERVAL_MS,
} from "../config/constants.js";
import { getBlockNumber } from "./rpc.js";
import { logger } from "../utils/logger.js";

// ── Types ────────────────────────────────────────────────

export interface BlockEvent {
  blockNumber: number;
}

export declare interface BlockWatcher {
  on(event: "block", listener: (e: BlockEvent) => void): this;
  off(event: "block", listener: (e: BlockEvent) => void): this;
  emit(event: "block", e: BlockEvent): boolean;
}

// ── Constants ────────────────────────────────────────────

/** How long to wait for a WS connection to open before giving up (ms) */
const WS_OPEN_TIMEOUT_MS = 8_000;
/** Reconnect delay after an unexpected WS close (ms) */
const WS_RECONNECT_DELAY_MS = 5_000;

// ── BlockWatcher ─────────────────────────────────────────

export class BlockWatcher extends EventEmitter {
  private _lastBlock: number | null = null;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _ws: WebSocket | null = null;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _strategy: "substrate" | "eth-ws" | "http" = "substrate";
  private _started = false;

  // ── Public API ──────────────────────────────────────────

  /** Start watching — idempotent. */
  start(): void {
    if (this._started) return;
    this._started = true;
    logger.info("BlockWatcher starting");
    this._tryNext();
  }

  /** Stop watching and clean up resources. */
  stop(): void {
    this._started = false;
    this._stopPoll();
    this._closeWs();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    logger.info("BlockWatcher stopped");
  }

  get lastBlock(): number | null {
    return this._lastBlock;
  }

  // ── Strategy Selection ───────────────────────────────────

  private _tryNext(): void {
    if (!this._started) return;
    switch (this._strategy) {
      case "substrate":
        this._trySubstrateWs();
        break;
      case "eth-ws":
        this._tryEthWs();
        break;
      case "http":
        this._startPoll();
        break;
    }
  }

  private _advanceStrategy(reason: string): void {
    if (this._strategy === "substrate") {
      logger.info(
        { reason },
        "BlockWatcher: Substrate WS failed — trying Ethereum WS",
      );
      this._strategy = "eth-ws";
    } else if (this._strategy === "eth-ws") {
      logger.info(
        { reason, intervalMs: HEAD_POLL_INTERVAL_MS },
        "BlockWatcher: Ethereum WS failed — falling back to HTTP poll",
      );
      this._strategy = "http";
    }
    this._tryNext();
  }

  // ── Strategy 1: Substrate WebSocket ──────────────────────

  private _trySubstrateWs(): void {
    const url = SUBSTRATE_WS_URL;
    if (!url) {
      logger.debug(
        "BlockWatcher: SUBSTRATE_WS_URL not set — skipping Substrate WS",
      );
      this._advanceStrategy("SUBSTRATE_WS_URL empty");
      return;
    }

    logger.info({ url }, "BlockWatcher: connecting to Substrate WS");
    const ws = this._openWs(url, {
      onOpen: () => {
        logger.debug(
          "BlockWatcher: Substrate WS open — subscribing to newHeads",
        );
        ws.send(
          JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "chain_subscribeNewHeads",
            params: [],
          }),
        );
      },
      onMessage: (msg) => this._handleSubstrateMessage(msg),
      onFail: (reason) => this._advanceStrategy(reason),
      onUnexpectedClose: () => {
        logger.warn("BlockWatcher: Substrate WS closed — reconnecting in 5s");
        this._reconnectTimer = setTimeout(
          () => this._trySubstrateWs(),
          WS_RECONNECT_DELAY_MS,
        );
      },
    });
    this._ws = ws;
  }

  private _substrateSubId: string | null = null;

  private _handleSubstrateMessage(msg: Record<string, unknown>): void {
    // Subscription confirmation: { id:1, result: "LbvWOaM1..." }
    if (msg.id === 1) {
      if (msg.error) {
        logger.warn(
          { err: msg.error },
          "BlockWatcher: chain_subscribeNewHeads rejected",
        );
        this._advanceStrategy("subscribe rejected");
        return;
      }
      if (typeof msg.result === "string") {
        this._substrateSubId = msg.result;
        logger.info(
          { subscriptionId: msg.result },
          "BlockWatcher: subscribed to chain_subscribeNewHeads",
        );
      }
      return;
    }

    // Push notification: { method:"chain_newHead", params:{ subscription, result:{number,…} } }
    if (msg.method !== "chain_newHead") return;
    const params = msg.params as
      | { subscription: string; result: { number: string } }
      | undefined;
    if (!params || params.subscription !== this._substrateSubId) return;

    const blockNumber = parseInt(params.result.number, 16);
    if (!isNaN(blockNumber)) this._advance(blockNumber);
  }

  // ── Strategy 2: Ethereum WebSocket ───────────────────────

  private _tryEthWs(): void {
    const wsUrl = RPC_URL.replace(/^http/, "ws");
    logger.info({ url: wsUrl }, "BlockWatcher: connecting to Ethereum WS");

    const ws = this._openWs(wsUrl, {
      onOpen: () => {
        logger.debug(
          "BlockWatcher: Ethereum WS open — subscribing to eth newHeads",
        );
        ws.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_subscribe",
            params: ["newHeads"],
          }),
        );
      },
      onMessage: (msg) => this._handleEthWsMessage(msg),
      onFail: (reason) => this._advanceStrategy(reason),
      onUnexpectedClose: () => {
        logger.warn("BlockWatcher: Ethereum WS closed — reconnecting in 5s");
        this._reconnectTimer = setTimeout(
          () => this._tryEthWs(),
          WS_RECONNECT_DELAY_MS,
        );
      },
    });
    this._ws = ws;
  }

  private _ethWsSubId: string | null = null;

  private _handleEthWsMessage(msg: Record<string, unknown>): void {
    // Subscription confirmation
    if (typeof msg.id === "number" && msg.id === 1) {
      if (msg.error) {
        const err = msg.error as { code?: number };
        if (err.code === -32601) {
          logger.info(
            "BlockWatcher: eth_subscribe not supported (-32601) on this endpoint",
          );
        } else {
          logger.warn({ err }, "BlockWatcher: eth_subscribe rejected");
        }
        this._advanceStrategy("subscribe rejected");
        return;
      }
      if (typeof msg.result === "string") {
        this._ethWsSubId = msg.result;
        logger.info(
          { subscriptionId: msg.result },
          "BlockWatcher: subscribed to eth_subscribe newHeads",
        );
      }
      return;
    }

    // Push notification
    const params = msg.params as
      | { subscription: string; result: { number: string } }
      | undefined;
    if (!params || params.subscription !== this._ethWsSubId) return;

    const blockNumber = parseInt(params.result.number, 16);
    if (!isNaN(blockNumber)) this._advance(blockNumber);
  }

  // ── Strategy 3: HTTP Polling ─────────────────────────────

  private _startPoll(): void {
    if (this._pollTimer) return;
    void this._pollHead();
    this._pollTimer = setInterval(
      () => void this._pollHead(),
      HEAD_POLL_INTERVAL_MS,
    );
  }

  private _stopPoll(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private async _pollHead(): Promise<void> {
    try {
      const blockNumber = await getBlockNumber();
      this._advance(blockNumber);
    } catch (error) {
      logger.warn({ error }, "BlockWatcher: failed to fetch block number");
    }
  }

  // ── Shared WS Helper ─────────────────────────────────────

  /**
   * Open a WebSocket with a standard lifecycle:
   * - open timeout → onFail
   * - open → onOpen
   * - message (parsed JSON) → onMessage
   * - error → onFail
   * - close (unexpected, while started) → onUnexpectedClose
   */
  private _openWs(
    url: string,
    handlers: {
      onOpen: () => void;
      onMessage: (msg: Record<string, unknown>) => void;
      onFail: (reason: string) => void;
      onUnexpectedClose: () => void;
    },
  ): WebSocket {
    const ws = new WebSocket(url);

    const openTimeout = setTimeout(() => {
      logger.warn({ url }, "BlockWatcher: WS open timed out");
      ws.removeAllListeners();
      ws.terminate();
      this._ws = null;
      handlers.onFail("open timeout");
    }, WS_OPEN_TIMEOUT_MS);

    ws.on("open", () => {
      clearTimeout(openTimeout);
      handlers.onOpen();
    });

    ws.on("message", (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      handlers.onMessage(msg);
    });

    ws.on("error", (err) => {
      clearTimeout(openTimeout);
      logger.warn({ err: err.message, url }, "BlockWatcher: WS error");
      ws.removeAllListeners();
      this._ws = null;
      handlers.onFail("ws error");
    });

    ws.on("close", (_code) => {
      clearTimeout(openTimeout);
      if (!this._started) return;
      // If this ws is no longer current (e.g. we already advanced strategy), ignore.
      if (this._ws !== ws) return;
      this._ws = null;
      handlers.onUnexpectedClose();
    });

    return ws;
  }

  // ── Head Advance Logic ───────────────────────────────────

  private _advance(blockNumber: number): void {
    if (this._lastBlock !== null && blockNumber <= this._lastBlock) return;
    const prev = this._lastBlock;
    this._lastBlock = blockNumber;
    logger.debug(
      { blockNumber, prev, strategy: this._strategy },
      "BlockWatcher: new head",
    );
    this.emit("block", { blockNumber });
  }

  // ── Cleanup ───────────────────────────────────────────────

  private _closeWs(): void {
    if (this._ws) {
      try {
        this._ws.removeAllListeners();
        this._ws.terminate();
      } catch {
        // ignore
      }
      this._ws = null;
    }
    this._substrateSubId = null;
    this._ethWsSubId = null;
  }
}
