import Link from "next/link"
import { LANGUAGES, isTopicId, topicById } from "@guessly/protocol"
import type { TopicStock } from "@guessly/bank"

import { DEFAULT_ORDER, roundsHref } from "@/lib/query"
import { cn } from "@guessly/ui/lib/utils"

/**
 * One row per shelf. Three numbers matter and they are laid out so the eye
 * lands on them in order: how many rounds the topic holds, then how many of
 * those each language can actually be dealt, with the gap between the two
 * named as a link — because a round missing German is not a statistic, it is
 * a job, and the job is one click away.
 *
 * The bar under the count is the one decoration: the topic's size against
 * the fullest shelf, in the brand cyan, which is what the brand colours are
 * for. The pink dot marks the thinnest shelf in the catalogue — the one the
 * fill tool will pick up next.
 */
function ShelfTable({ stock }: { stock: TopicStock[] }) {
  const fullest = Math.max(1, ...stock.map((shelf) => shelf.rounds))
  const level = (shelf: TopicStock): number =>
    Math.min(...LANGUAGES.map((language) => shelf.counts[language.id] ?? 0))
  const thinnest = stock
    .filter((shelf) => isTopicId(shelf.topic))
    .reduce<TopicStock | null>((low, shelf) => (low === null || level(shelf) < level(low) ? shelf : low), null)

  return (
    <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs tracking-[0.2em] text-muted-foreground uppercase">
            <th scope="col" className="px-4 py-3 font-medium">
              Topic
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Rounds
            </th>
            {LANGUAGES.map((language) => (
              <th key={language.id} scope="col" className="px-4 py-3 font-medium">
                {language.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {stock.map((shelf) => {
            const topic = isTopicId(shelf.topic) ? topicById(shelf.topic) : null
            const isThinnest = thinnest?.topic === shelf.topic
            return (
              <tr key={shelf.topic} className="transition-colors hover:bg-accent/40">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <Link
                    href={roundsHref({ filter: { topic: shelf.topic }, order: DEFAULT_ORDER, page: 1 })}
                    className="inline-flex items-center gap-2 rounded-sm font-medium outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {isThinnest && (
                      <span
                        aria-hidden
                        title="The thinnest shelf — the fill tool fills this one next"
                        className="size-1.5 rounded-full bg-brand-pink"
                      />
                    )}
                    {topic?.label ?? shelf.topic}
                    {isThinnest && <span className="sr-only">(thinnest shelf)</span>}
                  </Link>
                  <span className="block text-xs text-muted-foreground">
                    {topic
                      ? `${topic.kind === "lyrics" ? "Lyrics" : "Pictures"} · ${topic.hint}`
                      : "Not in the catalogue — no lobby can be dealt these"}
                  </span>
                </th>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-8 text-right tabular-nums">{shelf.rounds}</span>
                    <span
                      aria-hidden
                      className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-background sm:w-32"
                    >
                      <span
                        className="block h-full rounded-full bg-brand-cyan/60"
                        style={{ width: `${(shelf.rounds / fullest) * 100}%` }}
                      />
                    </span>
                  </div>
                </td>
                {LANGUAGES.map((language) => {
                  const count = shelf.counts[language.id] ?? 0
                  const missing = shelf.rounds - count
                  return (
                    <td key={language.id} className="px-4 py-3">
                      <span className={cn("tabular-nums", count === 0 && shelf.rounds > 0 && "text-destructive")}>
                        {count}
                      </span>
                      {missing > 0 && (
                        <Link
                          href={roundsHref({
                            filter: { topic: shelf.topic, missingLanguage: language.id },
                            order: DEFAULT_ORDER,
                            page: 1,
                          })}
                          className="ml-2 rounded-sm text-xs text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          {missing} missing
                        </Link>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export { ShelfTable }
