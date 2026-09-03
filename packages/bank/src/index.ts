/**
 * The round bank: verified rounds at rest — Postgres for what each round asks
 * and accepts, a directory of content-addressed files for what it shows.
 *
 * Two processes share this package and the database behind it: the game server
 * draws and deals (`apps/game`), and the fill tool generates and inserts
 * (`tools/fill`). Neither imports the other; this seam is all they agree on.
 */
export { RoundSourceError } from "./error.js";
export {
  answerKey,
  type BankedRound,
  type BankedRoundText,
  type NewBankedRound,
  type RoundRepository,
} from "./repository.js";
export { createPostgresRoundRepository } from "./postgres.js";
export { createInMemoryRoundRepository } from "./memory.js";
export { createImageStore, type ImageStore, type StorableImage } from "./images.js";
