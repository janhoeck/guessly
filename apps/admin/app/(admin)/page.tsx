import { topicById, isTopicId } from "@guessly/protocol";

import { ShelfTable } from "@/components/shelves/shelf-table";
import { getBank } from "@/lib/bank";

/**
 * The stockroom at a glance: every topic and how many rounds each language
 * could be dealt from it. The same numbers the fill tool prints between
 * generations, read off the bank in two queries rather than one per cell.
 */
export default async function ShelvesPage() {
  const { repository } = await getBank();
  const stock = await repository.stock();

  const rounds = stock.reduce((sum, shelf) => sum + shelf.rounds, 0);
  const lyrics = stock
    .filter((shelf) => isTopicId(shelf.topic) && topicById(shelf.topic).kind === "lyrics")
    .reduce((sum, shelf) => sum + shelf.rounds, 0);

  return (
    <>
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-semibold">The shelves</h1>
        <p className="max-w-[60ch] text-muted-foreground">
          Every topic, and how many rounds a lobby in each language could be
          dealt from it. A shelf is only as full as its thinnest language: the
          fill tool tops that one up first, and a round missing a language is
          one you can finish by hand.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          {rounds} {rounds === 1 ? "round" : "rounds"} on {stock.length} shelves ·{" "}
          {rounds - lyrics} {rounds - lyrics === 1 ? "picture" : "pictures"}, {lyrics} lyrics
        </p>
        <ShelfTable stock={stock} />
      </div>
    </>
  );
}
