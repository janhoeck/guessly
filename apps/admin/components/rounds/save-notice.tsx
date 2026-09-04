"use client"

import Link from "next/link"

import type { SaveState } from "@/app/(admin)/rounds/[id]/actions"

/**
 * What the last save said, under the button that made it. Polite, so a
 * screen reader hears "Saved" without being interrupted by it — and an
 * error is an alert, because it is the one thing the operator has to act on.
 */
function SaveNotice({ state }: { state: SaveState }) {
  if (state.status === "idle") return null

  if (state.status === "saved") {
    return (
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {state.note ?? "Saved."}
      </p>
    )
  }

  return (
    <p role="alert" className="text-sm text-destructive">
      {state.message}
      {state.roundId !== undefined && (
        <>
          {" "}
          <Link
            href={`/rounds/${state.roundId}`}
            className="underline underline-offset-4 hover:text-foreground"
          >
            Open round #{state.roundId}
          </Link>
        </>
      )}
    </p>
  )
}

export { SaveNotice }
