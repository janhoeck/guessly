"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The room code, sized to be read out loud across a table or a voice call.
 *
 * The letters are spelled out for screen readers — "K 7 Q M X" rather than a
 * word nobody can pronounce — while the visible text stays a single tracked-out
 * run.
 */
function LobbyCode({ code, className, ...props }: { code: string } & React.ComponentProps<"div">) {
  const [copied, setCopied] = React.useState(false)

  // Reset the tick without leaking a timer if the dialog closes first.
  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2_000)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
    } catch {
      // Insecure origins and locked-down browsers refuse the clipboard. The
      // code is on screen either way, which is what it is really for.
      toast.error("Could not copy — read it out instead.")
    }
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg bg-background p-4 ring-1 ring-brand-cyan/25",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
          Room code
        </span>
        <strong
          /* The tracking pushes the run right; the negative indent puts the
             five characters back on the optical centre of their own box. */
          className="font-heading text-3xl font-bold tracking-[0.3em] [text-indent:0.3em] uppercase tabular-nums sm:text-4xl"
          aria-label={code.split("").join(" ")}
        >
          {code}
        </strong>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        onClick={copy}
        aria-label={copied ? "Room code copied" : "Copy room code"}
      >
        {copied ? <CheckIcon className="text-brand-cyan" /> : <CopyIcon />}
      </Button>
    </div>
  )
}

export { LobbyCode }
