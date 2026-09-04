import "server-only";
import type { ImageStore, RoundRepository } from "@guessly/bank";
import { loadAdminConfig, loadEnvFallback } from "@/lib/config";

/**
 * The bank, opened once per process.
 *
 * The admin is the third process on the one database — after the game
 * server that draws from it and the fill tool that writes it — and it
 * reaches the bank the same way they do: `@guessly/bank`, a Postgres and a
 * bucket. Nothing in this app talks to either directly, and nothing in this
 * app imports the package's *values* anywhere but here — see below for why.
 *
 * It is opened on the first request that needs it rather than at boot,
 * because a Next server has no boot of its own to hook. And it is parked on
 * `globalThis` rather than in a module variable, because `next dev` reloads
 * server modules on every edit and a module variable would be a fresh pool,
 * a fresh `HeadBucket` and a fresh migration run each time.
 */

type BankModule = typeof import("@guessly/bank");

export interface Bank {
  repository: RoundRepository;
  images: ImageStore;
  /**
   * The bank's own check on a picture's bytes, and the most it will take —
   * for the upload, handed out from here because this is the one place the
   * module is loaded.
   */
  sniffImage: BankModule["sniffImage"];
  maxImageBytes: number;
}

/**
 * Loaded with a native `import` at runtime, never bundled. The bank finds its
 * migrations relative to its own file, and a copy of it inside a Next chunk
 * would look for them beside the chunk. `serverExternalPackages` exists for
 * exactly this, but it only reaches packages that live in `node_modules` for
 * real — a workspace package is a symlink to a directory the bundler treats
 * as source and bundles anyway. The comment is what both bundlers honour, and
 * Node then resolves the name from the chunk's location the ordinary way.
 */
const loadBankModule = (): Promise<BankModule> => import(/* webpackIgnore: true */ "@guessly/bank");

const shared = globalThis as typeof globalThis & { __guesslyAdminBank?: Promise<Bank> };

async function openBank(): Promise<Bank> {
  loadEnvFallback();
  const bank = await loadBankModule();
  const config = loadAdminConfig(bank.readS3Config);
  const repository = bank.createPostgresRoundRepository(config.databaseUrl);
  const images = bank.createS3ImageStore(config.s3);
  await repository.init();
  await images.init();
  return { repository, images, sniffImage: bank.sniffImage, maxImageBytes: bank.MAX_IMAGE_BYTES };
}

export function getBank(): Promise<Bank> {
  shared.__guesslyAdminBank ??= openBank().catch((error: unknown) => {
    // Not cached: an operator fixing a variable expects the next request to
    // try again, not to be handed the same failure until a restart.
    delete shared.__guesslyAdminBank;
    throw error;
  });
  return shared.__guesslyAdminBank;
}
