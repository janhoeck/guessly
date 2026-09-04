import * as React from "react"
import Link from "next/link"

import { cn } from "@guessly/ui/lib/utils"

/**
 * The site's own navigation: the two places that are not a room.
 *
 * Transparent by design — it sits over whatever the page paints beneath it (on
 * the landing page, the ambient wash under the hero), so it reads as part of
 * the page rather than as a bar bolted to the top of it. Nothing here is
 * stateful, so it stays a server component; there is deliberately no active-link
 * highlight, because knowing which link is current means `usePathname` and a
 * `"use client"` boundary around chrome that otherwise never re-renders.
 *
 * A game screen is not in here. `/<CODE>` and `/<CODE>/results` carry their own
 * header — the wordmark beside the room code — and a second row of links above
 * it would both duplicate that and eat into the viewport height the round panel
 * is sized against.
 */

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/lobbies", label: "Lobbies" },
] as const

function SiteHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header className={cn("bg-transparent", className)} {...props}>
      <nav
        aria-label="Main"
        className="mx-auto flex w-full max-w-6xl items-center justify-center gap-8 px-6 py-6 sm:gap-10"
      >
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-sm font-heading text-sm font-semibold tracking-[0.2em] text-muted-foreground uppercase transition-colors outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}

export { SiteHeader }
