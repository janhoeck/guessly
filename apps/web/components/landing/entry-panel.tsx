import * as React from "react"

import { EntryForm } from "@/components/landing/entry-form"
import { Card, CardContent, CardHeader, CardTitle } from "@guessly/ui/components/ui/card"
import { cn } from "@guessly/ui/lib/utils"

/**
 * The card the entry form sits in. Chrome only — it holds no state and takes no
 * props from the form, so it keeps rendering on the server after EntryForm
 * becomes a client island.
 */
function EntryPanel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <Card
      className={cn("w-full max-w-md [--card-spacing:--spacing(6)]", className)}
      {...props}
    >
      <CardHeader>
        <CardTitle className="text-lg">Start playing</CardTitle>
      </CardHeader>
      <CardContent>
        {/* EntryForm reads `?code=` to prefill the room code, and
            `useSearchParams` opts its subtree out of static rendering. The
            boundary is here so that stays true of the form alone — the card,
            the hero and everything else on the page keep prerendering. */}
        <React.Suspense fallback={<div className="h-[19.5rem]" />}>
          <EntryForm />
        </React.Suspense>
      </CardContent>
    </Card>
  )
}

export { EntryPanel }
