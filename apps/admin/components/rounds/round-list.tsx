import * as React from "react"
import Link from "next/link"
import { LANGUAGES, isTopicId, topicById } from "@guessly/protocol"
import type { BankedRoundRecord } from "@guessly/bank"

import type { DeleteManyState } from "@/app/(admin)/rounds/actions"
import { RoundCheckbox } from "@/components/rounds/round-checkbox"
import { RoundSelection, SelectAllRounds } from "@/components/rounds/round-selection"
import { RoundThumb } from "@/components/rounds/round-thumb"
import { VoteTally } from "@/components/rounds/vote-tally"
import { Badge } from "@guessly/ui/components/ui/badge"
import { ROUNDS_PER_PAGE, isFiltered, roundsHref, type RoundQuery } from "@/lib/query"

/**
 * A page of the bank as a table, and the three things it can be instead of
 * one: an empty bank, a filter nothing matches, and a page past the end.
 * They read very differently to an operator and none is allowed to render as
 * another.
 *
 * The table is a form — see `RoundSelection` — so that several rounds can be
 * taken off the shelf in one go. The rows are still rendered here, on the
 * server; the checkbox on each is the browser's, and only the count of
 * them and the button they feed need a script.
 *
 * The votes column is the one the address can rank the list by, and it says
 * so with `aria-sort` when it does — the plain list is newest first, which
 * no column is.
 *
 * The table is `table-fixed`: the header row sets every column's width and
 * the subject takes what is left, so a long subject or answer truncates in
 * its cell instead of widening the table past the page. In the browser's
 * default layout a cell is as wide as its text, `max-w` on it is ignored,
 * and one long row put a horizontal scrollbar under the whole list. The
 * `min-w` is the floor below which scrolling is the lesser evil — a phone,
 * not a laptop.
 */
function RoundList({
  query,
  rounds,
  total,
  action,
}: {
  query: RoundQuery
  rounds: BankedRoundRecord[]
  total: number
  action: (previous: DeleteManyState, form: FormData) => Promise<DeleteManyState>
}) {
  if (total === 0) {
    return isFiltered(query.filter) ? (
      <Notice>
        Nothing matches that. Loosen the filter, or{" "}
        <Link href="/rounds" className="text-primary underline-offset-4 hover:underline">
          show everything
        </Link>
        .
      </Notice>
    ) : (
      <Notice>
        The bank is empty. Run <code className="font-mono text-foreground">pnpm fill</code> for a
        while and the shelves will fill up here.
      </Notice>
    )
  }

  if (rounds.length === 0) {
    return (
      <Notice>
        Nothing on this page.{" "}
        <Link
          href={roundsHref({ ...query, page: 1 })}
          className="text-primary underline-offset-4 hover:underline"
        >
          Back to the first
        </Link>
        .
      </Notice>
    )
  }

  const from = (query.page - 1) * ROUNDS_PER_PAGE + 1
  const to = from + rounds.length - 1

  return (
    <RoundSelection action={action} total={rounds.length} range={`${from}–${to} of ${total}`}>
      <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-border/60">
        <table className="w-full min-w-[56rem] table-fixed text-sm">
          <thead>
            <tr className="text-left text-xs tracking-[0.2em] text-muted-foreground uppercase">
              <th scope="col" className="w-10 py-3 pr-1 pl-4">
                <SelectAllRounds />
              </th>
              <th scope="col" className="px-4 py-3 font-medium">
                Round
              </th>
              <th scope="col" className="w-40 px-4 py-3 font-medium">
                Topic
              </th>
              {LANGUAGES.map((language) => (
                <th key={language.id} scope="col" className="w-44 px-4 py-3 font-medium">
                  {language.label}
                </th>
              ))}
              <th scope="col" className="w-20 px-4 py-3 text-right font-medium">
                Dealt
              </th>
              <th
                scope="col"
                aria-sort={query.order === "newest" ? undefined : "descending"}
                className="w-28 px-4 py-3 text-right font-medium"
              >
                Votes
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {rounds.map((round) => (
              <RoundRow key={round.id} round={round} />
            ))}
          </tbody>
        </table>
      </div>
    </RoundSelection>
  )
}

function RoundRow({ round }: { round: BankedRoundRecord }) {
  const topic = isTopicId(round.topic) ? topicById(round.topic) : null

  return (
    <tr className="transition-colors hover:bg-accent/40 has-[input:checked]:bg-accent/60">
      <td className="w-10 py-2.5 pr-1 pl-4">
        <RoundCheckbox name="id" value={round.id} aria-label={`Select ${round.subject}`} />
      </td>
      <th scope="row" className="px-4 py-2.5 text-left font-normal">
        <Link
          href={`/rounds/${round.id}`}
          className="flex min-w-0 items-center gap-3 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <RoundThumb round={round} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{round.subject}</span>
            <span className="text-xs text-muted-foreground tabular-nums">#{round.id}</span>
          </span>
        </Link>
      </th>
      <td className="px-4 py-2.5">
        <Badge variant="outline">{topic?.label ?? round.topic}</Badge>
      </td>
      {LANGUAGES.map((language) => {
        const text = round.texts[language.id]
        return (
          <td key={language.id} lang={language.tag} className="truncate px-4 py-2.5">
            {text === undefined ? (
              <span aria-label={`Not written in ${language.label}`} className="text-muted-foreground/50">
                —
              </span>
            ) : (
              text.answer
            )}
          </td>
        )
      })}
      <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums">{round.timesServed}</td>
      <td className="px-4 py-2.5 text-right">
        <VoteTally votes={round.votes} />
      </td>
    </tr>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl bg-card/50 p-6 text-sm text-muted-foreground ring-1 ring-border/40">
      {children}
    </p>
  )
}

export { RoundList }
