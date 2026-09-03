import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createImageStore, createPostgresRoundRepository, RoundSourceError } from "@guessly/bank";
import { loadEnvFile, loadFillConfig } from "./config.js";
import { createDeepSeekRoundGenerator } from "./content/deepseek.js";
import { createBankFiller, type Shelf } from "./fill.js";

/**
 * The bank's filling station: `pnpm fill`.
 *
 * This is the only process that talks to the model. It generates rounds in an
 * endless loop — thinnest shelf first, every language in one call — banks each
 * one, and immediately starts the next, until Ctrl+C. The server it fills for
 * never generates anything: an empty shelf there is a failed round, and this
 * tool running for a while is what makes that not happen.
 *
 * Endless is the point: rounds are never consumed, only rotated, so every
 * round banked here is a round some future lobby is dealt in ~0ms. The spend
 * is the operator's foot on the pedal — start it to fill, stop it to stop
 * paying. What that costs in supervision it pays back in visibility: every
 * generation is a line here, not a surprise in a server log.
 */

/** Print the whole stockroom every so often, so a long run stays legible. */
const SHELF_REPORT_EVERY = 10;

loadEnvFile();
const config = loadFillConfig();

const repository = createPostgresRoundRepository(config.databaseUrl);
const images = createImageStore(join(config.dataDir, "images"));
await repository.init();
await images.init();

const generator = createDeepSeekRoundGenerator({
  apiKey: config.deepseekApiKey,
  model: config.deepseekModel,
  reasoningEffort: config.deepseekReasoningEffort,
});
const filler = createBankFiller({ repository, images, generator });

const printShelves = (shelves: Shelf[]): void => {
  console.log("[fill] the shelves:");
  for (const shelf of shelves) {
    const counts = Object.entries(shelf.counts)
      .map(([language, count]) => `${language} ${count}`)
      .join(", ");
    console.log(`[fill]   ${shelf.topic.padEnd(12)} ${counts}`);
  }
};

const controller = new AbortController();
let interrupted = false;
const stop = (signal: string): void => {
  if (interrupted) {
    console.log(`[fill] ${signal} again — leaving now`);
    process.exit(130);
  }
  interrupted = true;
  console.log(`[fill] ${signal} received, stopping (a generation in flight is abandoned)`);
  controller.abort();
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

printShelves(await filler.shelves());
console.log(
  `[fill] filling with ${config.deepseekModel} (${config.deepseekReasoningEffort} reasoning effort), images into ${config.dataDir} — Ctrl+C to stop`,
);

let banked = 0;
while (!controller.signal.aborted) {
  const startedAt = Date.now();
  let outcome;
  try {
    outcome = await filler.fillOnce(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) break;
    throw error;
  }
  const took = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;

  switch (outcome.kind) {
    case "filled": {
      banked += 1;
      console.log(
        `[fill] ${outcome.topic}: "${outcome.subject}" banked in ${took} (${outcome.level} per language, ${banked} this run)`,
      );
      if (banked % SHELF_REPORT_EVERY === 0) printShelves(await filler.shelves());
      break;
    }
    case "duplicate": {
      console.warn(
        `[fill] ${outcome.topic}: "${outcome.subject}" is already banked — resting the topic until ${new Date(outcome.retryAt).toLocaleTimeString()}`,
      );
      break;
    }
    case "failed": {
      const detail =
        outcome.error instanceof RoundSourceError
          ? (outcome.error.detail ?? outcome.error.message)
          : outcome.error;
      console.error(
        `[fill] ${outcome.topic}: failed after ${took} — resting the topic until ${new Date(outcome.retryAt).toLocaleTimeString()}`,
        detail,
      );
      break;
    }
    case "resting": {
      // Every topic is benched — a dead API, or a stockroom of dry topics.
      // Sleep to the earliest bench instead of spinning on the counts.
      const wait = Math.max(outcome.until - Date.now(), 1_000);
      console.log(`[fill] every topic is resting; sleeping ${Math.round(wait / 1000)}s`);
      try {
        await sleep(wait, undefined, { signal: controller.signal });
      } catch {
        // Aborted mid-sleep: the loop condition ends the run.
      }
      break;
    }
  }
}

printShelves(await filler.shelves());
console.log(`[fill] stopped after banking ${banked} round${banked === 1 ? "" : "s"}`);
await repository.close();
