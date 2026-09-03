import { createServer, type ServerResponse } from "node:http";
import { Server } from "socket.io";
import { SWEEP_INTERVAL_MS } from "@guessly/protocol";
import { createPostgresRoundRepository, createS3ImageStore } from "@guessly/bank";
import { createBankedRoundSource } from "./bank/source.js";
import { loadConfig, loadEnvFile } from "./config.js";
import { createLobbyStore } from "./lobby/store.js";
import { registerSocketHandlers, type GameServer } from "./socket/register.js";

// Before anything reads process.env. Nothing else loads the file, and turbo
// runs tasks in strict env mode, so this is the only way a local override
// like S3_ENDPOINT or PUBLIC_BASE_URL reaches the process.
loadEnvFile();
const config = loadConfig();

// The bank: rounds in Postgres, pictures in an S3 bucket — both expected to
// outlive the process; that persistence is the whole point. Nothing of either
// is on this server's disk, so it needs no volume to survive a deploy.
const repository = createPostgresRoundRepository(config.databaseUrl);
const images = createS3ImageStore(config.s3);
await repository.init();
await images.init();

/**
 * Banked images, from our own origin. The bucket is private and the players
 * never see it: this route reads the object and streams it out, so the URL a
 * round carries is the same one it carried when the picture was a file — and
 * there is no third-party host, no CORS and no signed link to expire.
 *
 * The name is content-addressed and validated by the store, so an unknown or
 * malformed one is a 404 before the bucket is asked, and a known one can be
 * cached forever — different picture, different name.
 */
const serveImage = async (filename: string, res: ServerResponse): Promise<void> => {
  let found;
  try {
    found = await images.open(filename);
  } catch (error) {
    // The bucket itself is unreachable. Saying "not found" here would send
    // whoever reads the log hunting for a picture that is exactly where it
    // should be, so this is the store's failure and it says so.
    console.error(`[game] image store failed for ${filename}`, error);
    res.writeHead(502, { "content-type": "text/plain" });
    res.end("Image store unavailable");
    return;
  }

  if (found === null) {
    // A name we never issued, or one we did and the bucket no longer holds —
    // a wiped store next to a kept database. The browser's onError is the last
    // mile, same as ever.
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "content-type": found.contentType,
    ...(found.contentLength === null ? {} : { "content-length": found.contentLength }),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  });
  found.body.on("error", (error) => {
    console.error(`[game] image stream failed for ${filename}`, error);
    res.destroy();
  });
  found.body.pipe(res);
};

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url?.startsWith("/img/")) {
    void serveImage(req.url.slice("/img/".length), res);
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
// Read-only: the server is dealt rounds from the bank and never generates
// one. Filling the bank is the fill tool's job — `pnpm fill`, which is also
// where the API key lives now.
const source = createBankedRoundSource({
  repository,
  publicBaseUrl: config.publicBaseUrl,
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
  console.log(
    `[game] round bank in Postgres, images in ${config.s3.bucket} at ${config.s3.endpoint}, served from ${config.publicBaseUrl}/img/`,
  );
});

const shutdown = (signal: string) => {
  console.log(`[game] ${signal} received, closing`);
  clearInterval(sweepTimer);
  io.close(() => {
    httpServer.close(() => {
      void repository.close().finally(() => process.exit(0));
    });
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
