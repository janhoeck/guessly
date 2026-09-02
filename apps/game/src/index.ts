import { createServer } from "node:http";
import { Server } from "socket.io";
import { SWEEP_INTERVAL_MS } from "@guessly/protocol";
import { loadConfig, loadEnvFile } from "./config.js";
import { createClaudeRoundSource } from "./content/claude.js";
import { createLobbyStore } from "./lobby/store.js";
import { registerSocketHandlers, type GameServer } from "./socket/register.js";

// Before anything reads process.env. Nothing else loads the file, and turbo
// runs tasks in strict env mode, so this is the only way a local
// ANTHROPIC_API_KEY reaches the process.
loadEnvFile();
const config = loadConfig();

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

const io: GameServer = new Server(httpServer, {
  cors: { origin: config.allowedOrigins, methods: ["GET", "POST"] },
  /**
   * Nothing in this protocol is larger than a nickname and a lobby code, so a
   * megabyte of default headroom is a megabyte of attack surface.
   */
  maxHttpBufferSize: 8_192,
});

const store = createLobbyStore();
const source = createClaudeRoundSource({
  apiKey: config.anthropicApiKey,
  model: config.anthropicModel,
});
const adapter = registerSocketHandlers(io, store, source);

/**
 * The lobby's timer. Grace periods and both lobby TTLs are all evaluated here,
 * which is what lets the store stay pure and testable with a fake clock instead
 * of a fleet of setTimeouts. Rounds have their own, short-lived timers — see
 * game/rounds.ts — because a countdown cannot wait up to a minute to be noticed.
 */
const sweepTimer = setInterval(() => {
  try {
    adapter.sweep();
  } catch (error) {
    console.error("[game] sweep failed", error);
  }
}, SWEEP_INTERVAL_MS);

httpServer.listen(config.port, () => {
  console.log(`[game] listening on :${config.port}`);
  console.log(`[game] allowed origins: ${config.allowedOrigins.join(", ")}`);
  console.log(`[game] rounds sourced from ${config.anthropicModel}`);
});

const shutdown = (signal: string) => {
  console.log(`[game] ${signal} received, closing`);
  clearInterval(sweepTimer);
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
