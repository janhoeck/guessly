import Link from "next/link"
import { LANGUAGES, TOPICS } from "@guessly/protocol"
import type { RoundOrder } from "@guessly/bank"

import { Field } from "@/components/site/field"
import { Button } from "@guessly/ui/components/ui/button"
import { Input } from "@guessly/ui/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@guessly/ui/components/ui/select"
import { ROUND_ORDERS, isNarrowed, languageChoice, type RoundQuery } from "@/lib/query"

/**
 * The filter, as a GET form. Submitting it is a navigation to the address
 * the list reads, which is why there is no state here and no client boundary
 * of the form's own: the browser does the work, and the result is a URL
 * somebody can paste. The page number is deliberately not a field — a new
 * filter starts on page one.
 *
 * The four selects are the one part that needs a script. Each is shadcn's
 * Select — a button and a listbox — and what carries its choice into the GET
 * is the hidden native `<select>` Radix renders beside it, so the URL is
 * still the state; only *changing* a dropdown needs JavaScript, and the
 * search box and the button never do.
 *
 * The order sits among the filters because it is chosen the same way and
 * lands in the same address, though it narrows nothing: "most disliked
 * first" is how an operator finds the rounds to fix, and a threshold they
 * would have to guess at is not.
 */

/**
 * Radix's Select refuses an item whose value is the empty string, so "no
 * filter" has to be a word. `parseRoundQuery` treats anything that is not a
 * real id as no filter at all, which is what lets the form send this and the
 * address ignore it.
 */
const ANY = "any"

const ORDER_LABELS: Record<RoundOrder, string> = {
  newest: "Newest first",
  liked: "Most liked first",
  disliked: "Most disliked first",
}

function RoundFilters({ query }: { query: RoundQuery }) {
  const { filter } = query

  return (
    <form
      method="get"
      action="/rounds"
      className="grid gap-4 rounded-xl bg-card/50 p-4 ring-1 ring-border/40 sm:grid-cols-2 lg:grid-cols-3 lg:items-end xl:grid-cols-[1fr_1fr_1fr_1fr_1.4fr_auto]"
    >
      <Field id="filter-topic" label="Topic">
        <Select name="topic" defaultValue={filter.topic ?? ANY}>
          <SelectTrigger id="filter-topic" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Every topic</SelectItem>
            {TOPICS.map((topic) => (
              <SelectItem key={topic.id} value={topic.id}>
                {topic.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field id="filter-kind" label="Kind">
        <Select name="kind" defaultValue={filter.kind ?? ANY}>
          <SelectTrigger id="filter-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Pictures and lyrics</SelectItem>
            <SelectItem value="image">Pictures</SelectItem>
            <SelectItem value="lyrics">Lyrics</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      <Field id="filter-language" label="Language">
        <Select name="language" defaultValue={languageChoice(filter) ?? ANY}>
          <SelectTrigger id="filter-language" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any</SelectItem>
            {LANGUAGES.map((language) => (
              <SelectItem key={language.id} value={language.id}>
                Written in {language.label}
              </SelectItem>
            ))}
            {LANGUAGES.map((language) => (
              <SelectItem key={`missing:${language.id}`} value={`missing:${language.id}`}>
                Missing {language.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field id="filter-order" label="Order">
        <Select name="order" defaultValue={query.order}>
          <SelectTrigger id="filter-order" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROUND_ORDERS.map((order) => (
              <SelectItem key={order} value={order}>
                {ORDER_LABELS[order]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field id="filter-q" label="Search">
        <Input
          id="filter-q"
          name="q"
          type="search"
          defaultValue={filter.search ?? ""}
          placeholder="Subject or answer"
        />
      </Field>

      <div className="flex items-center gap-4">
        <Button type="submit" variant="secondary" className="h-8">
          Filter
        </Button>
        {isNarrowed(query) && (
          <Link
            href="/rounds"
            className="rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Clear
          </Link>
        )}
      </div>
    </form>
  )
}

export { RoundFilters }
