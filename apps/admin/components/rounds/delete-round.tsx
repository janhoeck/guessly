"use client"

import * as React from "react"

import type { DeleteState } from "@/app/(admin)/rounds/[id]/actions"
import { Button } from "@guessly/ui/components/ui/button"

/**
 * Two clicks to delete, and the second one is a form.
 *
 * Not `window.confirm`: a browser dialog says "OK" about something it cannot
 * describe, and this one has to say what deleting means here — the picture
 * goes too, unless another round shows it. The first click only reveals
 * that sentence and the real button, which is the whole safeguard, and
 * "Keep it" puts everything back.
 */
function DeleteRound({ action }: { action: () => Promise<DeleteState> }) {
  const [armed, setArmed] = React.useState(false)
  const [state, formAction, pending] = React.useActionState<DeleteState, FormData>(action, {
    error: null,
  })

  if (!armed) {
    return (
      <div className="flex flex-col gap-3 rounded-xl p-5 ring-1 ring-border/40">
        <Button
          type="button"
          variant="destructive"
          onClick={() => setArmed(true)}
          className="self-start"
        >
          Delete this round
        </Button>
        <p className="text-xs text-muted-foreground">
          Takes it off the shelf for good — picture included, unless another
          round shows the same one.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-xl bg-card p-5 ring-1 ring-destructive/40">
      <p className="text-sm">
        Delete this round? There is no undo; the fill tool would have to make a
        new one.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Deleting…" : "Yes, delete it"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setArmed(false)} disabled={pending}>
          Keep it
        </Button>
      </div>
      {state.error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}

export { DeleteRound }
