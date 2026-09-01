import { createServer } from "node:http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@guessly/protocol";

const PORT = Number(process.env.PORT ?? 3001);

/**
 * An explicit allowlist, never "*" — the socket is the only way into lobby
 * state, and that state is held in this process's memory.
 */
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: { origin: ALLOWED_ORIGINS, methods: ["GET", "POST"] },
});

io.on("connection", (socket) => {
  console.log(`[game] socket connected: ${socket.id}`);

  // Lobby and round handlers are registered here. They stay thin: they
  // validate the payload and call into the store, which owns every rule.

  socket.on("disconnect", (reason) => {
    console.log(`[game] socket disconnected: ${socket.id} (${reason})`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[game] listening on :${PORT}`);
  console.log(`[game] allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
});

const shutdown = (signal: string) => {
  console.log(`[game] ${signal} received, closing`);
  io.close(() => {
    httpServer.close(() => process.exit(0));
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
