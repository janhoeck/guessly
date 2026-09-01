import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The Guessly wordmark: a type treatment, not a layout.
 *
 * The caller supplies the element around it, so the landing page can wrap it in
 * an <h1> while a lobby header sets it beside a room code, without either
 * inheriting the other's semantics. Size is the caller's call too — Chakra
 * Petch italic reads very differently at 72px and at 14px.
 */
function Wordmark({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="wordmark"
      className={cn(
        "font-heading font-bold tracking-tight uppercase italic",
        className
      )}
      {...props}
    >
      Guessly
    </span>
  )
}

export { Wordmark }
