// ── Logger (pino) ────────────────────────────────────────
import pino from "pino";
import { LOG_LEVEL } from "../config/constants.js";

export const logger = pino({
  level: LOG_LEVEL,
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});
