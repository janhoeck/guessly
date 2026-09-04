import type { BankedRoundRecord } from "@guessly/bank"

import { cn } from "@guessly/ui/lib/utils"

/**
 * A round at postage-stamp size: the picture, or a mark that says there is
 * none to show because the round is words. `alt` is empty for the same
 * reason it is in the game — the only honest description of the picture is
 * the answer, and the subject beside it says what it is.
 */
function RoundThumb({ round, className }: { round: BankedRoundRecord; className?: string }) {
  if (round.kind === "image" && round.imageFile !== null) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- the picture is
         streamed from the bucket by this app's own /img route; there is
         nothing for next/image to optimise and no remote host to allow. */
      <img
        src={`/img/${round.imageFile}`}
        alt=""
        loading="lazy"
        className={cn(
          "size-12 shrink-0 rounded-md bg-background object-cover ring-1 ring-border/40",
          className
        )}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={cn(
        "grid size-12 shrink-0 place-items-center rounded-md bg-background font-heading text-2xl leading-none text-muted-foreground ring-1 ring-border/40",
        className
      )}
    >
      {round.kind === "lyrics" ? "“" : "?"}
    </span>
  )
}

export { RoundThumb }
