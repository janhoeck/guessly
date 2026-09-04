import * as React from "react"
import Link from "next/link"

import { logout } from "@/app/login/actions"
import { Wordmark } from "@guessly/ui/components/wordmark"
import { Button } from "@guessly/ui/components/ui/button"
import { cn } from "@guessly/ui/lib/utils"

/**
 * The admin's own chrome: the wordmark with its badge, the two places to be,
 * and the way out.
 *
 * Stateless like the web app's header — no active-link highlight, because
 * that would mean `usePathname` and a client boundary around chrome that
 * otherwise never re-renders. Signing out is a form around a server action,
 * so it needs no JavaScript either.
 */

const LINKS = [
  { href: "/", label: "Shelves" },
  { href: "/rounds", label: "Rounds" },
] as const

function AdminHeader({ className, ...props }: React.ComponentProps<"header">) {
  return (
    <header className={cn("border-b border-border/60", className)} {...props}>
      <div className="mx-auto flex w-full max-w-6xl items-center gap-8 px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <Wordmark className="text-lg" />
          {/* A plate in the brand cyan, which is what the brand colours are
              for: this is the same wordmark as the game's, in a room that
              is not the game. */}
          <span className="rounded-sm bg-brand-cyan/15 px-1.5 py-0.5 font-heading text-[0.65rem] font-semibold tracking-[0.2em] uppercase">
            Admin
          </span>
        </Link>

        <nav aria-label="Main" className="flex items-center gap-6">
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

        <form action={logout} className="ml-auto">
          <Button type="submit" variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  )
}

export { AdminHeader }
