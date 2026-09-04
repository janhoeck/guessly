"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getBank } from "@/lib/bank";
import { parseSelectedIds } from "@/lib/form";
import { tidyImages } from "@/lib/tidy-image";

/**
 * The list's one write: whatever is ticked, off the shelf in one go.
 *
 * Checks the sign-in for itself like every write here, and answers in a
 * sentence's worth of numbers rather than a sentence, because the notice
 * that shows them is the client's to word. `missing` is the rounds asked
 * for that were already gone — somebody else's deletion between the page
 * loading and the click — which is news, not a failure.
 */

export type DeleteManyState =
  | { status: "idle" }
  | { status: "deleted"; deleted: number; missing: number; at: number }
  | { status: "error"; message: string };

export async function deleteRounds(_previous: DeleteManyState, form: FormData): Promise<DeleteManyState> {
  await requireAdmin();

  const ids = parseSelectedIds(form);
  if (ids.length === 0) return { status: "error", message: "Tick the rounds to delete first." };

  const { repository, images } = await getBank();
  const gone = await repository.deleteMany(ids);
  await tidyImages(
    repository,
    images,
    gone.map((round) => round.imageFile),
  );

  // Every page that showed any of them shows the bank, and the bank changed.
  revalidatePath("/");
  revalidatePath("/rounds");
  for (const round of gone) revalidatePath(`/rounds/${round.id}`);

  return { status: "deleted", deleted: gone.length, missing: ids.length - gone.length, at: Date.now() };
}
