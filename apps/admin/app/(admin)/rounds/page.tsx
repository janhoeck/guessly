import { Pagination } from "@/components/rounds/pagination";
import { RoundFilters } from "@/components/rounds/round-filters";
import { RoundList } from "@/components/rounds/round-list";
import { getBank } from "@/lib/bank";
import { ROUNDS_PER_PAGE, parseRoundQuery } from "@/lib/query";
import { deleteRounds } from "./actions";

/**
 * The bank, a page at a time. The filter is the URL — see lib/query.ts — so
 * this page holds nothing: it reads the address, asks the bank, and renders.
 * The one write on it — several rounds off the shelf at once — is the list's
 * form, wired to its action here the way the round page wires its own.
 */
export default async function RoundsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseRoundQuery(await searchParams);
  const { repository } = await getBank();
  const page = await repository.list(query.filter, {
    offset: (query.page - 1) * ROUNDS_PER_PAGE,
    limit: ROUNDS_PER_PAGE,
  });
  const pages = Math.max(1, Math.ceil(page.total / ROUNDS_PER_PAGE));

  return (
    <>
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-3xl font-semibold">Rounds</h1>
        <p className="max-w-[60ch] text-muted-foreground">
          Everything the fill tool has banked, newest first. Open one to read it
          the way a lobby will, fix what it asks or accepts, swap the picture,
          or take it off the shelf — or tick a few and take them off together.
        </p>
      </div>

      <RoundFilters query={query} />
      <RoundList query={query} rounds={page.rounds} total={page.total} action={deleteRounds} />
      <Pagination query={query} pages={pages} />
    </>
  );
}
