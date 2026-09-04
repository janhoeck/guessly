"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ImageStore, RoundRepository, RoundUpdateResult } from "@guessly/bank";
import { isTopicId, languageById, topicById } from "@guessly/protocol";
import { requireAdmin } from "@/lib/auth";
import { getBank } from "@/lib/bank";
import { parseRoundForm, parseSourceUrl } from "@/lib/form";

/**
 * The three things an operator can do to a round, each a server action.
 *
 * Every one of them checks the sign-in for itself — the proxy stood at the
 * door, but these are the writes — and every one of them speaks in
 * sentences, because what comes back is put straight under the button.
 */

export type SaveState =
  | { status: "idle" }
  | { status: "saved"; at: number; note?: string }
  | { status: "error"; message: string; roundId?: number };

export interface DeleteState {
  error: string | null;
}

const GONE = "This round is gone — somebody deleted it while you were looking at it.";

const error = (message: string): SaveState => ({ status: "error", message });

/** The bank's refusal, in the words the editor shows. */
function refused(result: Exclude<RoundUpdateResult, { ok: true }>, topic: string): SaveState {
  switch (result.reason) {
    case "not_found":
      return error(GONE);
    case "no_texts":
      return error("A round needs at least one language, or no lobby could ever be dealt it.");
    case "duplicate": {
      const shelf = isTopicId(topic) ? topicById(topic).label : topic;
      return {
        status: "error",
        message: `${languageById(result.language).label}: the ${shelf} shelf already answers to "${result.answer}" on another round.`,
        roundId: result.roundId,
      };
    }
  }
}

/** Every page that showed this round shows the bank, and the bank changed. */
function freshen(id: number): void {
  revalidatePath("/");
  revalidatePath("/rounds");
  revalidatePath(`/rounds/${id}`);
}

/**
 * The old picture goes when nothing else shows it. Housekeeping rather
 * than the operation: a bucket that would not let go is logged, not shown,
 * because the round was already saved or already gone and that is the news.
 */
async function tidyImage(
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

export async function updateRound(id: number, _previous: SaveState, form: FormData): Promise<SaveState> {
  await requireAdmin();
  const { repository } = await getBank();

  const current = await repository.get(id);
  if (current === null) return error(GONE);

  const parsed = parseRoundForm(form, current);
  if (!parsed.ok) return error(parsed.error);
  if (!parsed.changed) return { status: "saved", at: Date.now(), note: "Nothing had changed." };

  const result = await repository.update(id, parsed.patch);
  if (!result.ok) return refused(result, parsed.patch.topic ?? current.topic);

  freshen(id);
  return { status: "saved", at: Date.now() };
}

export async function replaceImage(id: number, _previous: SaveState, form: FormData): Promise<SaveState> {
  await requireAdmin();
  const { repository, images, sniffImage, maxImageBytes } = await getBank();

  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return error("Choose a picture first.");
  if (file.size > maxImageBytes) {
    const megabytes = (file.size / 1024 / 1024).toFixed(1);
    return error(`That file is ${megabytes} MB; the bank takes up to ${maxImageBytes / 1024 / 1024} MB.`);
  }

  const sourceField = form.get("sourceUrl");
  const source = parseSourceUrl(typeof sourceField === "string" ? sourceField : "");
  if (source !== null && typeof source === "object") return error(source.error);

  // By the bytes, never by the name or the browser's type: the same check
  // the fill tool makes on a download, because what the bank will hold is
  // the bank's rule.
  const bytes = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffImage(bytes);
  if (sniffed === null) return error("That file is not a picture the game can show: PNG, JPEG, GIF, WebP or SVG.");

  const current = await repository.get(id);
  if (current === null) return error(GONE);
  if (current.kind !== "image") return error("A lyrics round has no picture to replace.");

  const filename = await images.save({ bytes, extension: sniffed.extension });
  const result = await repository.update(id, { imageFile: filename, sourceUrl: source });
  if (!result.ok) return refused(result, current.topic);

  await tidyImage(repository, images, current.imageFile, filename);
  freshen(id);
  return { status: "saved", at: Date.now() };
}

/**
 * Bound to the round's id and called through `useActionState`, which passes
 * the previous state and the form after it — neither of which this needs,
 * so neither is named.
 */
export async function deleteRound(id: number): Promise<DeleteState> {
  await requireAdmin();
  const { repository, images } = await getBank();

  const gone = await repository.delete(id);
  if (gone === null) return { error: "This round was already gone." };

  await tidyImage(repository, images, gone.imageFile, null);
  freshen(id);
  redirect("/rounds");
}
