import "server-only";
import type { ImageStore, RoundRepository } from "@guessly/bank";

/**
 * The bucket's housekeeping after a write: a picture nothing shows any more
 * is removed. Housekeeping rather than the operation — a bucket that would
 * not let go is logged, not shown, because the round was already saved or
 * already gone and that is the news.
 */

/**
 * `previous` goes when it is not `keep` and nothing else points at it.
 * Content addressing means two rounds with the same bytes share one object,
 * so `imageReferences` has the last word.
 */
export async function tidyImage(
  repository: RoundRepository,
  images: ImageStore,
  previous: string | null,
  keep: string | null,
): Promise<void> {
  if (previous === null || previous === keep) return;
  try {
    if ((await repository.imageReferences(previous)) === 0) await images.delete(previous);
  } catch (cause) {
    console.error(`[admin] could not remove ${previous} from the bucket`, cause);
  }
}

/**
 * After several rounds have gone: each picture they showed, once — two of
 * them may well have shown the same one, and asking the bucket twice for
 * one object is a second error in the log for nothing.
 */
export async function tidyImages(
  repository: RoundRepository,
  images: ImageStore,
  files: readonly (string | null)[],
): Promise<void> {
  const shown = new Set(files.filter((file): file is string => file !== null));
  for (const file of shown) await tidyImage(repository, images, file, null);
}
