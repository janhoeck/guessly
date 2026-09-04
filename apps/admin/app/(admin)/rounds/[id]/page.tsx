import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { BankedRoundRecord } from "@guessly/bank";
import { isTopicId, topicById } from "@guessly/protocol";

import { DeleteRound } from "@/components/rounds/delete-round";
import { ReplaceImage } from "@/components/rounds/replace-image";
import { RoundEditor } from "@/components/rounds/round-editor";
import { describeVotes } from "@/components/rounds/vote-tally";
import { Badge } from "@guessly/ui/components/ui/badge";
import { getBank } from "@/lib/bank";
import { deleteRound, replaceImage, updateRound } from "./actions";

/**
 * One round: what it shows on the left, what it asks and accepts on the
 * right, and the way to be rid of it underneath. The page composes; the
 * three islands are the forms, each around its own server action.
 */

type Params = { params: Promise<{ id: string }> };

/** Read once for the title and the page both, however many times it is asked. */
const loadRound = cache(async (raw: string): Promise<BankedRoundRecord | null> => {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const { repository } = await getBank();
  return repository.get(id);
});

/** Read on the way in: the upload form says how much it will take. */
const maxImageBytes = async (): Promise<number> => (await getBank()).maxImageBytes;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const round = await loadRound((await params).id);
  return { title: round === null ? "Not found" : round.subject };
}

const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function RoundPage({ params }: Params) {
  const round = await loadRound((await params).id);
  if (round === null) notFound();

  const topic = isTopicId(round.topic) ? topicById(round.topic) : null;
  const dealt =
    round.timesServed === 0
      ? "Never dealt yet."
      : `Dealt ${round.timesServed} ${round.timesServed === 1 ? "time" : "times"}${
          round.lastServedAt === null ? "" : `, last on ${when.format(round.lastServedAt)}`
        }.`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link
          href="/rounds"
          className="rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          Rounds
        </Link>
        <span aria-hidden> / </span>
        <span className="tabular-nums">#{round.id}</span>
      </nav>

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold text-balance">{round.subject}</h1>
          <Badge variant="outline">{topic?.label ?? round.topic}</Badge>
          <Badge variant="secondary">{round.kind === "lyrics" ? "Lyrics" : "Picture"}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Banked {when.format(round.createdAt)}. {dealt} {describeVotes(round.votes)}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <aside className="flex flex-col gap-6 lg:sticky lg:top-6">
          {round.kind === "image" ? (
            <Picture round={round} maxBytes={await maxImageBytes()} />
          ) : (
            <Paraphrase round={round} />
          )}
          <DeleteRound action={deleteRound.bind(null, round.id)} />
        </aside>

        <RoundEditor round={round} action={updateRound.bind(null, round.id)} />
      </div>
    </>
  );
}

/** The picture as the stage frames it, its provenance, and the way to swap it. */
function Picture({ round, maxBytes }: { round: BankedRoundRecord; maxBytes: number }) {
  return (
    <div className="flex flex-col gap-5 rounded-xl bg-card p-5 ring-1 ring-border/60">
      <figure className="flex flex-col gap-3">
        <div className="relative aspect-[4/3] overflow-hidden rounded-lg bg-background ring-1 ring-foreground/10">
          {round.imageFile === null ? (
            <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted-foreground">
              This round has no picture. Upload one below.
            </p>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element -- streamed
               from the bucket by this app's own /img route. */
            <img
              src={`/img/${round.imageFile}`}
              alt=""
              className="absolute inset-0 size-full object-contain p-3"
            />
          )}
        </div>
        <figcaption className="flex flex-col gap-1 text-xs text-muted-foreground">
          {round.sourceUrl === null ? (
            <span>No source on record.</span>
          ) : (
            <a
              href={round.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="truncate rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {round.sourceUrl}
            </a>
          )}
          {round.imageFile !== null && (
            <span className="truncate font-mono" title={round.imageFile}>
              {round.imageFile}
            </span>
          )}
        </figcaption>
      </figure>

      <ReplaceImage action={replaceImage.bind(null, round.id)} maxBytes={maxBytes} />
    </div>
  );
}

/** The paraphrase as the stage shows it — the editor on the right changes it. */
function Paraphrase({ round }: { round: BankedRoundRecord }) {
  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-border/60">
      <div className="grid min-h-64 place-items-center rounded-lg bg-background p-6 ring-1 ring-foreground/10">
        <blockquote className="max-w-xl text-center">
          <p
            lang={round.snippetLanguage ?? undefined}
            className="font-heading text-xl leading-relaxed whitespace-pre-line text-balance"
          >
            {round.snippet ?? "No paraphrase yet."}
          </p>
          <footer className="mt-5 text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Lyrics, paraphrased
          </footer>
        </blockquote>
      </div>
    </div>
  );
}
