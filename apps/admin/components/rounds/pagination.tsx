import Link from "next/link"

import { Button } from "@guessly/ui/components/ui/button"
import { roundsHref, type RoundQuery } from "@/lib/query"

/**
 * Previous and next, as links to the same address with the page changed.
 * An end of the list is a button that is not a link, rather than a link that
 * goes nowhere.
 */
function Pagination({ query, pages }: { query: RoundQuery; pages: number }) {
  if (pages <= 1) return null

  const page = Math.min(query.page, pages)
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-4">
      <PageLink query={query} page={page - 1} disabled={page <= 1}>
        Previous
      </PageLink>
      <span className="text-sm text-muted-foreground tabular-nums">
        Page {page} of {pages}
      </span>
      <PageLink query={query} page={page + 1} disabled={page >= pages}>
        Next
      </PageLink>
    </nav>
  )
}

function PageLink({
  query,
  page,
  disabled,
  children,
}: {
  query: RoundQuery
  page: number
  disabled: boolean
  children: React.ReactNode
}) {
  if (disabled) {
    return (
      <Button type="button" variant="secondary" disabled>
        {children}
      </Button>
    )
  }
  return (
    <Button asChild variant="secondary">
      <Link href={roundsHref({ ...query, page })}>{children}</Link>
    </Button>
  )
}

export { Pagination }
